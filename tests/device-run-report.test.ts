import { readFile } from "node:fs/promises";
import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { classifyFailure, createDeviceRunFailureReport } from "../src/receiver/device-run-report";
import { gridAcquisitionGuidance } from "../src/receiver/grid-acquisition";

const camera = {
  cameraFps: 59.8,
  decodeFps: 0,
  medianDecodeMs: 5.1,
  p95DecodeMs: 7.2,
  busyDrops: 3,
  workers: 2,
  width: 960,
  height: 540,
  sourceWidth: 1_280,
  sourceHeight: 720,
  negotiatedFps: 60,
  cameraSeconds: 8.2,
  callbackFrames: 980,
  cameraFrames: 490,
  cameraExposures: 490,
  duplicateCallbacks: 490,
  submittedExposures: 472,
  decodeJobs: 472,
  successfulDecodeJobs: 0,
  emptyDecodeJobs: 472,
  throttledFrames: 18,
  rateLimitedExposures: 12,
  captureCopyP50Ms: 1.4,
  captureCopyP95Ms: 2.8,
  workerRoundTripP50Ms: 5.2,
  workerRoundTripP95Ms: 9.8,
  rgbaBytesPerSecond: 123_456_789,
  sameFrameReacquisitions: 6,
  sameFrameReacquisitionSuccesses: 4,
  sameFrameReacquisitionP50Ms: 8.4,
  sameFrameReacquisitionP95Ms: 12.7,
  gridOutcome: "markers-not-found" as const,
  gridFurthestPhyOutcome: "frame-magic-invalid" as const,
  gridOutcomeCounts: {
    decoded: 0,
    "invalid-image": 0,
    "markers-not-found": 320,
    "geometry-invalid": 12,
    "contrast-low": 8,
    "frame-magic-invalid": 132,
  },
  gridContrast: 22.4,
  gridScreenFillRatio: 0.31,
  gridCorrectedCodewords: 17,
  gridRegistrationReusePercent: 87.45,
  timeToFirstValidMs: 1_502.75,
};

describe("physical device failure reports", () => {
  it("exports failed runs with the bound channel and no-symbol acquisition evidence", () => {
    const report = createDeviceRunFailureReport({
      measuredAt: new Date("2026-08-16T20:00:00.000Z"),
      runId: "run-test-1",
      profileId: "grid",
      targetSymbolRate: 30,
      transferSession: "01020304",
      reason: "The Grid markers were not acquired.",
      sourceMode: "camera",
      progress: {
        rank: 0,
        required: 0,
        acceptedFrames: 0,
        duplicateFrames: 0,
        rejectedFrames: 0,
      },
      camera,
      device: "test-phone",
    });

    expect(report).toMatchObject({
      schema: "glassbridge-device-run/1",
      run_id: "run-test-1",
      outcome: "failed",
      source_mode: "camera",
      failure_class: "operator-or-environment-error",
      profile: {
        id: "grid",
        visual_phy: "mono-grid-v0",
        target_symbol_rate: 30,
      },
      camera: {
        exposures: 490,
        callback_frames: 980,
        camera_exposures: 490,
        duplicate_callbacks: 490,
        submitted_exposures: 472,
        decode_jobs: 472,
        empty_decode_jobs: 472,
        optical_acquisition_percent: 0,
        width: 960,
        height: 540,
        source_width: 1_280,
        source_height: 720,
        rate_limited_exposures: 12,
        capture_copy_p50_ms: 1.4,
        capture_copy_p95_ms: 2.8,
        worker_round_trip_p50_ms: 5.2,
        worker_round_trip_p95_ms: 9.8,
        rgba_bytes_per_second: 123_456_789,
        same_frame_reacquisitions: 6,
        same_frame_reacquisition_successes: 4,
        same_frame_reacquisition_p50_ms: 8.4,
        same_frame_reacquisition_p95_ms: 12.7,
        sampling_status: "oversampled",
        grid_last_outcome: "markers-not-found",
        grid_furthest_phy_outcome: "frame-magic-invalid",
        grid_outcome_counts: {
          decoded: 0,
          "invalid-image": 0,
          "markers-not-found": 320,
          "geometry-invalid": 12,
          "contrast-low": 8,
          "frame-magic-invalid": 132,
        },
        grid_contrast: 22.4,
        grid_screen_fill_percent: 31,
        grid_corrected_codewords: 17,
        grid_registration_reuse_percent: 87.5,
        time_to_first_valid_ms: 1_502.8,
      },
    });
  });

  it("uses stable failure classes for the major pipeline stages", () => {
    expect(classifyFailure("Camera unavailable: permission denied")).toBe("camera-error");
    expect(classifyFailure("Live camera scanning requires the HTTPS receiver page.")).toBe("camera-error");
    expect(classifyFailure("Optical decoder unavailable: WASM failed")).toBe("decode-error");
    expect(classifyFailure("paired to a different transfer session")).toBe("session-mismatch");
    expect(classifyFailure("Not enough independent frames: rank 4 of 20")).toBe("rank-incomplete");
    expect(classifyFailure("Signature verification failed")).toBe("verification-or-policy-error");
    expect(classifyFailure("Operator stopped camera scanning before verification.")).toBe("operator-or-environment-error");
    expect(classifyFailure("Operator stopped saved-frame decoding before verification.")).toBe("operator-or-environment-error");
  });

  it("does not misclassify Grid acquisition guidance as a camera API failure", () => {
    for (const outcome of [
      "markers-not-found",
      "geometry-invalid",
      "contrast-low",
      "frame-magic-invalid",
      "decoded",
    ] as const) {
      expect(classifyFailure(gridAcquisitionGuidance(outcome))).toBe("operator-or-environment-error");
    }
    expect(classifyFailure(gridAcquisitionGuidance("invalid-image"))).toBe("camera-error");
  });

  it("publishes a machine-readable schema for failed physical runs", async () => {
    const schema = JSON.parse(await readFile(
      new URL("../spec/glassbridge-device-run-1.schema.json", import.meta.url),
      "utf8",
    )) as {
      properties: {
        schema: { const: string };
        camera: { properties: Record<string, unknown> };
      };
      required: string[];
    };
    expect(schema.properties.schema.const).toBe("glassbridge-device-run/1");
    expect(schema.required).toContain("failure_class");
    expect(schema.required).toContain("source_mode");
    expect(schema.required).toContain("camera");
    expect(schema.properties.camera.properties).toHaveProperty("callback_frames");
    expect(schema.properties.camera.properties).toHaveProperty("worker_round_trip_p95_ms");
    expect(schema.properties.camera.properties).toHaveProperty("same_frame_reacquisitions");

    const report = createDeviceRunFailureReport({
      measuredAt: new Date("2026-08-16T20:00:00.000Z"),
      runId: "run-schema-1",
      profileId: "grid",
      targetSymbolRate: 30,
      transferSession: "01020304",
      reason: "Operator stopped camera scanning before verification.",
      sourceMode: "camera",
      progress: {
        rank: 0,
        required: 73,
        acceptedFrames: 0,
        duplicateFrames: 0,
        rejectedFrames: 0,
      },
      camera,
      device: "test-phone",
    });
    const validate = new Ajv2020({ allErrors: true, strict: true, validateFormats: false })
      .compile(schema);
    expect(validate(JSON.parse(JSON.stringify(report))), JSON.stringify(validate.errors, null, 2))
      .toBe(true);
  });
});
