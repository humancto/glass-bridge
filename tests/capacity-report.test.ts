import { describe, expect, it } from "vitest";
import {
  CAPACITY_HISTORY_KEY,
  CAPACITY_HISTORY_LIMIT,
  compareCapacityReport,
  createCapacityReport,
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
  cameraFps: 59.94,
  decodeFps: 40,
  medianDecodeMs: 4.25,
  p95DecodeMs: 8.5,
  busyDrops: 2,
  workers: 4,
  width: 1_280,
  height: 720,
  negotiatedFps: 60,
  cameraSeconds: 3.2,
  cameraFrames: 192,
  decodeJobs: 120,
  successfulDecodeJobs: 82,
  emptyDecodeJobs: 38,
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
    expect(value.schema).toBe("glassbridge-capacity/4");
    expect(value.profile).toMatchObject({ id: "burst", label: "Burst", lanes: 2, qr_version: 30, visual_phy: "qr-model2-v1", target_symbol_rate: 60 });
    expect(value.transfer_seconds).toBe(2.4);
    expect(value.payload_sha256).toBe("ab".repeat(32));
    expect(value.verified_payload_bytes_per_second).toBe(61_440);
    expect(value.accepted_symbol_bytes_per_second).toBe(67_520);
    expect(value.decoded_acceptance_percent).toBe(90.6);
    expect(value.camera).toMatchObject({ observed_fps: 59.94, decode_p95_ms: 8.5, busy_drops: 2 });
    expect(value.camera).toMatchObject({ camera_exposures: 192, decode_jobs: 120, empty_decode_jobs: 38, optical_acquisition_percent: 68.3 });
    expect(value.transport).toEqual({
      encoding: "gzip",
      signed_envelope_bytes: 148_000,
      optical_object_bytes: 32_000,
      optical_reduction_percent: 78.4,
    });
  });

  it("compares only like-for-like devices, channels, rates, and payloads", () => {
    const balanced = {
      ...report(70_000),
      profile: { id: "balanced" as const, label: "Balanced", lanes: 1 },
    };
    const differentSize = { ...report(80_000), file_bytes: 159 };
    const differentPayload = { ...report(90_000), payload_sha256: "cd".repeat(32) };
    const differentRate = { ...report(91_000), profile: { ...report().profile, target_symbol_rate: 120 } };
    const differentDevice = { ...report(92_000), device: "other-phone" };
    const comparison = compareCapacityReport(report(66_000), [report(60_000), balanced, differentSize, differentPayload, differentRate, differentDevice, report(62_000)]);
    expect(comparison.runNumber).toBe(3);
    expect(comparison.previousGoodput).toBe(62_000);
    expect(comparison.previousAcceptedCodesPerSecond).toBe(40);
    expect(comparison.bestGoodputBefore).toBe(62_000);
    expect(comparison.bestAcceptedCodesPerSecond).toBe(40);
    expect(comparison.changeFromPrevious).toBeCloseTo(66 / 62 - 1);
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
});
