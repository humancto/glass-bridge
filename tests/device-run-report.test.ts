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
  width: 1_280,
  height: 720,
  negotiatedFps: 60,
  cameraSeconds: 8.2,
  cameraFrames: 490,
  decodeJobs: 472,
  successfulDecodeJobs: 0,
  emptyDecodeJobs: 472,
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
