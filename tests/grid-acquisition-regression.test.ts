import { describe, expect, it } from "vitest";
import {
  decodeGridFrame,
  renderGridFrame,
  tryDecodeGridFrame,
  type PixelBuffer,
} from "../src/phy/grid/grid-codec";
import { expectedLtFrames } from "../src/protocol/lt-codec";
import { OPTICAL_PROFILES } from "../src/protocol/optical-profile";
import { OpticalTransferDecoder } from "../src/receiver/transport";
import { OpticalTransferEncoder } from "../src/sender/transport";
import {
  cameraRegistration,
  makeCameraScene,
  transitionTear,
  type CameraSceneOptions,
} from "./fixtures/grid-camera-sim";

const GRID30_TARGET = 30;
const CAPACITY_BYTES = 144 * 1_024;
const SESSION = Uint8Array.from({ length: 16 }, (_, index) => (index * 19 + 7) & 0xff);

describe("Grid30 camera-acquisition regression gates", () => {
  it("keeps the camera simulator byte-exact with known registration", () => {
    const encoder = makeCapacityEncoder();
    const expected = encoder.frameBytes(17);
    const source = renderGridFrame(expected);
    const scene = makeCameraScene(source, {
      brightness: 0.9,
      moireAmplitude: 3,
      distractors: true,
    });
    const registration = cameraRegistration(source);
    const attempt = decodeGridFrame(scene, { ...registration, sampleRadius: 0 });

    expect(attempt.outcome, JSON.stringify(attempt)).toBe("decoded");
    expect(attempt.frame).toEqual(expected);
  });

  it("recovers fractional-scale perspective pixels beside colored UI", () => {
    const encoder = makeCapacityEncoder();
    const expected = encoder.frameBytes(17);
    const scene = makeCameraScene(renderGridFrame(expected), {
      brightness: 0.9,
      moireAmplitude: 3,
      distractors: true,
    });

    const decoded = requireDecoded(scene);
    expect(decoded?.frame).toEqual(expected);
    expect(decoded?.screenFillRatio).toBeGreaterThan(0.5);
    expect(decoded?.contrast).toBeGreaterThan(120);
  });

  it("recovers through one-pixel optical blur and moderate moire", () => {
    const encoder = makeCapacityEncoder();
    const expected = encoder.frameBytes(41);
    const source = renderGridFrame(expected);
    const camera: CameraSceneOptions = {
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
    const scene = makeCameraScene(source, camera);

    const knownRegistration = cameraRegistration(source, camera);
    const control = decodeGridFrame(scene, { ...knownRegistration, sampleRadius: 0 });
    expect(control.outcome, JSON.stringify(control)).toBe("decoded");
    expect(control.frame).toEqual(expected);

    const decoded = requireDecoded(scene);
    expect(decoded?.frame).toEqual(expected);
    expect(decoded?.contrast).toBeGreaterThan(90);
  });

  it("treats a rolling-shutter transition tear as an erasure or CRC rejection", () => {
    const encoder = makeCapacityEncoder();
    const decoder = new OpticalTransferDecoder(encoder.sessionId);
    const previous = makeCameraScene(renderGridFrame(encoder.frameBytes(8)));
    const next = makeCameraScene(renderGridFrame(encoder.frameBytes(9)));
    const decoded = tryDecodeGridFrame(transitionTear(previous, next));

    if (!decoded) {
      expect(decoded).toBeUndefined();
      return;
    }
    const progress = decoder.ingestFrame(decoded.frame);
    expect(progress.acceptedFrames).toBe(0);
    expect(progress.rejectedFrames).toBe(1);
  });

  it("keeps the 144 KiB Grid30 planning window below 3.5 seconds", () => {
    const encoder = makeCapacityEncoder();
    const expectedFrames = expectedLtFrames(encoder.sourceCount);

    expect(encoder.sourceCount).toBe(73);
    expect(expectedFrames).toBe(102);
    expect(encoder.sourceCount / GRID30_TARGET).toBeLessThan(2.5);
    expect(expectedFrames / GRID30_TARGET).toBeLessThanOrEqual(3.4);
  });

  it("recovers representative source epochs across the Grid30 stream", () => {
    const encoder = makeCapacityEncoder();
    const symbolIds = [0, 1, 17, 36, 55, encoder.sourceCount - 1];
    for (const symbolId of symbolIds) {
      const expected = encoder.frameBytes(symbolId);
      const scene = makeCameraScene(renderGridFrame(expected), {
        brightness: 0.9,
        moireAmplitude: symbolId % 2 === 0 ? 3 : 0,
      });
      expect(requireDecoded(scene).frame).toEqual(expected);
    }
  }, 15_000);
});

function makeCapacityEncoder(): OpticalTransferEncoder {
  const profile = OPTICAL_PROFILES.grid;
  return new OpticalTransferEncoder(deterministicBytes(CAPACITY_BYTES), {
    sessionId: SESSION,
    symbolSize: profile.symbolSize,
    codec: profile.codec,
  });
}

function deterministicBytes(length: number): Uint8Array {
  let state = 0x6d2b_79f5;
  return Uint8Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  });
}

function requireDecoded(image: PixelBuffer) {
  const attempt = decodeGridFrame(image);
  expect(attempt.outcome, JSON.stringify(attempt)).toBe("decoded");
  if (attempt.outcome !== "decoded" || !attempt.frame) {
    throw new Error(`Expected decoded grid frame; got ${JSON.stringify(attempt)}`);
  }
  return {
    frame: attempt.frame,
    contrast: attempt.contrast ?? 0,
    screenFillRatio: attempt.screenFillRatio ?? 0,
  };
}
