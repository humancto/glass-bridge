const FRAME_PREFIX = "AGF1B64:";
const FRAME_MAGIC = new Uint8Array([0x41, 0x47, 0x46, 0x31]);
const HEADER_BYTES = 40;
const CRC_BYTES = 4;
const MAX_SOURCE_SYMBOLS = 1_024;
const MAX_SYMBOL_BYTES = 2_048;
const MAX_TRANSFER_BYTES = 2 * 1024 * 1024;
const MAX_UNIQUE_FRAMES = MAX_SOURCE_SYMBOLS * 8;
const MAX_BASE64URL_CHARS = 4_096;
const MASK_64 = (1n << 64n) - 1n;
const SPLITMIX_INCREMENT = 0x9e37_79b9_7f4a_7c15n;

type ParsedFrame = {
  sessionId: Uint8Array;
  sessionHex: string;
  symbolId: number;
  sourceCount: number;
  symbolSize: number;
  payloadLength: number;
  symbol: Uint8Array;
};

type Row = {
  coefficients: bigint[];
  data: Uint8Array;
};

export type TransferProgress = {
  sessionId?: string;
  rank: number;
  required: number;
  acceptedFrames: number;
  duplicateFrames: number;
  rejectedFrames: number;
  complete: boolean;
};

export type IngestResult = TransferProgress & {
  envelope?: Uint8Array;
};

export class OpticalTransferDecoder {
  private sessionId?: Uint8Array;
  private sessionHex?: string;
  private sourceCount = 0;
  private symbolSize = 0;
  private payloadLength = 0;
  private basis: Array<Row | undefined> = [];
  private seenSymbols = new Set<number>();
  private rank = 0;
  private acceptedFrames = 0;
  private duplicateFrames = 0;
  private rejectedFrames = 0;
  private envelope?: Uint8Array;

  ingestText(value: string): IngestResult {
    try {
      return this.ingestFrame(decodeTextFrame(value));
    } catch {
      this.rejectedFrames += 1;
      return this.progress();
    }
  }

  ingestFrame(bytes: Uint8Array): IngestResult {
    if (this.envelope) {
      return this.progress();
    }

    let frame: ParsedFrame;
    try {
      frame = parseFrame(bytes);
      this.initializeOrValidateSession(frame);
    } catch {
      this.rejectedFrames += 1;
      return this.progress();
    }

    if (this.seenSymbols.has(frame.symbolId)) {
      this.duplicateFrames += 1;
      return this.progress();
    }
    if (this.seenSymbols.size >= MAX_UNIQUE_FRAMES) {
      this.rejectedFrames += 1;
      return this.progress();
    }
    this.seenSymbols.add(frame.symbolId);
    this.acceptedFrames += 1;

    const row: Row = {
      coefficients: coefficients(frame.sessionId, frame.symbolId, frame.sourceCount),
      data: frame.symbol.slice(),
    };
    while (true) {
      const pivot = firstSet(row.coefficients, frame.sourceCount);
      if (pivot === undefined) {
        break;
      }
      const existing = this.basis[pivot];
      if (existing) {
        xorWords(row.coefficients, existing.coefficients);
        xorBytes(row.data, existing.data);
      } else {
        this.basis[pivot] = row;
        this.rank += 1;
        break;
      }
    }

    if (this.rank === this.sourceCount) {
      this.envelope = this.solve();
    }
    return this.progress();
  }

  reset(): void {
    this.sessionId = undefined;
    this.sessionHex = undefined;
    this.sourceCount = 0;
    this.symbolSize = 0;
    this.payloadLength = 0;
    this.basis = [];
    this.seenSymbols.clear();
    this.rank = 0;
    this.acceptedFrames = 0;
    this.duplicateFrames = 0;
    this.rejectedFrames = 0;
    this.envelope = undefined;
  }

  snapshot(): TransferProgress {
    return this.progress();
  }

  private initializeOrValidateSession(frame: ParsedFrame): void {
    if (!this.sessionId) {
      this.sessionId = frame.sessionId;
      this.sessionHex = frame.sessionHex;
      this.sourceCount = frame.sourceCount;
      this.symbolSize = frame.symbolSize;
      this.payloadLength = frame.payloadLength;
      this.basis = Array.from({ length: frame.sourceCount });
      return;
    }
    if (
      frame.sessionHex !== this.sessionHex ||
      frame.sourceCount !== this.sourceCount ||
      frame.symbolSize !== this.symbolSize ||
      frame.payloadLength !== this.payloadLength
    ) {
      throw new Error("mixed optical sessions are not accepted");
    }
  }

