import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import { expectedLtFrames, ltFrameIndices } from "../src/protocol/lt-codec";
import { nominalGoodputBytes, OPTICAL_PROFILES } from "../src/protocol/optical-profile";
import { OpticalTransferDecoder } from "../src/receiver/transport";
import { OpticalTransferEncoder } from "../src/sender/transport";

describe("Turbo optical transport", () => {
  it("defaults to a dual-lane Burst budget that holds each QR for two refreshes", () => {
    const burst = OPTICAL_PROFILES.burst;
    expect(burst.lanes).toBe(2);
    expect(burst.symbolSize).toBe(1_688);
    expect(burst.defaultFps).toBe(60);
    expect(nominalGoodputBytes(burst, burst.defaultFps)).toBe(101_280);

    const encoder = new OpticalTransferEncoder(deterministicBytes(144 * 1_024), {
      sessionId: Uint8Array.from({ length: 16 }, (_, index) => index),
      symbolSize: burst.symbolSize,
      codec: burst.codec,
    });
    const frame = encoder.frameBytes(0);
    const qr = QRCode.create([{ data: frame, mode: "byte" }], {
      version: burst.qrVersion,
      maskPattern: burst.maskPattern,
      errorCorrectionLevel: burst.errorCorrectionLevel,
    });
    expect(frame).toHaveLength(1_732);
    expect(qr.version).toBe(30);
  });

  it("has enough raw channel capacity to challenge the 128 KiB/s reference", () => {
    const turbo = OPTICAL_PROFILES.turbo;
    expect(turbo.symbolSize).toBe(2_900);
    expect(turbo.defaultFps).toBe(60);
    expect(turbo.maskPattern).toBe(4);
    expect(nominalGoodputBytes(turbo, turbo.defaultFps)).toBe(174_000);
    expect(nominalGoodputBytes(turbo, turbo.defaultFps) / 1_024).toBeGreaterThan(128);
  });

  it("fits an AGF2 frame exactly into a fixed version 40-L QR", () => {
    const turbo = OPTICAL_PROFILES.turbo;
    const encoder = makeEncoder(deterministicBytes(128 * 1_024));
    const qr = QRCode.create(
      [{ data: encoder.frameBytes(0), mode: "byte" }],
      {
        version: turbo.qrVersion,
        maskPattern: turbo.maskPattern,
        errorCorrectionLevel: turbo.errorCorrectionLevel,
      },
    );
    expect(encoder.frameBytes(0).length).toBe(2_944);
    expect(qr.version).toBe(40);
  });

  it("reconstructs after source-frame erasures using an endless sparse repair stream", () => {
    const payload = deterministicBytes(144 * 1_024);
    const encoder = makeEncoder(payload);
    const decoder = new OpticalTransferDecoder();
    let reconstructed: Uint8Array | undefined;

    // Simulate a receiver that misses every fourth systematic frame.
    for (let symbolId = 0; symbolId < encoder.sourceCount; symbolId += 1) {
      if (symbolId % 4 === 0) continue;
      reconstructed = decoder.ingestFrame(encoder.frameBytes(symbolId)).envelope;
    }
    for (
      let symbolId = encoder.sourceCount;
      !reconstructed && symbolId < encoder.sourceCount * 8;
      symbolId += 1
    ) {
      if (symbolId % 7 === 0) continue;
      reconstructed = decoder.ingestFrame(encoder.frameBytes(symbolId)).envelope;
    }

    expect(reconstructed).toEqual(payload);
    expect(decoder.snapshot().codec).toBe("lt-v2");
  });

  it("generates deterministic sparse equations and an explicit solve estimate", () => {
    const session = Uint8Array.from({ length: 16 }, (_, index) => index);
    expect(ltFrameIndices(session, 12, 12)).toEqual([6]);
    expect(ltFrameIndices(session, 12, 12)).toEqual(ltFrameIndices(session, 12, 12));
    expect(expectedLtFrames(64)).toBeGreaterThan(64);
    expect(expectedLtFrames(64)).toBeLessThanOrEqual(96);
  });
});

function makeEncoder(payload: Uint8Array): OpticalTransferEncoder {
  const profile = OPTICAL_PROFILES.turbo;
  return new OpticalTransferEncoder(payload, {
    sessionId: Uint8Array.from({ length: 16 }, (_, index) => (index * 13 + 7) & 0xff),
    symbolSize: profile.symbolSize,
    codec: profile.codec,
  });
}

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff);
}
