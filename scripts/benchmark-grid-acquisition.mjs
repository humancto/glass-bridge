import { performance } from "node:perf_hooks";
import { createServer } from "vite";

const root = process.cwd();
const server = await createServer({
  configFile: false,
  root,
  cacheDir: "/tmp/glassbridge-grid-acquisition-vite",
  logLevel: "silent",
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const grid = await server.ssrLoadModule("/src/phy/grid/grid-codec.ts");
  const profiles = await server.ssrLoadModule("/src/protocol/optical-profile.ts");
  const lt = await server.ssrLoadModule("/src/protocol/lt-codec.ts");
  const sender = await server.ssrLoadModule("/src/sender/transport.ts");
  const receiver = await server.ssrLoadModule("/src/receiver/transport.ts");
  const simulation = await server.ssrLoadModule("/tests/fixtures/grid-camera-sim.ts");
  const profile = profiles.OPTICAL_PROFILES.grid;
  const encoder = new sender.OpticalTransferEncoder(deterministicBytes(144 * 1_024), {
    sessionId: Uint8Array.from({ length: 16 }, (_, index) => (index * 19 + 7) & 0xff),
    symbolSize: profile.symbolSize,
    codec: profile.codec,
  });
  const decoder = new receiver.OpticalTransferDecoder(encoder.sessionId);
  const decodeMs = [];
  const outcomes = {};
  const stableCorrections = [];
  let stableDecoded = 0;
  let tornDecoded = 0;
  let previousScene;

  for (let symbolId = 0; symbolId < encoder.sourceCount; symbolId += 1) {
    const expected = encoder.frameBytes(symbolId);
    const scene = simulation.makeCameraScene(grid.renderGridFrame(expected), {
      brightness: 0.9,
      moireAmplitude: symbolId % 3 === 0 ? 3 : 0,
    });
    if (previousScene) {
      const torn = simulation.transitionTear(previousScene, scene);
      const startedAt = performance.now();
      const attempt = grid.decodeGridFrame(torn);
      decodeMs.push(performance.now() - startedAt);
      increment(outcomes, `torn:${attempt.outcome}`);
      if (attempt.outcome === "decoded" && attempt.frame) {
        tornDecoded += 1;
        decoder.ingestFrame(attempt.frame);
      }
    }
    const startedAt = performance.now();
    const attempt = grid.decodeGridFrame(scene);
    decodeMs.push(performance.now() - startedAt);
    increment(outcomes, `stable:${attempt.outcome}`);
    if (attempt.outcome === "decoded" && attempt.frame && equalBytes(attempt.frame, expected)) {
      stableDecoded += 1;
      stableCorrections.push(attempt.correctedCodewords ?? 0);
      decoder.ingestFrame(attempt.frame);
    }
    previousScene = scene;
  }

  const blurFrame = encoder.frameBytes(41);
  const blurSource = grid.renderGridFrame(blurFrame);
  const blurCamera = {
    width: 1_280,
    height: 720,
    quad: [
      { x: 120.4, y: 70.7 },
      { x: 1_160.2, y: 90.3 },
      { x: 1_120.6, y: 650.4 },
      { x: 150.8, y: 665.1 },
    ],
    blurRadius: 1,
    brightness: 0.86,
    moireAmplitude: 5,
  };
  const blurScene = simulation.makeCameraScene(blurSource, blurCamera);
  const blurStartedAt = performance.now();
  const blurAttempt = grid.decodeGridFrame(blurScene);
  const blurDecodeMs = performance.now() - blurStartedAt;
  const blurByteExact = blurAttempt.outcome === "decoded" &&
    blurAttempt.frame && equalBytes(blurAttempt.frame, blurFrame);

  const progress = decoder.snapshot();
  const expectedFrames = lt.expectedLtFrames(encoder.sourceCount);
  const sorted = [...decodeMs].sort((left, right) => left - right);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const singleWorkerExposureBudgetMs = 1_000 / 60;
  const gates = {
    stable_decode_percent: stableDecoded / encoder.sourceCount * 100,
    transfer_reconstructed: progress.complete,
    payload_byte_exact: progress.envelope ? equalBytes(progress.envelope, deterministicBytes(144 * 1_024)) : false,
    high_fill_blur_probe_byte_exact: Boolean(blurByteExact),
    p95_decode_below_single_worker_60fps_budget: p95 < singleWorkerExposureBudgetMs,
    expected_solve_window_below_3_5_seconds: expectedFrames / 30 < 3.5,
  };
  const passed = gates.stable_decode_percent === 100 &&
    gates.transfer_reconstructed &&
    gates.payload_byte_exact &&
    gates.high_fill_blur_probe_byte_exact &&
    gates.p95_decode_below_single_worker_60fps_budget &&
    gates.expected_solve_window_below_3_5_seconds;
  console.log(JSON.stringify({
    schema: "glassbridge-grid-acquisition-benchmark/1",
    scope: "deterministic 144 KiB Grid30 camera simulation; fractional perspective, bilinear resampling, mild moire, colored UI distractors, one transition tear per stable epoch, plus a high-fill blur probe",
    source_symbols: encoder.sourceCount,
    expected_lt_frames: expectedFrames,
    grid30_source_floor_seconds: round(encoder.sourceCount / 30, 3),
    grid30_expected_solve_seconds: round(expectedFrames / 30, 3),
    camera_exposures: decodeMs.length,
    stable_decoded: stableDecoded,
    torn_decoded: tornDecoded,
    decode_outcomes: outcomes,
    stable_corrected_codewords_p95: percentile(stableCorrections.sort((left, right) => left - right), 0.95),
    stable_corrected_codewords_max: Math.max(...stableCorrections),
    stress_probes: {
      high_fill_blur: {
        outcome: blurAttempt.outcome,
        byte_exact: Boolean(blurByteExact),
        corrected_codewords: blurAttempt.correctedCodewords ?? null,
        contrast: blurAttempt.contrast ?? null,
        screen_fill_ratio: blurAttempt.screenFillRatio ?? null,
        decode_ms: round(blurDecodeMs, 3),
      },
    },
    accepted_unique_frames: progress.acceptedFrames,
    duplicate_frames: progress.duplicateFrames,
    rejected_frames: progress.rejectedFrames,
    recovered_rank: progress.rank,
    required_rank: progress.required,
    decode_p50_ms: round(p50, 3),
    decode_p95_ms: round(p95, 3),
    gates,
    passed,
  }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  await server.close();
}

function deterministicBytes(length) {
  let state = 0x6d2b_79f5;
  return Uint8Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  });
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio))];
}

function round(value, digits) {
  return Number(value.toFixed(digits));
}

function increment(counts, key) {
  counts[key] = (counts[key] ?? 0) + 1;
}
