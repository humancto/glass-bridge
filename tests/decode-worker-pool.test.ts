import { describe, expect, it } from "vitest";
import {
  DecodeWorkerPool,
  type DecodeWorkerResponse,
} from "../src/receiver/decode-worker-pool";

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

    workers[0].reply({ id: 0, codes: [{ text: "AGF1B64:x" }], decodeMs: 4 });
    expect(results).toEqual([0]);
    expect(pool.busyCount).toBe(1);
    expect(pool.submit(makeImageData())).toBe(true);
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
});

function makeImageData(): ImageData {
  return {
    width: 4,
    height: 4,
    data: new Uint8ClampedArray(4 * 4 * 4),
    colorSpace: "srgb",
  } as ImageData;
}
