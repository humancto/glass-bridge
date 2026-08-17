import { describe, expect, it } from "vitest";
import {
  classifyOpticalCodeCandidate,
  didTransportAcceptFrame,
  isOpticalBinaryFrameCandidate,
  isOpticalTextFrameCandidate,
} from "../src/receiver/decode-metrics";
import type { TransferProgress } from "../src/receiver/transport";

const baseline: TransferProgress = {
  rank: 0,
  required: 4,
  acceptedFrames: 0,
  duplicateFrames: 0,
  rejectedFrames: 0,
  complete: false,
  symbolSize: 512,
  payloadLength: 1_500,
  expectedFrames: 6,
};

describe("transport-valid acquisition metrics", () => {
  it("counts accepted and duplicate AGF frames, never parser/CRC rejects", () => {
    expect(didTransportAcceptFrame(baseline, {
      ...baseline,
      acceptedFrames: 1,
    })).toBe(true);
    expect(didTransportAcceptFrame(baseline, {
      ...baseline,
      duplicateFrames: 1,
    })).toBe(true);
    expect(didTransportAcceptFrame(baseline, {
      ...baseline,
      rejectedFrames: 1,
      rejectionReason: "invalid-frame",
    })).toBe(false);
    expect(didTransportAcceptFrame(baseline, baseline)).toBe(false);
  });

  it("distinguishes text transport frames from pairing and unrelated QR values", () => {
    const legacyText = `AGF1B64:${"A".repeat(80)}`;
    const legacyBytes = new TextEncoder().encode(legacyText);
    expect(isOpticalTextFrameCandidate(legacyText)).toBe(true);
    expect(isOpticalBinaryFrameCandidate(legacyBytes)).toBe(false);
    expect(classifyOpticalCodeCandidate(legacyBytes, legacyText)).toEqual({
      kind: "text",
      value: legacyText,
    });
    expect(isOpticalTextFrameCandidate("https://glassbridge.test/receive.html#v=4")).toBe(false);
    expect(isOpticalTextFrameCandidate("hello from an unrelated QR")).toBe(false);
    expect(isOpticalTextFrameCandidate(undefined)).toBe(false);
  });
});