  private solve(): Uint8Array {
    const solved = Array.from(
      { length: this.sourceCount },
      () => new Uint8Array(this.symbolSize),
    );
    for (let pivot = this.sourceCount - 1; pivot >= 0; pivot -= 1) {
      const row = this.basis[pivot];
      if (!row) {
        throw new Error("decoder basis is incomplete");
      }
      const data = row.data.slice();
      for (let index = pivot + 1; index < this.sourceCount; index += 1) {
        if (bitIsSet(row.coefficients, index)) {
          xorBytes(data, solved[index]);
        }
      }
      solved[pivot] = data;
    }
    const combined = new Uint8Array(this.sourceCount * this.symbolSize);
    solved.forEach((symbol, index) => combined.set(symbol, index * this.symbolSize));
    return combined.slice(0, this.payloadLength);
  }

  private progress(): IngestResult {
    return {
      sessionId: this.sessionHex,
      rank: this.rank,
      required: this.sourceCount,
      acceptedFrames: this.acceptedFrames,
      duplicateFrames: this.duplicateFrames,
      rejectedFrames: this.rejectedFrames,
      complete: this.envelope !== undefined,
      envelope: this.envelope?.slice(),
    };
  }
}

export function decodeTextFrame(value: string): Uint8Array {
  if (!value.startsWith(FRAME_PREFIX)) {
    throw new Error("not a GlassBridge browser frame");
  }
  const bytes = base64UrlDecode(value.slice(FRAME_PREFIX.length));
  if (bytes.length === 0 || bytes.length > HEADER_BYTES + MAX_SYMBOL_BYTES + CRC_BYTES) {
    throw new Error("optical frame exceeds browser receiver limits");
  }
  return bytes;
}

export function base64UrlDecode(value: string): Uint8Array {
  if (value.length === 0 || value.length > MAX_BASE64URL_CHARS || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid base64url data");
  }
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function parseFrame(bytes: Uint8Array): ParsedFrame {
  if (bytes.length < HEADER_BYTES + CRC_BYTES || !equalBytes(bytes.slice(0, 4), FRAME_MAGIC)) {
    throw new Error("invalid optical frame");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const crcOffset = bytes.length - CRC_BYTES;
  if (crc32(bytes.subarray(0, crcOffset)) !== view.getUint32(crcOffset, false)) {
    throw new Error("optical frame CRC failed");
  }
  const sourceCount = view.getUint32(24, false);
  const symbolSize = view.getUint32(28, false);
  const payloadHigh = view.getUint32(32, false);
  const payloadLow = view.getUint32(36, false);
  const payloadLength = payloadHigh * 2 ** 32 + payloadLow;
  if (
    sourceCount === 0 ||
    sourceCount > MAX_SOURCE_SYMBOLS ||
    symbolSize === 0 ||
    symbolSize > MAX_SYMBOL_BYTES ||
    payloadLength === 0 ||
    payloadLength > MAX_TRANSFER_BYTES ||
    payloadLength > sourceCount * symbolSize ||
    bytes.length !== HEADER_BYTES + symbolSize + CRC_BYTES
  ) {
    throw new Error("optical frame exceeds browser receiver limits");
  }
  const sessionId = bytes.slice(4, 20);
  return {
    sessionId,
    sessionHex: toHex(sessionId),
    symbolId: view.getUint32(20, false),
    sourceCount,
    symbolSize,
    payloadLength,
    symbol: bytes.slice(HEADER_BYTES, crcOffset),
  };
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
  let state = (left ^ rotateLeft64(right, 17n) ^ ((BigInt(symbolId) * SPLITMIX_INCREMENT) & MASK_64)) & MASK_64;
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

function firstSet(words: bigint[], maxBits: number): number | undefined {
  for (let index = 0; index < maxBits; index += 1) {
    if (bitIsSet(words, index)) {
      return index;
    }
  }
  return undefined;
}

function xorBytes(left: Uint8Array, right: Uint8Array): void {
  for (let index = 0; index < left.length; index += 1) {
    left[index] ^= right[index];
  }
}

function xorWords(left: bigint[], right: bigint[]): void {
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
