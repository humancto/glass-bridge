import type { VisualPhyId } from "../protocol/optical-profile";
import type { GridDecodeOutcome } from "../phy/grid/grid-codec";

export type DecodeWorkerRequest = {
  id: number;
  width: number;
  height: number;
  pixels: ArrayBuffer;
  maxSymbols: 1 | 2;
  visualPhy: VisualPhyId;
};

export type DecodeWorkerCode = {
  bytes?: ArrayBuffer;
  text?: string;
};

export type DecodeWorkerResponse = {
  id: number;
  codes?: DecodeWorkerCode[];
  decodeMs: number;
  grid?: {
    outcome: GridDecodeOutcome;
    markersFound: boolean;
    registrationReused: boolean;
    transportValid?: boolean;
    correctedCodewords?: number;
    contrast?: number;
    screenFillRatio?: number;
    reacquiredSameFrame?: boolean;
  };
  error?: string;
};

export type DecodeResult = Omit<DecodeWorkerResponse, "codes"> & {
  codes?: Array<{ bytes?: Uint8Array; text?: string }>;
  roundTripMs?: number;
};

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
  submittedAt?: number;
};

type WorkerFactory = () => Worker;
type MonotonicClock = () => number;

export class DecodeWorkerPool {
  private readonly slots: WorkerSlot[] = [];
  private nextId = 0;
  private active = true;

  constructor(
    size: number,
    private readonly onResult: (result: DecodeResult) => void,
    workerFactory: WorkerFactory = createDecodeWorker,
    private readonly clock: MonotonicClock = () => performance.now(),
  ) {
    if (!Number.isSafeInteger(size) || size < 1 || size > 8) {
      throw new Error("Decode worker count must be between one and eight.");
    }
    try {
      for (let index = 0; index < size; index += 1) {
        const worker = workerFactory();
        const slot: WorkerSlot = { worker, busy: false };
        // Register ownership before assigning handlers so even an exotic
        // Worker implementation with a throwing event setter is cleaned up.
        this.slots.push(slot);
        worker.onmessage = (event: MessageEvent<DecodeWorkerResponse>) => {
          if (!this.active) return;
          const roundTripMs = this.elapsedSince(slot.submittedAt);
          slot.busy = false;
          slot.submittedAt = undefined;
          const result = event.data;
          this.onResult({
            ...result,
            roundTripMs,
            codes: result.codes?.map((code) => ({
              ...code,
              bytes: code.bytes ? new Uint8Array(code.bytes) : undefined,
            })),
          });
        };
        worker.onerror = (event) => {
          if (!this.active) return;
          const roundTripMs = this.elapsedSince(slot.submittedAt);
          slot.busy = false;
          slot.submittedAt = undefined;
          this.onResult({
            id: -1,
            decodeMs: 0,
            roundTripMs,
            error: event.message || "Optical decode worker failed.",
          });
        };
      }
    } catch (error) {
      for (const slot of this.slots) slot.worker.terminate();
      this.active = false;
      throw error;
    }
  }

  get size(): number {
    return this.slots.length;
  }

  get busyCount(): number {
    return this.slots.reduce((count, slot) => count + Number(slot.busy), 0);
  }

  submit(
    imageData: ImageData,
    maxSymbols: 1 | 2 = 2,
    visualPhy: VisualPhyId = "qr-model2-v1",
  ): boolean {
    if (!this.active) return false;
    const slot = this.slots.find((candidate) => !candidate.busy);
    if (!slot) return false;
    slot.busy = true;
    slot.submittedAt = this.clock();
    const request: DecodeWorkerRequest = {
      id: this.nextId,
      width: imageData.width,
      height: imageData.height,
      pixels: imageData.data.buffer,
      maxSymbols,
      visualPhy,
    };
    this.nextId += 1;
    try {
      slot.worker.postMessage(request, [request.pixels]);
    } catch (error) {
      slot.busy = false;
      slot.submittedAt = undefined;
      throw error;
    }
    return true;
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    for (const slot of this.slots) slot.worker.terminate();
  }

  private elapsedSince(startedAt: number | undefined): number | undefined {
    if (startedAt === undefined) return undefined;
    const elapsed = this.clock() - startedAt;
    return Number.isFinite(elapsed) ? Math.max(0, elapsed) : undefined;
  }
}

/**
 * Retires the old geometry-bound worker pool before constructing its
 * replacement. Construction failures are surfaced to the receiver's single
 * fail-closed path so an active camera stream cannot be left behind.
 */
export function replaceDecodeWorkerPool(
  current: DecodeWorkerPool,
  create: () => DecodeWorkerPool,
  onFailure: (error: unknown) => void,
): DecodeWorkerPool | undefined {
  current.stop();
  try {
    return create();
  } catch (error) {
    onFailure(error);
    return undefined;
  }
}

function createDecodeWorker(): Worker {
  return new Worker(new URL("./decode-worker.ts", import.meta.url), { type: "module" });
}
