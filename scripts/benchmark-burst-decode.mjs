import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const WIRE_FRAME_BYTES = 1_732;
const SYMBOL_BYTES = 1_688;
const WIDTH = 1_280;
const HEIGHT = 720;
const WARMUP_EXPOSURES = 3;
const MEASURED_EXPOSURES = 30;
const READER_OPTIONS = {
  formats: ["QRCode"],
  maxNumberOfSymbols: 2,
  tryHarder: false,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  returnErrors: false,
};

const frames = [0, 1].map((lane) => Uint8Array.from(
  { length: WIRE_FRAME_BYTES },
  (_, index) => (index * (31 + lane * 6) + 17 + lane) & 0xff,
));
const image = renderBurstExposure(frames);
const wasmPath = fileURLToPath(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm"));
await prepareZXingModule({
  overrides: { wasmBinary: readFileSync(wasmPath) },
  fireImmediately: true,
});

for (let index = 0; index < WARMUP_EXPOSURES; index += 1) await decodeExact(image, frames);
const samples = [];
for (let index = 0; index < MEASURED_EXPOSURES; index += 1) {
  const startedAt = performance.now();
  await decodeExact(image, frames);
  samples.push(performance.now() - startedAt);
}
samples.sort((left, right) => left - right);
const totalMs = samples.reduce((sum, value) => sum + value, 0);
const meanMs = totalMs / samples.length;
const exposureFps = 1_000 / meanMs;
const decodedSymbolsPerSecond = exposureFps * 2;
const percentile = (value) => samples[Math.floor((samples.length - 1) * value)];

console.log(JSON.stringify({
  scope: "ideal 1280x720 exposure with two v30-L codes through production ZXing-WASM settings; excludes display, camera, workers, and fountain overhead",
  exposures: MEASURED_EXPOSURES,
  exact_code_matches: MEASURED_EXPOSURES * 2,
  p50_ms: Number(percentile(0.5).toFixed(3)),
  p95_ms: Number(percentile(0.95).toFixed(3)),
  ideal_exposures_per_second: Number(exposureFps.toFixed(1)),
  ideal_decoded_symbols_per_second: Number(decodedSymbolsPerSecond.toFixed(1)),
  ideal_symbol_rate_bytes_per_second: Math.round(SYMBOL_BYTES * decodedSymbolsPerSecond),
}, null, 2));

async function decodeExact(imageData, expected) {
  const decoded = (await readBarcodes(imageData, READER_OPTIONS))
    .filter((result) => result.isValid)
    .map((result) => result.bytes);
  if (decoded.length !== expected.length || expected.some(
    (frame) => !decoded.some((candidate) => equalBytes(candidate, frame)),
  )) {
    throw new Error("ZXing-WASM did not recover both Burst lanes byte-for-byte.");
  }
}

function renderBurstExposure(values) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  data.fill(255);
  values.forEach((value, lane) => {
    const qr = QRCode.create([{ data: value, mode: "byte" }], {
      version: 30,
      errorCorrectionLevel: "L",
      maskPattern: 4,
    });
    paintQr(data, qr, 40 + lane * 620, 70);
  });
  return { data, width: WIDTH, height: HEIGHT, colorSpace: "srgb" };
}

function paintQr(data, qr, offsetX, offsetY) {
  const scale = 4;
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

function equalBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
