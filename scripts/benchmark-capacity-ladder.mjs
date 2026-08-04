import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const WIDTH = 1_280;
const HEIGHT = 720;
const HEADER_BYTES = 44;
const WARMUP_EXPOSURES = 3;
const MEASURED_EXPOSURES = 30;
const CONFIGURATIONS = [
  { id: "v30-single", lanes: 1, version: 30, symbolBytes: 1_688, scale: 4 },
  { id: "v30-dual", lanes: 2, version: 30, symbolBytes: 1_688, scale: 4 },
  { id: "v40-dual", lanes: 2, version: 40, symbolBytes: 2_900, scale: 3 },
];

const wasmPath = fileURLToPath(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm"));
await prepareZXingModule({
  overrides: { wasmBinary: readFileSync(wasmPath) },
  fireImmediately: true,
});

const results = [];
for (const configuration of CONFIGURATIONS) {
  results.push(await benchmark(configuration));
}

console.log(JSON.stringify({
  scope: "ideal 1280x720 QR exposures through production ZXing-WASM settings; excludes display, camera, workers, and fountain overhead",
  measured_exposures_per_configuration: MEASURED_EXPOSURES,
  configurations: results,
}, null, 2));

async function benchmark(configuration) {
  const frames = Array.from({ length: configuration.lanes }, (_, lane) => Uint8Array.from(
    { length: configuration.symbolBytes + HEADER_BYTES },
    (_, index) => (index * (31 + lane * 6) + 17 + lane) & 0xff,
  ));
  const image = renderExposure(frames, configuration);
  const options = {
    formats: ["QRCode"],
    maxNumberOfSymbols: configuration.lanes,
    tryHarder: false,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: false,
    returnErrors: false,
  };

  for (let index = 0; index < WARMUP_EXPOSURES; index += 1) {
    await decodeExact(image, frames, options);
  }
  const samples = [];
  for (let index = 0; index < MEASURED_EXPOSURES; index += 1) {
    const startedAt = performance.now();
    await decodeExact(image, frames, options);
    samples.push(performance.now() - startedAt);
  }
  samples.sort((left, right) => left - right);
  const meanMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const idealExposuresPerSecond = 1_000 / meanMs;
  const idealSymbolsPerSecond = idealExposuresPerSecond * configuration.lanes;

  return {
    id: configuration.id,
    qr_version: configuration.version,
    lanes: configuration.lanes,
    symbol_bytes: configuration.symbolBytes,
    wire_bytes_per_code: configuration.symbolBytes + HEADER_BYTES,
    exact_code_matches: MEASURED_EXPOSURES * configuration.lanes,
    p50_ms: round(percentile(samples, 0.5), 3),
    p95_ms: round(percentile(samples, 0.95), 3),
    ideal_exposures_per_second: round(idealExposuresPerSecond, 1),
    ideal_decoded_symbols_per_second: round(idealSymbolsPerSecond, 1),
    ideal_symbol_rate_bytes_per_second: Math.round(configuration.symbolBytes * idealSymbolsPerSecond),
    nominal_at_30_camera_fps: configuration.symbolBytes * configuration.lanes * 30,
    nominal_at_60_camera_fps: configuration.symbolBytes * configuration.lanes * 60,
  };
}

async function decodeExact(image, expected, options) {
  const decoded = (await readBarcodes(image, options))
    .filter((result) => result.isValid)
    .map((result) => result.bytes);
  if (decoded.length !== expected.length || expected.some(
    (frame) => !decoded.some((candidate) => equalBytes(candidate, frame)),
  )) {
    throw new Error("ZXing-WASM did not recover every capacity-ladder lane byte-for-byte.");
  }
}

function renderExposure(values, configuration) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  data.fill(255);
  const totalModules = 21 + (configuration.version - 1) * 4 + 8;
  const qrPixels = totalModules * configuration.scale;
  const gap = configuration.lanes === 1 ? 0 : 40;
  const totalWidth = qrPixels * configuration.lanes + gap * (configuration.lanes - 1);
  const startX = Math.floor((WIDTH - totalWidth) / 2);
  const startY = Math.floor((HEIGHT - qrPixels) / 2);

  values.forEach((value, lane) => {
    const qr = QRCode.create([{ data: value, mode: "byte" }], {
      version: configuration.version,
      errorCorrectionLevel: "L",
      maskPattern: 4,
    });
    paintQr(data, qr, startX + lane * (qrPixels + gap), startY, configuration.scale);
  });
  return { data, width: WIDTH, height: HEIGHT, colorSpace: "srgb" };
}

function paintQr(data, qr, offsetX, offsetY, scale) {
  const quiet = 4;
  for (let moduleY = 0; moduleY < qr.modules.size; moduleY += 1) {
    for (let moduleX = 0; moduleX < qr.modules.size; moduleX += 1) {
      if (!qr.modules.get(moduleY, moduleX)) continue;
      const startX = offsetX + (moduleX + quiet) * scale;
      const startY = offsetY + (moduleY + quiet) * scale;
      for (let y = startY; y < startY + scale; y += 1) {
        for (let x = startX; x < startX + scale; x += 1) {
          const pixel = (y * WIDTH + x) * 4;
          data[pixel] = 0;
          data[pixel + 1] = 0;
          data[pixel + 2] = 0;
        }
      }
    }
  }
}

function percentile(sorted, value) {
  return sorted[Math.floor((sorted.length - 1) * value)];
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}
