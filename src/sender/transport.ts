import { base64UrlEncode } from "../receiver/transport";
import { expectedLtFrames, ltFrameIndices } from "../protocol/lt-codec";
import { OPTICAL_PROFILES, type OpticalCodecId, type OpticalProfileId } from "../protocol/optical-profile";
import type { OpticalPayloadEncoding } from "../protocol/optical-payload";

const DENSE_FRAME_MAGIC = new Uint8Array([0x41, 0x47, 0x46, 0x31]);
const LT_FRAME_MAGIC = new Uint8Array([0x41, 0x47, 0x46, 0x32]);
const HEADER_BYTES = 40;
const CRC_BYTES = 4;
const MAX_SOURCE_SYMBOLS = 1_024;
const MAX_SYMBOL_BYTES = 2_909;
const MAX_TRANSFER_BYTES = 2 * 1024 * 1024;
const MAX_FRAMES = MAX_SOURCE_SYMBOLS * 8;
const MASK_64 = (1n << 64n) - 1n;
const SPLITMIX_INCREMENT = 0x9e37_79b9_7f4a_7c15n;

export type OpticalEncoderOptions = {
  sessionId?: Uint8Array;
  symbolSize?: number;
  frameCount?: number;
  codec?: OpticalCodecId;
};

export class OpticalTransferEncoder {
  readonly sessionId: Uint8Array;
  readonly sourceCount: number;
  readonly symbolSize: number;
  readonly frameCount: number;
  readonly payloadLength: number;
  readonly codec: OpticalCodecId;

  private readonly source: Uint8Array[];

  constructor(payload: Uint8Array, options: OpticalEncoderOptions = {}) {
    this.symbolSize = options.symbolSize ?? 512;
    this.codec = options.codec ?? "dense-v1";
    if (this.symbolSize === 0 || this.symbolSize > MAX_SYMBOL_BYTES) {
      throw new Error("Optical symbol size exceeds the browser sender limit.");
    }
    if (payload.length === 0 || payload.length > MAX_TRANSFER_BYTES) {
      throw new Error("Optical payload exceeds the browser sender limit.");
    }
    this.payloadLength = payload.length;
    this.sourceCount = Math.ceil(payload.length / this.symbolSize);
    if (this.sourceCount > MAX_SOURCE_SYMBOLS) {
      throw new Error("Optical transfer requires too many source symbols.");
    }

    this.frameCount = options.frameCount ?? (
      this.codec === "lt-v2" ? expectedLtFrames(this.sourceCount) : this.sourceCount * 3 + 8
    );
    if (
      !Number.isSafeInteger(this.frameCount) ||
      this.frameCount < this.sourceCount ||
      this.frameCount > MAX_FRAMES
    ) {
      throw new Error("Optical frame count exceeds the browser sender limit.");
    }

    this.sessionId = options.sessionId?.slice() ?? randomBytes(16);
    if (this.sessionId.length !== 16) {
      throw new Error("Optical session identifiers must be 16 bytes.");
    }
    this.source = Array.from({ length: this.sourceCount }, (_, index) => {
      const symbol = new Uint8Array(this.symbolSize);
      symbol.set(payload.slice(index * this.symbolSize, (index + 1) * this.symbolSize));
      return symbol;
    });
  }

  frameText(symbolId: number): string {
    return `AGF1B64:${base64UrlEncode(this.frameBytes(symbolId))}`;
  }

