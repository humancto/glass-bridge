const PACKED_MAGIC = new Uint8Array([0x41, 0x47, 0x50, 0x31]); // AGP1
const PACKED_HEADER_BYTES = 12;
const GZIP_ALGORITHM = 1;
const MAX_UNPACKED_BYTES = 2 * 1024 * 1024;
const MIN_SAVINGS_BYTES = 64;

export type OpticalPayloadEncoding = "identity" | "gzip";

export type OpticalPayload = {
  bytes: Uint8Array;
  encoding: OpticalPayloadEncoding;
  originalBytes: number;
  transmittedBytes: number;
};

/**
 * Compresses the complete signed AGX envelope only when doing so saves real
 * optical bytes. The AGX object itself remains unchanged and is verified only
 * after bounded decompression on the receiver.
 */
export async function packOpticalPayload(payload: Uint8Array): Promise<OpticalPayload> {
  assertPayloadLength(payload.length);
  if (typeof CompressionStream === "undefined") return identity(payload);

  const compressed = await collectStream(
    new Blob([payload.slice().buffer]).stream().pipeThrough(new CompressionStream("gzip")),
    MAX_UNPACKED_BYTES,
  );
  const transmittedBytes = PACKED_HEADER_BYTES + compressed.length;
  if (transmittedBytes + MIN_SAVINGS_BYTES > payload.length) return identity(payload);

  const bytes = new Uint8Array(transmittedBytes);
  bytes.set(PACKED_MAGIC, 0);
  bytes[4] = GZIP_ALGORITHM;
  new DataView(bytes.buffer).setUint32(8, payload.length, false);
  bytes.set(compressed, PACKED_HEADER_BYTES);
  return {
    bytes,
    encoding: "gzip",
    originalBytes: payload.length,
    transmittedBytes,
  };
}

/**
 * Opens the optional optical packing layer with a strict declared-size bound.
 * A compressed stream is still untrusted at this point; AGX signature, digest,
 * policy, and quarantine checks happen after this function returns.
 */
export async function unpackOpticalPayload(payload: Uint8Array): Promise<OpticalPayload> {
  assertPayloadLength(payload.length);
  if (!startsWithMagic(payload)) return identity(payload);
  if (payload.length <= PACKED_HEADER_BYTES) {
    throw new Error("The optical packing envelope is truncated.");
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const algorithm = payload[4];
  if (algorithm !== GZIP_ALGORITHM || payload[5] !== 0 || payload[6] !== 0 || payload[7] !== 0) {
    throw new Error("The optical packing envelope uses an unsupported encoding.");
  }
  const originalBytes = view.getUint32(8, false);
  assertPayloadLength(originalBytes);
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot open the compressed optical payload.");
  }
  const bytes = await collectStream(
    new Blob([payload.slice(PACKED_HEADER_BYTES).buffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip")),
    originalBytes,
  );
  if (bytes.length !== originalBytes) {
    throw new Error("The decompressed optical payload length does not match its declaration.");
  }
  return {
    bytes,
    encoding: "gzip",
    originalBytes,
    transmittedBytes: payload.length,
  };
}

function identity(payload: Uint8Array): OpticalPayload {
  return {
    bytes: payload.slice(),
    encoding: "identity",
    originalBytes: payload.length,
    transmittedBytes: payload.length,
  };
}

function startsWithMagic(payload: Uint8Array): boolean {
  return payload.length >= PACKED_MAGIC.length &&
    PACKED_MAGIC.every((byte, index) => payload[index] === byte);
}

function assertPayloadLength(length: number): void {
  if (!Number.isSafeInteger(length) || length <= 0 || length > MAX_UNPACKED_BYTES) {
    throw new Error("The optical payload exceeds the bounded browser limit.");
  }
}

async function collectStream(
  stream: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > maximumBytes) {
        await reader.cancel("Optical payload exceeded its declared limit.");
        throw new Error("The optical payload expands beyond its declared limit.");
      }
      chunks.push(next.value.slice());
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
