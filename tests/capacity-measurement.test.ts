import { describe, expect, it } from "vitest";
import { measureTransport } from "../src/receiver/capacity-measurement";
import type { TransferProgress } from "../src/receiver/transport";

const COMPLETE: TransferProgress = {
  rank: 88,
  required: 88,
  acceptedFrames: 96,
  duplicateFrames: 0,
  rejectedFrames: 0,
  complete: true,
  symbolSize: 1_688,
  payloadLength: 148_000,
  expectedFrames: 116,
};

describe("capacity measurement", () => {
  it("separates verified payload goodput from accepted optical code rate", () => {
    const result = measureTransport(144 * 1_024, 2.4, COMPLETE);
    expect(result.payloadBytesPerSecond).toBe(61_440);
    expect(result.acceptedCodesPerSecond).toBe(40);
    expect(result.acceptedSymbolBytesPerSecond).toBe(67_520);
    expect(result.requiredCodes).toBe(88);
    expect(result.observedCodes).toBe(96);
    expect(result.acceptanceRate).toBe(1);
    expect(result.fountainOverhead).toBeCloseTo(8 / 88);
    expect(result.payloadEfficiency).toBeCloseTo((144 * 1_024) / (96 * 1_688));
  });

  it("rejects incomplete or unbounded measurements", () => {
    expect(() => measureTransport(0, 2, COMPLETE)).toThrow("completed bounded transfer");
    expect(() => measureTransport(100, 0, COMPLETE)).toThrow("completed bounded transfer");
    expect(() => measureTransport(100, 2, { ...COMPLETE, acceptedFrames: 0 }))
      .toThrow("completed bounded transfer");
  });
});
