import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import {
  CAPACITY_HISTORY_KEY,
  CAPACITY_HISTORY_LIMIT,
  assessCameraSampling,
  compareCapacityReport,
  createCapacityReport,
  opticalFrameRate,
  readCapacityHistory,
  storeCapacityReport,
  type CapacityReport,
} from "../src/receiver/capacity-report";
import { measureTransport } from "../src/receiver/capacity-measurement";

const measurement = measureTransport(144 * 1_024, 2.4, {
  rank: 88,
  required: 88,
  acceptedFrames: 96,
  duplicateFrames: 3,
  rejectedFrames: 7,
  complete: true,
  symbolSize: 1_688,
  payloadLength: 148_000,
  expectedFrames: 116,
});

const camera = {
  cameraFps: 30,
  decodeFps: 40,
  medianDecodeMs: 4.25,
  p95DecodeMs: 8.5,
  busyDrops: 2,
  workers: 4,
  width: 1_280,
  height: 720,
  sourceWidth: 1_920,
  sourceHeight: 1_080,
  negotiatedFps: 60,
  cameraSeconds: 3.2,
  callbackFrames: 192,
  cameraFrames: 96,
  cameraExposures: 96,
  duplicateCallbacks: 96,
  submittedExposures: 90,
  decodeJobs: 120,
  successfulDecodeJobs: 82,
  emptyDecodeJobs: 38,
  uniqueFps: 31.25,
  duplicateFps: 3.75,
  throttledFrames: 18,
  rateLimitedExposures: 6,
  captureCopyP50Ms: 1.25,
  captureCopyP95Ms: 2.75,
  workerRoundTripP50Ms: 5.5,
  workerRoundTripP95Ms: 9.25,
  rgbaBytesPerSecond: 124_416_000,
  sameFrameReacquisitions: 4,
  sameFrameReacquisitionSuccesses: 3,
  sameFrameReacquisitionP50Ms: 8.1,
  sameFrameReacquisitionP95Ms: 11.4,
  gridOutcome: "decoded" as const,
  gridContrast: 181.4,
  gridScreenFillRatio: 0.539,
  gridCorrectedCodewords: 0,
  gridRegistrationReusePercent: 93.75,
  timeToFirstValidMs: 864.25,
};

function report(goodput?: number): CapacityReport {
  const value = createCapacityReport({
    measuredAt: new Date("2026-08-05T01:02:03.000Z"),
    profileId: "burst",
    targetSymbolRate: 60,
    transferSession: "09090909",
    fileBytes: 144 * 1_024,
    payloadSha256: "ab".repeat(32),
    measurement,
    opticalPayload: {
      encoding: "gzip",
      originalBytes: 148_000,
      transmittedBytes: 32_000,
    },
    camera,
    cameraToVerifiedSeconds: 3.5,
    opticalFrameWindowSeconds: 2,
    device: "test-phone",
  });
  return goodput === undefined ? value : {
    ...value,
    verified_payload_bytes_per_second: goodput,
  };
}

