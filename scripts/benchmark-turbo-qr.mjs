import { performance } from "node:perf_hooks";
import QRCode from "qrcode";

const FRAME_BYTES = 2_944;
const SYMBOL_BYTES = 2_900;
const TARGET_FPS = 60;
const WARMUP_FRAMES = 20;
const MEASURED_FRAMES = 240;

const frame = new Uint8Array(FRAME_BYTES);
const payload = [{ data: frame, mode: "byte" }];
const options = { version: 40, errorCorrectionLevel: "L", maskPattern: 4 };

for (let index = 0; index < WARMUP_FRAMES; index += 1) {
  frame[20] = index;
  QRCode.create(payload, options);
}

const samples = [];
for (let index = 0; index < MEASURED_FRAMES; index += 1) {
  frame[20] = index;
  const startedAt = performance.now();
  QRCode.create(payload, options);
  samples.push(performance.now() - startedAt);
}
samples.sort((left, right) => left - right);
const totalMs = samples.reduce((sum, value) => sum + value, 0);
const percentile = (value) => samples[Math.floor((samples.length - 1) * value)];

console.log(JSON.stringify({
  scope: "QR matrix generation only; excludes canvas, display, camera, decode, and fountain overhead",
  frames: MEASURED_FRAMES,
  frame_bytes: FRAME_BYTES,
  target_fps: TARGET_FPS,
  raw_symbol_rate_bytes_per_second: SYMBOL_BYTES * TARGET_FPS,
  mean_ms: Number((totalMs / samples.length).toFixed(3)),
  p50_ms: Number(percentile(0.5).toFixed(3)),
  p95_ms: Number(percentile(0.95).toFixed(3)),
  matrix_generation_fps: Number((MEASURED_FRAMES * 1_000 / totalMs).toFixed(1)),
}, null, 2));
