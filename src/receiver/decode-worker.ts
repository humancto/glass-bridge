/// <reference lib="webworker" />

import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import { TURBO_READER_OPTIONS } from "./decode-options";
import type { DecodeWorkerRequest, DecodeWorkerResponse } from "./decode-worker-pool";

const ready = prepareZXingModule({
  overrides: {
    locateFile: (path: string, prefix: string) => path.endsWith(".wasm") ? wasmUrl : `${prefix}${path}`,
  },
  fireImmediately: true,
});

self.onmessage = (event: MessageEvent<DecodeWorkerRequest>) => {
  void decode(event.data);
};

async function decode(request: DecodeWorkerRequest): Promise<void> {
  const startedAt = performance.now();
  try {
    await ready;
    const pixels = new Uint8ClampedArray(request.pixels);
    const results = await readBarcodes(
      new ImageData(pixels, request.width, request.height),
      TURBO_READER_OPTIONS,
    );
    const decoded = results.filter((result) => result.isValid);
    const copiedBytes = decoded.map((result) => result.bytes.slice());
    const response: DecodeWorkerResponse = {
      id: request.id,
      codes: decoded.map((result, index) => ({
        bytes: copiedBytes[index].buffer,
        text: result.text,
      })),
      decodeMs: performance.now() - startedAt,
    };
    self.postMessage(response, copiedBytes.map((bytes) => bytes.buffer));
  } catch (error) {
    const response: DecodeWorkerResponse = {
      id: request.id,
      decodeMs: performance.now() - startedAt,
      error: error instanceof Error ? error.message : "QR decoding failed.",
    };
    self.postMessage(response);
  }
}

export {};
