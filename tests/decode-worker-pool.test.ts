import { describe, expect, it } from "vitest";
import {
  DecodeWorkerPool,
  replaceDecodeWorkerPool,
  type DecodeWorkerResponse,
} from "../src/receiver/decode-worker-pool";
import { decodeGridWithFreshFallback } from "../src/receiver/grid-registration";
import { decodeGridFrame, renderGridFrame } from "../src/phy/grid/grid-codec";
import { OPTICAL_PROFILES } from "../src/protocol/optical-profile";
import { OpticalTransferEncoder } from "../src/sender/transport";
import {
  DEFAULT_CAMERA_QUAD,
  makeCameraScene,
  type CameraPoint,
} from "./fixtures/grid-camera-sim";

class FakeWorker {
  onmessage: ((event: MessageEvent<DecodeWorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly messages: unknown[] = [];
  terminated = false;

  postMessage(message: unknown): void {
    this.messages.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(value: DecodeWorkerResponse): void {
    this.onmessage?.({ data: value } as MessageEvent<DecodeWorkerResponse>);
  }
}

describe("parallel QR decode worker pool", () => {
  it("dispatches without queueing stale camera frames and frees slots on completion", () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    const results: number[] = [];
    let index = 0;
    const pool = new DecodeWorkerPool(
      2,
      (result) => results.push(result.id),
      () => workers[index++] as unknown as Worker,
    );
    const image = makeImageData();

    expect(pool.submit(image)).toBe(true);
    expect(pool.submit(makeImageData())).toBe(true);
    expect(pool.submit(makeImageData())).toBe(false);
    expect(pool.busyCount).toBe(2);
    expect(workers[0].messages[0]).toMatchObject({ maxSymbols: 2 });

    workers[0].reply({ id: 0, codes: [{ text: "AGF1B64:x" }], decodeMs: 4 });
    expect(results).toEqual([0]);
    expect(pool.busyCount).toBe(1);
    expect(pool.submit(makeImageData())).toBe(true);
  });

  it("measures submit-to-message round-trip time with an injected monotonic clock", () => {
    const worker = new FakeWorker();
    let now = 100;
    const roundTrips: number[] = [];
    const pool = new DecodeWorkerPool(
      1,
      (result) => roundTrips.push(result.roundTripMs ?? -1),
      () => worker as unknown as Worker,
      () => now,
    );

    expect(pool.submit(makeImageData())).toBe(true);
    now = 112.75;
    worker.reply({ id: 0, codes: [], decodeMs: 4 });
    expect(roundTrips).toEqual([12.75]);
  });

  it("terminates workers already created when a later constructor throws", () => {
    const first = new FakeWorker();
    let index = 0;
    expect(() => new DecodeWorkerPool(
      2,
      () => undefined,
      () => {
        if (index++ === 0) return first as unknown as Worker;
        throw new Error("worker construction failed");
      },
    )).toThrow("worker construction failed");
    expect(first.terminated).toBe(true);
  });

  it("terminates a newly created worker when event-handler setup throws", () => {
    let terminated = false;
    const worker = {
      set onmessage(_handler: unknown) {
        throw new Error("handler setup failed");
      },
      terminate: () => { terminated = true; },
    } as unknown as Worker;

    expect(() => new DecodeWorkerPool(1, () => undefined, () => worker))
      .toThrow("handler setup failed");
    expect(terminated).toBe(true);
  });

  it("keeps the retired pool stopped when replacement construction throws", () => {
    const oldWorker = new FakeWorker();
    const oldPool = new DecodeWorkerPool(
      1,
      () => undefined,
      () => oldWorker as unknown as Worker,
    );
    let failure: unknown;
    const replacement = replaceDecodeWorkerPool(
      oldPool,
      () => new DecodeWorkerPool(
        1,
        () => undefined,
        () => { throw new Error("replacement failed"); },
      ),
      (error) => { failure = error; },
    );

    expect(replacement).toBeUndefined();
    expect(failure).toEqual(new Error("replacement failed"));
    expect(oldWorker.terminated).toBe(true);
    expect(oldPool.submit(makeImageData())).toBe(false);
  });

  it("marks cropped lane jobs as single-symbol acquisitions", () => {
    const worker = new FakeWorker();
    const pool = new DecodeWorkerPool(1, () => undefined, () => worker as unknown as Worker);
    expect(pool.submit(makeImageData(), 1)).toBe(true);
    expect(worker.messages[0]).toMatchObject({ maxSymbols: 1 });
  });

  it("terminates every worker and rejects later submissions", () => {
    const workers = [new FakeWorker(), new FakeWorker()];
    let index = 0;
    const pool = new DecodeWorkerPool(
      2,
      () => undefined,
      () => workers[index++] as unknown as Worker,
    );
    pool.stop();
    expect(workers.every((worker) => worker.terminated)).toBe(true);
    expect(pool.submit(makeImageData())).toBe(false);
  });

  it("drops an old portrait job after the pool is retired for landscape capture", () => {
    const portraitWorker = new FakeWorker();
    const landscapeWorker = new FakeWorker();
    const results: number[] = [];
    const portraitPool = new DecodeWorkerPool(
      1,
      (result) => results.push(result.codes?.[0]?.bytes?.[0] ?? -1),
      () => portraitWorker as unknown as Worker,
    );
    expect(portraitPool.submit(makeImageData(540, 960), 1, "mono-grid-v0")).toBe(true);
    expect(portraitWorker.messages[0]).toMatchObject({ width: 540, height: 960 });

    portraitPool.stop();
    const landscapePool = new DecodeWorkerPool(
      1,
      (result) => results.push(result.codes?.[0]?.bytes?.[0] ?? -1),
      () => landscapeWorker as unknown as Worker,
    );
    expect(landscapePool.submit(makeImageData(960, 540), 1, "mono-grid-v0")).toBe(true);
    expect(landscapeWorker.messages[0]).toMatchObject({ width: 960, height: 540 });

    portraitWorker.reply({ id: 0, codes: [{ bytes: Uint8Array.of(11).buffer }], decodeMs: 4 });
    landscapeWorker.reply({ id: 0, codes: [{ bytes: Uint8Array.of(22).buffer }], decodeMs: 4 });
    expect(results).toEqual([22]);
  });

  it("returns every code recovered from one camera exposure", () => {
    const worker = new FakeWorker();
    const results: number[][] = [];
    const pool = new DecodeWorkerPool(
      1,
      (result) => results.push(result.codes?.map((code) => code.bytes?.[0] ?? -1) ?? []),
      () => worker as unknown as Worker,
    );
    pool.submit(makeImageData());
    worker.reply({
      id: 0,
      codes: [
        { bytes: Uint8Array.of(11).buffer },
        { bytes: Uint8Array.of(22).buffer },
      ],
      decodeMs: 7,
    });
    expect(results).toEqual([[11, 22]]);
  });

  it("preserves Grid acquisition diagnostics from the worker", () => {
    const worker = new FakeWorker();
    const outcomes: DecodeWorkerResponse["grid"][] = [];
    const pool = new DecodeWorkerPool(
      1,
      (result) => outcomes.push(result.grid),
      () => worker as unknown as Worker,
    );
    pool.submit(makeImageData(), 1, "mono-grid-v0");
    worker.reply({
      id: 0,
      codes: [],
      decodeMs: 5,
      grid: {
        outcome: "contrast-low",
        markersFound: true,
        registrationReused: true,
        transportValid: false,
        contrast: 31,
        screenFillRatio: 0.62,
      },
    });

    expect(outcomes).toEqual([{
      outcome: "contrast-low",
      markersFound: true,
      registrationReused: true,
      transportValid: false,
      contrast: 31,
      screenFillRatio: 0.62,
    }]);
  });

  it("reacquires shifted Grid registration on the same frame within the 60 Hz budget", () => {
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
    if (!acquired.registration) throw new Error("Expected initial Grid registration.");

    const shiftedQuad = DEFAULT_CAMERA_QUAD.map(({ x, y }) => ({
      x: x + 0.7,
      y: y + 0.7,
    })) as [CameraPoint, CameraPoint, CameraPoint, CameraPoint];
    const shifted = makeCameraScene(renderGridFrame(frame), {
      quad: shiftedQuad,
      distractors: false,
    });
    expect(decodeGridFrame(shifted, acquired.registration).outcome).not.toBe("decoded");
    expect(decodeGridFrame(shifted).outcome).toBe("decoded");

    const timings: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      const startedAt = performance.now();
      const recovery = decodeGridWithFreshFallback(
        acquired.registration,
        (registration) => decodeGridFrame(shifted, registration),
      );
      timings.push(performance.now() - startedAt);
      expect(recovery.decoded.outcome).toBe("decoded");
      expect(recovery.decoded.frame).toEqual(frame);
      expect(recovery.registrationReused).toBe(false);
      expect(recovery.reacquiredSameFrame).toBe(true);
      expect(recovery.decoded.registration).toBeDefined();
    }
    timings.sort((left, right) => left - right);
    const p50 = timings[Math.floor((timings.length - 1) * 0.5)];
    const p95 = timings[Math.floor((timings.length - 1) * 0.95)];
    if (process.env.GLASSBRIDGE_REPORT_TIMING === "1") {
      console.info(
        `Grid same-frame registration recovery p50/p95: ${p50.toFixed(2)}/${p95.toFixed(2)} ms`,
      );
      // Enforce the 60 Hz p95 only in the documented isolated timing run;
      // Vitest executes files concurrently in the complete correctness suite.
      expect(p95).toBeLessThan(1_000 / 60);
    }
  }, 30_000);
});

function makeImageData(width = 4, height = 4): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(width * height * 4),
    colorSpace: "srgb",
  } as ImageData;
}

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff);
}
