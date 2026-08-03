import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseBootstrapHash,
  trustFingerprint,
  verifyAgxEnvelope,
} from "../src/receiver/agx";
import {
  base64UrlEncode,
  OpticalTransferDecoder,
  type IngestResult,
} from "../src/receiver/transport";

const ROOT = new URL("../", import.meta.url);
const MASK_64 = (1n << 64n) - 1n;
const INCREMENT = 0x9e37_79b9_7f4a_7c15n;

describe("phone receiver AGX verification", () => {
  it("verifies the Rust golden vector with the paired Ed25519 key", async () => {
    const envelope = await readHex("test-vectors/agx1/valid-envelope.hex");
    const publicKey = await readHex("test-vectors/agx1/sender-public.hex");
    const trust = parseBootstrapHash(
      `#v=1&key=${base64UrlEncode(publicKey)}&boundary=golden-lab%2Ffirmware-in`,
    );
    const verified = await verifyAgxEnvelope(envelope, trust);

    expect(new TextDecoder().decode(verified.payload)).toBe("GlassBridge AGX/1 golden vector\n");
    expect(verified.filename).toBe("golden.bin");
    expect(verified.signerKeyId).toBe("10ba682c8ad13513");
    expect(verified.boundary).toBe("golden-lab/firmware-in");
    expect(await trustFingerprint(trust)).toBe(verified.signerKeyId);
  });

  it("fails closed for tampering, wrong boundaries, and malformed pairing", async () => {
    const tampered = await readHex("test-vectors/agx1/tampered-payload.hex");
    const publicKey = await readHex("test-vectors/agx1/sender-public.hex");
    const trust = { publicKey, boundary: "golden-lab/firmware-in" };

    await expect(verifyAgxEnvelope(tampered, trust)).rejects.toThrow("digest");
    await expect(
      verifyAgxEnvelope(await readHex("test-vectors/agx1/valid-envelope.hex"), {
        publicKey,
        boundary: "wrong/boundary",
      }),
    ).rejects.toThrow("expects wrong/boundary");
    expect(() => parseBootstrapHash("#v=1&key=bad&boundary=demo")).toThrow("32 bytes");
    const encodedKey = base64UrlEncode(publicKey);
    expect(() => parseBootstrapHash(
      `#v=1&key=${encodedKey}&boundary=demo&boundary=other`,
    )).toThrow("duplicate");
    expect(() => parseBootstrapHash(
      `#v=1&key=${encodedKey}&boundary=demo&debug=1`,
    )).toThrow("unexpected");
  });
});

describe("phone receiver optical reconstruction", () => {
  it("reconstructs out-of-order systematic and XOR-repair frames", () => {
    const payload = new TextEncoder().encode(
      "Photons carry the signed envelope; rank recovery tolerates missed frames.",
    );
    const session = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
    const frames = makeFrames(payload, session, 16, [5, 3, 7, 0, 8, 4, 6, 1, 2]);
    const decoder = new OpticalTransferDecoder();

    decoder.ingestText(frames[0]);
    const mixed = makeFrames(payload, new Uint8Array(16).fill(99), 16, [0])[0];
    expect(decoder.ingestText(mixed).rejectedFrames).toBe(1);
    expect(decoder.ingestText(frames[0]).duplicateFrames).toBe(1);

    let result: IngestResult = decoder.snapshot();
    for (const frame of frames.slice(1)) {
      result = decoder.ingestText(frame);
      if (result.complete) break;
    }

    expect(result.complete).toBe(true);
    expect(result.rank).toBe(result.required);
    expect(result.envelope).toEqual(payload);
  });

  it("rejects a QR frame whose transport CRC was modified", () => {
    const payload = new TextEncoder().encode("bounded hostile frame test");
    const session = new Uint8Array(16).fill(7);
    const valid = makeRawFrame(payload, session, 8, 0);
    valid[40] ^= 0x80;
    const decoder = new OpticalTransferDecoder();
    const result = decoder.ingestText(`AGF1B64:${base64UrlEncode(valid)}`);
    expect(result.rank).toBe(0);
    expect(result.rejectedFrames).toBe(1);
  });

  it("bounds browser-safe frame text before base64 decoding", () => {
    const result = new OpticalTransferDecoder().ingestText(`AGF1B64:${"A".repeat(4_097)}`);
    expect(result.rank).toBe(0);
    expect(result.rejectedFrames).toBe(1);
  });
});

async function readHex(path: string): Promise<Uint8Array> {
  const value = (await readFile(new URL(path, ROOT), "utf8")).trim();
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function makeFrames(
  payload: Uint8Array,
  session: Uint8Array,
  symbolSize: number,
  symbolIds: number[],
): string[] {
  return symbolIds.map((symbolId) =>
    `AGF1B64:${base64UrlEncode(makeRawFrame(payload, session, symbolSize, symbolId))}`
  );
}

function makeRawFrame(
  payload: Uint8Array,
  session: Uint8Array,
  symbolSize: number,
  symbolId: number,
): Uint8Array {
  const sourceCount = Math.max(1, Math.ceil(payload.length / symbolSize));
  const source = Array.from({ length: sourceCount }, (_, index) => {
    const symbol = new Uint8Array(symbolSize);
    symbol.set(payload.slice(index * symbolSize, (index + 1) * symbolSize));
    return symbol;
  });
  const words = referenceCoefficients(session, symbolId, sourceCount);
  const symbol = new Uint8Array(symbolSize);
  source.forEach((candidate, index) => {
    if ((words[Math.floor(index / 64)] & (1n << BigInt(index % 64))) !== 0n) {
      candidate.forEach((byte, offset) => { symbol[offset] ^= byte; });
    }
  });

  const frame = new Uint8Array(40 + symbolSize + 4);
  frame.set(new TextEncoder().encode("AGF1"), 0);
  frame.set(session, 4);
  const view = new DataView(frame.buffer);
  view.setUint32(20, symbolId, false);
  view.setUint32(24, sourceCount, false);
  view.setUint32(28, symbolSize, false);
  view.setBigUint64(32, BigInt(payload.length), false);
  frame.set(symbol, 40);
  view.setUint32(frame.length - 4, crc32(frame.subarray(0, frame.length - 4)), false);
  return frame;
}

function referenceCoefficients(session: Uint8Array, symbolId: number, count: number): bigint[] {
  const words = Array.from({ length: Math.ceil(count / 64) }, () => 0n);
  if (symbolId < count) {
    words[Math.floor(symbolId / 64)] |= 1n << BigInt(symbolId % 64);
    return words;
  }
  const view = new DataView(session.buffer, session.byteOffset, session.byteLength);
  const left = view.getBigUint64(0, false);
  const right = view.getBigUint64(8, false);
  let state = (left ^ rotateLeft(right, 17n) ^ ((BigInt(symbolId) * INCREMENT) & MASK_64)) & MASK_64;
  for (let index = 0; index < words.length; index += 1) {
    state = (state + INCREMENT) & MASK_64;
    let value = state;
    value = ((value ^ (value >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK_64;
    value = ((value ^ (value >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK_64;
    words[index] = (value ^ (value >> 31n)) & MASK_64;
  }
  const excess = words.length * 64 - count;
  if (excess > 0) words[words.length - 1] &= (1n << BigInt(64 - excess)) - 1n;
  if (words.every((word) => word === 0n)) {
    const fallback = symbolId % count;
    words[Math.floor(fallback / 64)] |= 1n << BigInt(fallback % 64);
  }
  return words;
}

function rotateLeft(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK_64;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}