  frameBytes(symbolId: number): Uint8Array {
    if (!Number.isSafeInteger(symbolId) || symbolId < 0 || symbolId > 0xffff_ffff) {
      throw new Error("Optical symbol identifier is outside the supported range.");
    }
    const symbol = new Uint8Array(this.symbolSize);
    if (this.codec === "lt-v2") {
      for (const index of ltFrameIndices(this.sessionId, symbolId, this.sourceCount)) {
        xorBytes(symbol, this.source[index]);
      }
    } else {
      const coefficientWords = coefficients(this.sessionId, symbolId, this.sourceCount);
      this.source.forEach((candidate, index) => {
        if (bitIsSet(coefficientWords, index)) xorBytes(symbol, candidate);
      });
    }

    const frame = new Uint8Array(HEADER_BYTES + this.symbolSize + CRC_BYTES);
    frame.set(this.codec === "lt-v2" ? LT_FRAME_MAGIC : DENSE_FRAME_MAGIC, 0);
    frame.set(this.sessionId, 4);
    const view = new DataView(frame.buffer);
    view.setUint32(20, symbolId, false);
    view.setUint32(24, this.sourceCount, false);
    view.setUint32(28, this.symbolSize, false);
    view.setBigUint64(32, BigInt(this.payloadLength), false);
    frame.set(symbol, HEADER_BYTES);
    view.setUint32(frame.length - CRC_BYTES, crc32(frame.subarray(0, -CRC_BYTES)), false);
    return frame;
  }
}

export function pairingUrl(
  receiverUrl: string,
  publicKey: Uint8Array,
  boundary: string,
  sessionId: Uint8Array,
  profileId: OpticalProfileId,
  packing: OpticalPayloadEncoding,
  symbolRate: number,
): string {
  const url = new URL(receiverUrl);
  const profile = OPTICAL_PROFILES[profileId];
  if (
    url.hash ||
    url.search ||
    publicKey.length !== 32 ||
    sessionId.length !== 16 ||
    !/^[a-z][a-z0-9-]{0,31}$/u.test(profileId) ||
    (packing !== "identity" && packing !== "gzip") ||
    !Number.isSafeInteger(symbolRate) ||
    symbolRate < profile.minFps || symbolRate > profile.maxFps
  ) {
    throw new Error("The receiver URL or sender key is invalid.");
  }
  url.hash = new URLSearchParams({
    v: "4",
    key: base64UrlEncode(publicKey),
    boundary,
    session: base64UrlEncode(sessionId),
    profile: profileId,
    packing,
    phy: profile.visualPhy,
    rate: String(symbolRate),
  }).toString();
  return url.toString();
}

function coefficients(sessionId: Uint8Array, symbolId: number, sourceCount: number): bigint[] {
  const words = Array.from({ length: Math.ceil(sourceCount / 64) }, () => 0n);
  if (symbolId < sourceCount) {
    setBit(words, symbolId);
    return words;
  }
  const view = new DataView(sessionId.buffer, sessionId.byteOffset, sessionId.byteLength);
  const left = view.getBigUint64(0, false);
  const right = view.getBigUint64(8, false);
  let state = (
    left ^
    rotateLeft64(right, 17n) ^
    ((BigInt(symbolId) * SPLITMIX_INCREMENT) & MASK_64)
  ) & MASK_64;
  for (let index = 0; index < words.length; index += 1) {
    const next = nextU64(state);
    state = next.state;
    words[index] = next.value;
  }
  const excess = words.length * 64 - sourceCount;
  if (excess > 0) {
    words[words.length - 1] &= (1n << BigInt(64 - excess)) - 1n;
  }
  if (words.every((word) => word === 0n)) {
    setBit(words, symbolId % sourceCount);
  }
  return words;
}

function nextU64(state: bigint): { state: bigint; value: bigint } {
  const nextState = (state + SPLITMIX_INCREMENT) & MASK_64;
  let value = nextState;
  value = ((value ^ (value >> 30n)) * 0xbf58_476d_1ce4_e5b9n) & MASK_64;
  value = ((value ^ (value >> 27n)) * 0x94d0_49bb_1331_11ebn) & MASK_64;
  return { state: nextState, value: (value ^ (value >> 31n)) & MASK_64 };
}

function rotateLeft64(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK_64;
}

function setBit(words: bigint[], index: number): void {
  words[Math.floor(index / 64)] |= 1n << BigInt(index % 64);
}

function bitIsSet(words: bigint[], index: number): boolean {
  return (words[Math.floor(index / 64)] & (1n << BigInt(index % 64))) !== 0n;
}

function xorBytes(left: Uint8Array, right: Uint8Array): void {
  for (let index = 0; index < left.length; index += 1) {
    left[index] ^= right[index];
  }
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

function randomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure browser randomness is unavailable.");
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}