describe("post-receive capacity reports", () => {
  it("records comparable transfer, optical, and camera metrics", () => {
    const value = report();
    expect(value.schema).toBe("glassbridge-capacity/5");
    expect(value.run_id).toMatch(/^[0-9a-f-]{36}$/u);
    expect(value.source_mode).toBe("camera");
    expect(value.profile).toMatchObject({ id: "burst", label: "Burst", lanes: 2, qr_version: 30, visual_phy: "qr-model2-v1", target_symbol_rate: 60 });
    expect(value.transfer_seconds).toBe(2.4);
    expect(value.payload_sha256).toBe("ab".repeat(32));
    expect(value.verified_payload_bytes_per_second).toBe(61_440);
    expect(value.camera_to_verified_seconds).toBe(3.5);
    expect(value.camera_to_verified_payload_bytes_per_second).toBe(42_130);
    expect(value.accepted_symbol_bytes_per_second).toBe(67_520);
    expect(value.optical_frame_window_seconds).toBe(2);
    expect(value.optical_accepted_codes_per_second).toBe(47.5);
    expect(value.optical_accepted_symbol_bytes_per_second).toBe(80_180);
    expect(value.decoded_acceptance_percent).toBe(90.6);
    expect(value.camera).toMatchObject({ observed_fps: 30, decode_p95_ms: 8.5, busy_drops: 2, source_width: 1_920, source_height: 1_080, time_to_first_valid_ms: 864.3 });
    expect(value.camera).toMatchObject({
      callback_frames: 192,
      camera_exposures: 96,
      duplicate_callbacks: 96,
      submitted_exposures: 90,
      decode_jobs: 120,
      empty_decode_jobs: 38,
      optical_acquisition_percent: 68.3,
    });
    expect(value.camera).toMatchObject({
      unique_codes_per_second: 31.25,
      duplicate_codes_per_second: 3.75,
      rate_limited_exposures: 6,
      capture_copy_p50_ms: 1.25,
      capture_copy_p95_ms: 2.75,
      worker_round_trip_p50_ms: 5.5,
      worker_round_trip_p95_ms: 9.25,
      rgba_bytes_per_second: 124_416_000,
      same_frame_reacquisitions: 4,
      same_frame_reacquisition_successes: 3,
      same_frame_reacquisition_p50_ms: 8.1,
      same_frame_reacquisition_p95_ms: 11.4,
      sampling_ratio: 1,
      sampling_status: "single-sampled",
      grid_last_outcome: "decoded",
      grid_contrast: 181.4,
      grid_screen_fill_percent: 53.9,
      grid_corrected_codewords: 0,
      grid_registration_reuse_percent: 93.8,
    });
    expect(value.transport).toEqual({
      encoding: "gzip",
      signed_envelope_bytes: 148_000,
      optical_object_bytes: 32_000,
      optical_reduction_percent: 78.4,
    });
  });

  it("uses the interval between accepted optical frames without inflating small samples", () => {
    expect(opticalFrameRate(96, 1_688, 2)).toEqual({
      codesPerSecond: 47.5,
      symbolBytesPerSecond: 80_180,
    });
    expect(opticalFrameRate(1, 1_688, 2)).toEqual({});
    expect(opticalFrameRate(2, 1_688, 0)).toEqual({});
  });

  it("allows compression-inclusive payload efficiency above 100 percent", async () => {
    const compressedMeasurement = measureTransport(2_000, 1, {
      rank: 1,
      required: 1,
      acceptedFrames: 1,
      duplicateFrames: 0,
      rejectedFrames: 0,
      complete: true,
      symbolSize: 1_000,
      payloadLength: 900,
      expectedFrames: 2,
    });
    expect(compressedMeasurement.payloadEfficiency).toBe(2);

    const schema = JSON.parse(await readFile(
      new URL("../spec/glassbridge-capacity-5.schema.json", import.meta.url),
      "utf8",
    )) as { properties: { payload_efficiency_percent: Record<string, unknown> } };
    expect(schema.properties.payload_efficiency_percent.minimum).toBe(0);
    expect(schema.properties.payload_efficiency_percent).not.toHaveProperty("maximum");
  });

  it("classifies camera sampling against per-lane sender exposure cadence", () => {
    expect(assessCameraSampling(60, 60, 2)).toMatchObject({
      ratio: 2,
      status: "oversampled",
    });
    expect(assessCameraSampling(27, 60, 2)).toMatchObject({
      ratio: 0.9,
      status: "single-sampled",
    });
    expect(assessCameraSampling(20, 60, 2)).toMatchObject({
      status: "undersampled",
    });
    expect(assessCameraSampling(30)).toEqual({ status: "unknown" });
  });

  it("compares only like-for-like browser identities, channels, rates, and payloads", () => {
    const balanced = {
      ...report(70_000),
      profile: { id: "balanced" as const, label: "Balanced", lanes: 1 },
    };
    const differentSize = { ...report(80_000), file_bytes: 159 };
    const differentPayload = { ...report(90_000), payload_sha256: "cd".repeat(32) };
    const differentRate = { ...report(91_000), profile: { ...report().profile, target_symbol_rate: 120 } };
    const differentDevice = { ...report(92_000), device: "other-phone" };
    const current = { ...report(66_000), camera_to_verified_payload_bytes_per_second: 44_000 };
    const previousOne = { ...report(60_000), camera_to_verified_payload_bytes_per_second: 40_000 };
    const previousTwo = { ...report(62_000), camera_to_verified_payload_bytes_per_second: 42_000 };
    const comparison = compareCapacityReport(current, [previousOne, balanced, differentSize, differentPayload, differentRate, differentDevice, previousTwo]);
    expect(comparison.runNumber).toBe(3);
    expect(comparison.previousGoodput).toBe(42_000);
    expect(comparison.previousAcceptedCodesPerSecond).toBe(47.5);
    expect(comparison.bestGoodputBefore).toBe(42_000);
    expect(comparison.bestAcceptedCodesPerSecond).toBe(47.5);
    expect(comparison.changeFromPrevious).toBeCloseTo(44 / 42 - 1);
    expect(comparison.isNewBest).toBe(true);
  });

  it("keeps a bounded, corruption-tolerant on-device history", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    for (let index = 0; index < CAPACITY_HISTORY_LIMIT + 4; index += 1) {
      storeCapacityReport(storage, report(50_000 + index));
    }
    expect(readCapacityHistory(storage)).toHaveLength(CAPACITY_HISTORY_LIMIT);
    values.set(CAPACITY_HISTORY_KEY, "not-json");
    expect(readCapacityHistory(storage)).toEqual([]);
  });

  it("publishes a machine-readable schema for successful physical runs", async () => {
    const schema = JSON.parse(await readFile(
      new URL("../spec/glassbridge-capacity-5.schema.json", import.meta.url),
      "utf8",
    )) as {
      properties: {
        schema: { const: string };
        camera: { properties: Record<string, unknown> };
      };
      required: string[];
    };
    expect(schema.properties.schema.const).toBe("glassbridge-capacity/5");
    expect(schema.required).toContain("payload_sha256");
    expect(schema.required).toContain("run_id");
    expect(schema.required).toContain("source_mode");
    expect(schema.required).toContain("camera");
    expect(schema.properties.camera.properties).toHaveProperty("camera_exposures");
    expect(schema.properties.camera.properties).toHaveProperty("capture_copy_p95_ms");
    expect(schema.properties.camera.properties).toHaveProperty("worker_round_trip_p95_ms");
    expect(schema.properties.camera.properties).toHaveProperty("same_frame_reacquisitions");
    expect(schema.properties.camera.properties).toHaveProperty("sampling_status");

    const validate = new Ajv2020({ allErrors: true, strict: true, validateFormats: false })
      .compile(schema);
    const exported = JSON.parse(JSON.stringify(report()));
    expect(validate(exported), JSON.stringify(validate.errors, null, 2)).toBe(true);
  });
});
