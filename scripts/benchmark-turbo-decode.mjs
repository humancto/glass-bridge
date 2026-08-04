import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";

const FRAME_BYTES = 2_944;
const SYMBOL_BYTES = 2_900;
const CAPTURE_SIZE = 720;
const QUIET_ZONE_MODULES = 4;
const WARMUP_FRAMES = 3;
const MEASURED_FRAMES = 30;
const READER_OPTIONS = {
  formats: ["QRCode"],
  maxNumberOfSymbols: 1,
  tryHarder: false,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  returnErrors: false,
};

const frame = Uint8Array.from({ length: FRAME_BYTES }, (_, index) => (index * 31 + 17) & 0xff);
const qr = QRCode.create([{ data: frame, mode: "byte" }], {
  version: 40,
  errorCorrectionLevel: "L",
  maskPattern: 4,
});
const image = renderQr(qr);
const wasmPath = fileURLToPath(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm"));
await prepareZXingModule({
  overrides: { wasmBinary: readFileSync(wasmPath) },
  fireImmediately: true,
});

for (let index = 0; index < WARMUP_FRAMES; index += 1) {
  await decodeExact(image, frame);
}

const samples = [];
for (let index = 0; index < MEASURED_FRAMES; index += 1) {
  const startedAt = performance.now();
  await decodeExact(image, frame);
  samples.push(performance.now() - startedAt);
}
samples.sort((left, right) => left - right);
const totalMs = samples.reduce((sum, value) => sum + value, 0);
const meanMs = totalMs / samples.length;
const percentile = (value) => samples[Math.floor((samples.length - 1) * value)];
const idealDecodeFps = 1_000 / meanMs;

console.log(JSON.stringify({
  scope: "ideal 720x720 QR raster through production ZXing-WASM settings; excludes display, camera, workers, and fountain overhead",
  frames: MEASURED_FRAMES,
  frame_bytes: FRAME_BYTES,
  exact_byte_matches: MEASURED_FRAMES,
  mean_ms: Number(meanMs.toFixed(3)),
  p50_ms: Number(percentile(0.5).toFixed(3)),
  p95_ms: Number(percentile(0.95).toFixed(3)),
  ideal_decode_fps: Number(idealDecodeFps.toFixed(1)),
  ideal_symbol_rate_bytes_per_second: Math.round(SYMBOL_BYTES * idealDecodeFps),
}, null, 2));

async function decodeExact(imageData, expected) {
  const results = await readBarcodes(imageData, READER_OPTIONS);
  const valid = results.find((result) => result.isValid);
  if (!valid || !equalBytes(valid.bytes, expected)) {
    throw new Error("ZXing-WASM did not recover the Turbo frame byte-for-byte.");
  }
}

function renderQr(value) {
  const modules = value.modules.size;
  const scale = Math.floor(CAPTURE_SIZE / (modules + QUIET_ZONE_MODULES * 2));
  const qrPixels = (modules + QUIET_ZONE_MODULES * 2) * scale;
  const offset = Math.floor((CAPTURE_SIZE - qrPixels) / 2);
  const data = new Uint8ClampedArray(CAPTURE_SIZE * CAPTURE_SIZE * 4);
  data.fill(255);
  for (let moduleY = 0; moduleY < modules; moduleY += 1) {
    for (let moduleX = 0; moduleX < modules; moduleX += 1) {
      if (!value.modules.get(moduleY, moduleX)) continue;
      const startX = offset + (moduleX + QUIET_ZONE_MODULES) * scale;
      const startY = offset + (moduleY + QUIET_ZONE_MODULES) * scale;
      for (let y = startY; y < startY + scale; y += 1) {
        for (let x = startX; x < startX + scale; x += 1) {
          const pixel = (y * CAPTURE_SIZE + x) * 4;
          data[pixel] = 0;
          data[pixel + 1] = 0;
          data[pixel + 2] = 0;
        }
      }
    }
  }
  return { data, width: CAPTURE_SIZE, height: CAPTURE_SIZE, colorSpace: "srgb" };
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}
