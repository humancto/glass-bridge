export type DecodeWorkerRequest = {
  id: number;
  width: number;
  height: number;
  pixels: ArrayBuffer;
  maxSymbols: 1 | 2;
};

export type DecodeWorkerCode = {
  bytes?: ArrayBuffer;
  text?: string;
};

export type DecodeWorkerResponse = {
  id: number;
  codes?: DecodeWorkerCode[];
  decodeMs: number;
  error?: string;
};

export type DecodeResult = Omit<DecodeWorkerResponse, "codes"> & {
  codes?: Array<{ bytes?: Uint8Array; text?: string }>;
};

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
};

type WorkerFactory = () => Worker;

export class DecodeWorkerPool {
  private readonly slots: WorkerSlot[];
  private nextId = 0;
  private active = true;

  constructor(
    size: number,
    private readonly onResult: (result: DecodeResult) => void,
    workerFactory: WorkerFactory = createDecodeWorker,
  ) {
    if (!Number.isSafeInteger(size) || size < 1 || size > 8) {
      throw new Error("Decode worker count must be between one and eight.");
    }
    this.slots = Array.from({ length: size }, () => {
      const worker = workerFactory();
      const slot: WorkerSlot = { worker, busy: false };
      worker.onmessage = (event: MessageEvent<DecodeWorkerResponse>) => {
        if (!this.active) return;
        slot.busy = false;
        const result = event.data;
        this.onResult({
          ...result,
          codes: result.codes?.map((code) => ({
            ...code,
            bytes: code.bytes ? new Uint8Array(code.bytes) : undefined,
          })),
        });
      };
      worker.onerror = (event) => {
        if (!this.active) return;
        slot.busy = false;
        this.onResult({
          id: -1,
          decodeMs: 0,
          error: event.message || "Optical decode worker failed.",
        });
      };
      return slot;
    });
  }

  get size(): number {
    return this.slots.length;
  }

  get busyCount(): number {
    return this.slots.reduce((count, slot) => count + Number(slot.busy), 0);
  }

  submit(imageData: ImageData, maxSymbols: 1 | 2 = 2): boolean {
    if (!this.active) return false;
    const slot = this.slots.find((candidate) => !candidate.busy);
    if (!slot) return false;
    slot.busy = true;
    const request: DecodeWorkerRequest = {
      id: this.nextId,
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.data.buffer,
      maxSymbols,
    };
    this.nextId += 1;
    slot.worker.postMessage(request, [request.pixels]);
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const slot of this.slots) slot.worker.terminate();
  }
}

function createDecodeWorker(): Worker {
  return new Worker(new URL("./decode-worker.ts", import.meta.url), { type: "module" });
}
