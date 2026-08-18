import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  decodeGridFrame,
  renderGridFrame,
} from "../src/phy/grid/grid-codec";
import { OPTICAL_PROFILES } from "../src/protocol/optical-profile";
import {
  decodeGridWithFreshFallback,
  GridReacquisitionBackoff,
} from "../src/receiver/grid-registration";
import { isValidOpticalFrame } from "../src/receiver/transport";
import { GridWorkerDecoder } from "../src/receiver/grid-worker-decoder";
import { OpticalTransferEncoder } from "../src/sender/transport";
import {
  DEFAULT_CAMERA_QUAD,
  makeCameraScene,
  type CameraPoint,
} from "./fixtures/grid-camera-sim";

describe("Grid registration recovery", () => {
  it("reacquires the same exposure when stale geometry preserves magic but breaks transport CRC", () => {
    const profile = OPTICAL_PROFILES.grid;
    const encoder = new OpticalTransferEncoder(deterministicBytes(8_192), {
      sessionId: Uint8Array.from({ length: 16 }, (_, index) => (index * 17 + 5) & 0xff),
      symbolSize: profile.symbolSize,
      codec: profile.codec,
    });
    const frame = encoder.frameBytes(2);
    const initial = makeCameraScene(renderGridFrame(frame), { distractors: false });
    const acquired = decodeGridFrame(initial);
    expect(acquired.outcome).toBe("decoded");
    expect(acquired.frame && isValidOpticalFrame(acquired.frame)).toBe(true);
    if (!acquired.registration) throw new Error("Expected initial Grid registration.");

    let shifted: ReturnType<typeof makeCameraScene> | undefined;
    let shiftedQuad: [CameraPoint, CameraPoint, CameraPoint, CameraPoint] | undefined;
    for (let tenths = 40; tenths <= 65; tenths += 1) {
      const offset = tenths / 100;
      const quad = DEFAULT_CAMERA_QUAD.map(({ x, y }) => ({
        x: x + offset,
        y: y + offset,
      })) as [CameraPoint, CameraPoint, CameraPoint, CameraPoint];
      const candidate = makeCameraScene(renderGridFrame(frame), {
        quad,
        distractors: false,
      });
      const stale = decodeGridFrame(candidate, acquired.registration);
      const fresh = decodeGridFrame(candidate);
      if (
        stale.outcome === "decoded" &&
        stale.frame !== undefined &&
        !isValidOpticalFrame(stale.frame) &&
        fresh.outcome === "decoded" &&
        fresh.frame !== undefined &&
        isValidOpticalFrame(fresh.frame)
      ) {
        shifted = candidate;
        shiftedQuad = quad;
        break;
      }
    }
    expect(shifted, "expected a deterministic CRC-blind stale-registration fixture").toBeDefined();

    const recovery = decodeGridWithFreshFallback(
      acquired.registration,
      (registration) => decodeGridFrame(shifted!, registration),
      (attempt) => attempt.outcome === "decoded" &&
        attempt.frame !== undefined &&
        isValidOpticalFrame(attempt.frame),
    );
    expect(recovery.reacquiredSameFrame).toBe(true);
    expect(recovery.registrationReused).toBe(false);
    expect(recovery.decoded.outcome).toBe("decoded");
    expect(recovery.decoded.frame).toEqual(frame);
    expect(recovery.decoded.frame && isValidOpticalFrame(recovery.decoded.frame)).toBe(true);

    // Exercise the stateful core used by the real Web Worker: it must persist
    // the fresh registration and reuse it on the next exposure.
    const workerDecoder = new GridWorkerDecoder();
    expect(workerDecoder.decode(initial).validFrame).toBe(true);
    const moved = workerDecoder.decode(shifted!);
    expect(moved.reacquiredSameFrame).toBe(true);
    expect(moved.validFrame).toBe(true);
    const nextFrame = encoder.frameBytes(3);
    const nextScene = makeCameraScene(renderGridFrame(nextFrame), {
      quad: shiftedQuad,
      distractors: false,
    });
    const next = workerDecoder.decode(nextScene);
    expect(next.registrationReused).toBe(true);
    expect(next.reacquiredSameFrame).toBe(false);
    expect(next.validFrame).toBe(true);
    expect(next.decoded.frame).toEqual(nextFrame);
  }, 30_000);

  it("rejects an AGF frame whose magic survives but CRC does not", () => {
    const encoder = new OpticalTransferEncoder(deterministicBytes(256), {
      sessionId: new Uint8Array(16).fill(0x5a),
      symbolSize: 256,
    });
    const frame = encoder.frameBytes(0);
    expect(isValidOpticalFrame(frame)).toBe(true);
    frame[64] ^= 0x80;
    expect(String.fromCharCode(...frame.subarray(0, 4))).toBe("AGF1");
    expect(isValidOpticalFrame(frame)).toBe(false);

    const gridFrame = new OpticalTransferEncoder(deterministicBytes(256), {
      sessionId: new Uint8Array(16).fill(0x5a),
      symbolSize: OPTICAL_PROFILES.grid.symbolSize,
      codec: OPTICAL_PROFILES.grid.codec,
    }).frameBytes(0);
    gridFrame[64] ^= 0x80;
    const decoded = new GridWorkerDecoder().decode(
      makeCameraScene(renderGridFrame(gridFrame), { distractors: false }),
    );
    expect(decoded.decoded.outcome).toBe("decoded");
    expect(decoded.validFrame).toBe(false);
  });

  it("does not discard verified registration when a periodic marker refresh misses", () => {
    const encoder = new OpticalTransferEncoder(deterministicBytes(8_192), {
      sessionId: Uint8Array.from({ length: 16 }, (_, index) => (index * 19 + 7) & 0xff),
      symbolSize: OPTICAL_PROFILES.grid.symbolSize,
      codec: OPTICAL_PROFILES.grid.codec,
    });
    const frame = encoder.frameBytes(4);
    const visible = renderGridFrame(frame);
    const decoder = new GridWorkerDecoder();

    expect(decoder.decode(visible).validFrame).toBe(true);
    for (let job = 1; job < 15; job += 1) {
      expect(decoder.decode(visible).validFrame).toBe(true);
    }

    const markerMiss = eraseExactMarkerColours(visible);
    const refresh = decoder.decode(markerMiss);
    expect(refresh.validFrame).toBe(true);
    expect(refresh.registrationReused).toBe(true);
    expect(refresh.reacquiredSameFrame).toBe(false);
    expect(refresh.decoded.frame).toEqual(frame);

    const following = decoder.decode(markerMiss);
    expect(following.validFrame).toBe(true);
    expect(following.registrationReused).toBe(true);
    expect(following.decoded.frame).toEqual(frame);
  });

  it("bounds repeated fresh-registration work after an unsuccessful retry", () => {
    const backoff = new GridReacquisitionBackoff(2);
    expect(backoff.allowsFreshAttempt).toBe(true);
    backoff.observe({ refreshed: false, validFrame: false, reacquiredSameFrame: true });
    expect(backoff.allowsFreshAttempt).toBe(false);
    backoff.observe({ refreshed: false, validFrame: false, reacquiredSameFrame: false });
    expect(backoff.allowsFreshAttempt).toBe(false);
    backoff.observe({ refreshed: false, validFrame: false, reacquiredSameFrame: false });
    expect(backoff.allowsFreshAttempt).toBe(true);

    backoff.observe({ refreshed: false, validFrame: false, reacquiredSameFrame: true });
    backoff.observe({ refreshed: false, validFrame: true, reacquiredSameFrame: false });
    expect(backoff.allowsFreshAttempt).toBe(true);
    expect(() => new GridReacquisitionBackoff(-1)).toThrow(/non-negative integer/);
  });

  it("propagates transport CRC validity from the Grid core into worker diagnostics", async () => {
    const workerSource = await readFile(
      new URL("../src/receiver/decode-worker.ts", import.meta.url),
      "utf8",
    );
    expect(workerSource).toMatch(/transportValid:\s*recovery\.validFrame/);
  });
});

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff);
}

function eraseExactMarkerColours(image: ReturnType<typeof renderGridFrame>) {
  const data = image.data.slice();
  for (let offset = 0; offset < data.length; offset += 4) {
    const red = data[offset];
    const green = data[offset + 1];
    const blue = data[offset + 2];
    const marker = (red === 255 && green === 0 && blue === 0) ||
      (red === 0 && green === 255 && blue === 0) ||
      (red === 0 && green === 80 && blue === 255) ||
      (red === 255 && green === 0 && blue === 255);
    if (!marker) continue;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
  }
  return { ...image, data };
}
