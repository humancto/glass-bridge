import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const WIDTH = 1_280;
const HEIGHT = 720;
const OVERLAP = Math.floor(WIDTH * 0.08);
const MEASURED_EXPOSURES = 40;
const configurations = [
  { id: "burst-v30", profileId: "burst", version: 30, symbolBytes: 1_688, scale: 4 },
  { id: "ceiling-v40", profileId: "ceiling", version: 40, symbolBytes: 2_900, scale: 3 },
];

assertProductionProfiles(configurations);

const wasmPath = fileURLToPath(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm"));
await prepareZXingModule({
  overrides: { wasmBinary: readFileSync(wasmPath) },
  fireImmediately: true,
});

const results = [];
for (const configuration of configurations) {
  results.push(await benchmark(configuration));
}

console.log(JSON.stringify({
  scope: "ideal dual-lane 1280x720 exposure; ROI numbers model two independent WASM workers and exclude camera/display costs",
  measured_exposures_per_path: MEASURED_EXPOSURES,
  configurations: results,
}, null, 2));

async function benchmark(configuration) {
  const frames = [0, 1].map((lane) => Uint8Array.from(
    { length: configuration.symbolBytes + 44 },
    (_, index) => (index * (31 + lane * 6) + 17 + lane) & 0xff,
  ));
  const exposure = renderExposure(frames, configuration);
  const left = crop(exposure, 0, Math.floor(WIDTH / 2) + OVERLAP);
  const rightX = Math.floor(WIDTH / 2) - OVERLAP;
  const right = crop(exposure, rightX, WIDTH - rightX);

  const fullMeasurement = await measure(exposure, frames, 2);
  const leftMeasurement = await measure(left, [frames[0]], 1);
  const rightMeasurement = await measure(right, [frames[1]], 1);
  const parallelSamples = leftMeasurement.samples.map((sample, index) => (
    Math.max(sample, rightMeasurement.samples[index])
  ));
  const parallelResult = summarize(parallelSamples);
  return {
    id: configuration.id,
    qr_version: configuration.version,
    symbol_bytes: configuration.symbolBytes,
    full_frame: fullMeasurement.summary,
    split_lane_left: leftMeasurement.summary,
    split_lane_right: rightMeasurement.summary,
    modeled_parallel_roi_p50_ms: parallelResult.p50_ms,
    modeled_parallel_roi_p95_ms: parallelResult.p95_ms,
    modeled_parallel_symbols_per_second: round(2_000 / parallelResult.p50_ms, 1),
    modeled_parallel_symbol_bytes_per_second: Math.round(
      configuration.symbolBytes * 2_000 / parallelResult.p50_ms,
    ),
  };
}

async function measure(image, expected, maxNumberOfSymbols) {
  const options = {
    formats: ["QRCode"],
    maxNumberOfSymbols,
    tryHarder: false,
    tryRotate: true,
    tryInvert: true,
    tryDownscale: false,
    returnErrors: false,
  };
  for (let index = 0; index < 3; index += 1) await decodeExact(image, expected, options);
  const samples = [];
  for (let index = 0; index < MEASURED_EXPOSURES; index += 1) {
    const startedAt = performance.now();
    await decodeExact(image, expected, options);
    samples.push(performance.now() - startedAt);
  }
  return { samples, summary: summarize(samples) };
}

function summarize(samples) {
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    p50_ms: round(percentile(sorted, 0.5), 3),
    p95_ms: round(percentile(sorted, 0.95), 3),
    mean_ms: round(samples.reduce((sum, value) => sum + value, 0) / samples.length, 3),
  };
}

function assertProductionProfiles(benchmarkConfigurations) {
  const source = readFileSync(new URL("../src/protocol/optical-profile.ts", import.meta.url), "utf8");
  for (const configuration of benchmarkConfigurations) {
    const block = source.match(new RegExp(`\\n  ${configuration.profileId}: \\{([\\s\\S]*?)\\n  \\},`, "u"))?.[1];
    const symbolSize = block?.match(/symbolSize: ([\d_]+),/u)?.[1];
    const qrVersion = block?.match(/qrVersion: (\d+),/u)?.[1];
    if (
      block === undefined ||
      Number(symbolSize?.replaceAll("_", "")) !== configuration.symbolBytes ||
      Number(qrVersion) !== configuration.version
    ) {
      throw new Error(`Benchmark configuration ${configuration.id} has drifted from production profile ${configuration.profileId}.`);
    }
  }
}

async function decodeExact(image, expected, options) {
  const decoded = (await readBarcodes(image, options))
    .filter((result) => result.isValid)
    .map((result) => result.bytes);
  if (decoded.length !== expected.length || expected.some(
    (frame) => !decoded.some((candidate) => equalBytes(candidate, frame)),
  )) {
    throw new Error("The production decoder did not recover the expected lane bytes.");
  }
}

function renderExposure(values, configuration) {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  data.fill(255);
  const totalModules = 21 + (configuration.version - 1) * 4 + 8;
  const qrPixels = totalModules * configuration.scale;
  const gap = 40;
  const startX = Math.floor((WIDTH - qrPixels * 2 - gap) / 2);
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

function crop(image, x, width) {
  const data = new Uint8ClampedArray(width * image.height * 4);
  for (let y = 0; y < image.height; y += 1) {
    const sourceStart = (y * image.width + x) * 4;
    data.set(image.data.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
  }
  return { data, width, height: image.height, colorSpace: "srgb" };
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
