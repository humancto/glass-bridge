import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { arch, availableParallelism, cpus, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { createServer } from "vite";

const root = process.cwd();
const options = parseArguments(process.argv.slice(2));
if (options.help) {
  console.log(`Usage: node scripts/benchmark-grid-acquisition.mjs [--output <path>]

Runs the deterministic synthetic Grid acquisition workload. When --output is
provided, the exact JSON printed to stdout is also written to that path.`);
  process.exit(0);
}

const benchmarkSources = [
  "package.json",
  "package-lock.json",
  "scripts/benchmark-grid-acquisition.mjs",
  "src/phy/grid/grid-codec.ts",
  "src/protocol/lt-codec.ts",
  "src/protocol/optical-profile.ts",
  "src/receiver/transport.ts",
  "src/sender/transport.ts",
  "tests/fixtures/grid-camera-sim.ts",
];
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
  const correctnessGates = {
    stable_decode_percent: stableDecoded / encoder.sourceCount * 100,
    transfer_reconstructed: progress.complete,
    payload_byte_exact: progress.envelope ? equalBytes(progress.envelope, deterministicBytes(144 * 1_024)) : false,
    high_fill_blur_probe_byte_exact: Boolean(blurByteExact),
  };
  const syntheticModelGates = {
    expected_solve_window_below_3_5_seconds: expectedFrames / 30 < 3.5,
  };
  const correctnessPassed = correctnessGates.stable_decode_percent === 100 &&
    correctnessGates.transfer_reconstructed &&
    correctnessGates.payload_byte_exact &&
    correctnessGates.high_fill_blur_probe_byte_exact;
  const syntheticModelPassed = syntheticModelGates.expected_solve_window_below_3_5_seconds;
  const passed = correctnessPassed && syntheticModelPassed;
  const report = {
    schema: "glassbridge-grid-acquisition-benchmark/2",
    recorded_at_utc: new Date().toISOString(),
    evidence_classification: {
      kind: "deterministic-synthetic-camera-simulation",
      physical_camera_path_exercised: false,
      suitable_for: [
        "byte-exact decoder regression detection",
        "synthetic acquisition and transition-tear regression detection",
        "host-specific decoder timing comparison when the environment is held constant",
      ],
      not_evidence_of: [
        "phone-camera goodput",
        "display-to-camera reliability",
        "physical transfer completion time",
        "performance superiority over another optical transport",
      ],
    },
    invocation: {
      command: "npm run benchmark:grid-acquisition -- --output benchmarks/grid-acquisition-reference.json",
      output_path: options.output ? options.output : null,
    },
    build_identity: await buildIdentity(root, benchmarkSources),
    host_environment: hostEnvironment(),
    scope: "deterministic 144 KiB Grid30 camera simulation; fractional perspective, bilinear resampling, mild moire, colored UI distractors, one transition tear per stable epoch, plus a high-fill blur probe",
    workload: {
      payload_bytes: 144 * 1_024,
      payload_generator: "xorshift32 seed 0x6d2b79f5",
      session_id_generator: "byte[index] = (index * 19 + 7) & 0xff for 16 bytes",
      profile: {
        id: profile.id,
        codec: profile.codec,
        visual_phy: profile.visualPhy,
        symbol_bytes: profile.symbolSize,
        modeled_symbols_per_second: 30,
      },
      stable_camera_simulation: {
        raster_width: 960,
        raster_height: 540,
        brightness: 0.9,
        moire_amplitude: "3 on every third source symbol; otherwise 0",
        fractional_perspective: true,
        bilinear_resampling: true,
        colored_ui_distractors: true,
      },
      transition_tear: {
        one_per_stable_epoch_after_first: true,
        row_split_ratio: 0.47,
      },
      high_fill_blur_probe: {
        source_symbol_id: 41,
        raster_width: blurCamera.width,
        raster_height: blurCamera.height,
        brightness: blurCamera.brightness,
        moire_amplitude: blurCamera.moireAmplitude,
        box_blur_radius: blurCamera.blurRadius,
      },
    },
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
    correctness_gates: correctnessGates,
    synthetic_model_gates: syntheticModelGates,
    host_timing_observations: {
      advisory_only: true,
      affects_process_exit: false,
      decode_p50_ms: round(p50, 3),
      decode_p95_ms: round(p95, 3),
      single_worker_60fps_budget_ms: round(singleWorkerExposureBudgetMs, 3),
      p95_below_single_worker_60fps_budget: p95 < singleWorkerExposureBudgetMs,
      note: "Host timing is not a correctness gate and is comparable only across materially identical environments.",
    },
    correctness_passed: correctnessPassed,
    synthetic_model_passed: syntheticModelPassed,
    passed,
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (options.output) {
    const outputPath = resolve(root, options.output);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, serialized, "utf8");
  }
  process.stdout.write(serialized);
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

function parseArguments(args) {
  const options = { output: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--output") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--output requires a path");
      }
      options.output = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--output=")) {
      const value = argument.slice("--output=".length);
      if (!value) throw new Error("--output requires a path");
      options.output = value;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

async function buildIdentity(repositoryRoot, sourceFiles) {
  const commit = gitValue(repositoryRoot, ["rev-parse", "HEAD"]);
  const repositoryStatus = gitValue(repositoryRoot, ["status", "--porcelain=v1", "--untracked-files=no"]);
  const sourceStatus = gitValue(repositoryRoot, ["status", "--porcelain=v1", "--", ...sourceFiles]);
  return {
    git_commit: commit,
    git_worktree_dirty: repositoryStatus === null ? null : repositoryStatus.length > 0,
    git_worktree_scope: "tracked files before writing the output artifact; untracked files excluded",
    benchmark_sources_dirty: sourceStatus === null ? null : sourceStatus.length > 0,
    benchmark_sources_sha256: await fingerprintFiles(repositoryRoot, sourceFiles),
    benchmark_sources: sourceFiles,
    note: "The source fingerprint identifies the exact benchmark-relevant bytes even when the Git worktree is dirty.",
  };
}

function hostEnvironment() {
  const processors = cpus();
  return {
    node: process.version,
    v8: process.versions.v8,
    platform: platform(),
    os_release: release(),
    architecture: arch(),
    logical_cpu_count: processors.length,
    available_parallelism: availableParallelism(),
    cpu_model: processors[0]?.model ?? "unknown",
    total_memory_bytes: totalmem(),
    hostname_recorded: false,
  };
}

function gitValue(repositoryRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (result.status !== 0) return null;
  return result.stdout.trim();
}

async function fingerprintFiles(repositoryRoot, sourceFiles) {
  const digest = createHash("sha256");
  for (const sourceFile of [...sourceFiles].sort()) {
    const bytes = await readFile(resolve(repositoryRoot, sourceFile));
    digest.update(sourceFile, "utf8");
    digest.update("\0", "utf8");
    digest.update(String(bytes.length), "utf8");
    digest.update("\0", "utf8");
    digest.update(bytes);
  }
  return digest.digest("hex");
}
