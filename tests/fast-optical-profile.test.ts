import { ResultMetadataType } from "@zxing/library";
import QRCode from "qrcode";
import { describe, expect, it } from "vitest";
import {
  nominalGoodputBytes,
  OPTICAL_PROFILES,
} from "../src/protocol/optical-profile";
import { ingestDecodedQr, type DecodedQrResult } from "../src/receiver/qr-result";
import { OpticalTransferDecoder } from "../src/receiver/transport";
import { scheduleNextFrame } from "../src/sender/scheduler";
import { OpticalTransferEncoder } from "../src/sender/transport";

describe("fast browser optical profile", () => {
  it("reduces the 144 KiB ideal path from 72 seconds to 8 seconds", () => {
    const payloadBytes = 144 * 1_024;
    const legacy = OPTICAL_PROFILES.legacy;
    const fast = OPTICAL_PROFILES.fast;

    expect(Math.ceil(payloadBytes / legacy.symbolSize) / legacy.defaultFps).toBe(72);
    expect(Math.ceil(payloadBytes / fast.symbolSize) / fast.defaultFps).toBe(8);
    expect(nominalGoodputBytes(fast, fast.defaultFps)).toBe(18 * 1_024);
  });

  it("uses a smaller QR for binary fast frames than base64 text", () => {
    const payload = deterministicBytes(150 * 1_024);
    const encoder = new OpticalTransferEncoder(payload, {
      sessionId: new Uint8Array(16).fill(0x47),
      symbolSize: OPTICAL_PROFILES.fast.symbolSize,
    });
    const binaryVersion = QRCode.create(
      [{ data: encoder.frameBytes(0), mode: "byte" }],
      { errorCorrectionLevel: "M" },
    ).version;
    const textVersion = QRCode.create(
      encoder.frameText(0),
      { errorCorrectionLevel: "M" },
    ).version;

    expect(binaryVersion).toBe(33);
    expect(textVersion).toBe(39);
  });

  it("round-trips binary QR byte segments through the receiver", () => {
    const payload = deterministicBytes(144 * 1_024);
    const encoder = new OpticalTransferEncoder(payload, {
      sessionId: new Uint8Array(16).fill(0x2a),
      symbolSize: OPTICAL_PROFILES.fast.symbolSize,
    });
    const decoder = new OpticalTransferDecoder();
    let reconstructed: Uint8Array | undefined;

    for (let symbolId = 0; symbolId < encoder.sourceCount; symbolId += 1) {
      const frame = encoder.frameBytes(symbolId);
      const result: DecodedQrResult = {
        getText: () => "binary QR payload",
        getResultMetadata: () => new Map([
          [ResultMetadataType.BYTE_SEGMENTS, [frame]],
        ]),
      };
      reconstructed = ingestDecodedQr(result, decoder).envelope;
    }

    expect(reconstructed).toEqual(payload);
  });

  it("keeps milestone 9 text frames interoperable", () => {
    const payload = deterministicBytes(2_048);
    const encoder = new OpticalTransferEncoder(payload, {
      sessionId: new Uint8Array(16).fill(0x11),
      symbolSize: OPTICAL_PROFILES.legacy.symbolSize,
    });
    const decoder = new OpticalTransferDecoder();
    let reconstructed: Uint8Array | undefined;

    for (let symbolId = 0; symbolId < encoder.sourceCount; symbolId += 1) {
      const text = encoder.frameText(symbolId);
      const result: DecodedQrResult = {
        getText: () => text,
        getResultMetadata: () => new Map([
          [ResultMetadataType.BYTE_SEGMENTS, [new TextEncoder().encode(text)]],
        ]),
      };
      reconstructed = ingestDecodedQr(result, decoder).envelope;
    }

    expect(reconstructed).toEqual(payload);
  });
});

describe("deadline-based sender scheduling", () => {
  it("does not add render time to every frame interval", () => {
    const schedule = scheduleNextFrame(1_000, 1_020, 10);
    expect(schedule.deadlineMs).toBe(1_100);
    expect(schedule.delayMs).toBe(80);
  });

  it("recovers once when rendering falls more than a frame behind", () => {
    const recovered = scheduleNextFrame(1_000, 1_250, 10);
    expect(recovered).toEqual({ deadlineMs: 1_250, delayMs: 0 });
    const next = scheduleNextFrame(recovered.deadlineMs, 1_260, 10);
    expect(next).toEqual({ deadlineMs: 1_350, delayMs: 90 });
  });

  it("rejects non-finite scheduling input", () => {
    expect(() => scheduleNextFrame(1_000, 1_020, Number.NaN)).toThrow("positive FPS");
  });
});

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff);
}
