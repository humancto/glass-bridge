import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { classifyFailure, createDeviceRunFailureReport } from "../src/receiver/device-run-report";

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
  cameraFrames: 490,
  decodeJobs: 472,
  successfulDecodeJobs: 0,
  emptyDecodeJobs: 472,
  throttledFrames: 18,
  gridOutcome: "markers-not-found" as const,
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
      failure_class: "operator-or-environment-error",
      profile: {
        id: "grid",
        visual_phy: "mono-grid-v0",
        target_symbol_rate: 30,
      },
      camera: {
        exposures: 490,
        decode_jobs: 472,
        empty_decode_jobs: 472,
        optical_acquisition_percent: 0,
        width: 960,
        height: 540,
        source_width: 1_280,
        source_height: 720,
        rate_limited_exposures: 18,
        grid_last_outcome: "markers-not-found",
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
    expect(classifyFailure("Optical decoder unavailable: WASM failed")).toBe("decode-error");
    expect(classifyFailure("paired to a different transfer session")).toBe("session-mismatch");
    expect(classifyFailure("Not enough independent frames: rank 4 of 20")).toBe("rank-incomplete");
    expect(classifyFailure("Signature verification failed")).toBe("verification-or-policy-error");
  });

  it("publishes a machine-readable schema for failed physical runs", async () => {
    const schema = JSON.parse(await readFile(
      new URL("../spec/glassbridge-device-run-1.schema.json", import.meta.url),
      "utf8",
    )) as { properties: { schema: { const: string } }; required: string[] };
    expect(schema.properties.schema.const).toBe("glassbridge-device-run/1");
    expect(schema.required).toContain("failure_class");
    expect(schema.required).toContain("camera");
  });
});
