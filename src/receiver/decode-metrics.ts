import type { TransferProgress } from "./transport";

const TEXT_FRAME_PREFIX = "AGF1B64:";
const FRAME_OVERHEAD_BYTES = 44;
const MAX_SYMBOL_BYTES = 2_909;

export type OpticalCodeCandidate =
  | { kind: "binary"; value: Uint8Array }
  | { kind: "text"; value: string };

/**
 * A barcode/Grid decode is transport-valid only when the bounded AGF parser
 * accepts it as a new symbol or a duplicate. ZXing validity and Grid magic are
 * acquisition hints; neither includes the AGF CRC/session/profile decision.
 */
export function didTransportAcceptFrame(
  before: TransferProgress,
  after: TransferProgress,
): boolean {
  return after.acceptedFrames > before.acceptedFrames ||
    after.duplicateFrames > before.duplicateFrames;
}

/**
 * ZXing can decode the stationary pairing URL or an unrelated QR perfectly.
 * Those are acquisition observations, not malformed GlassBridge transport
 * frames, and must not consume the transport rejection budget.
 */
export function isOpticalTextFrameCandidate(value: string | undefined): value is string {
  return value?.startsWith(TEXT_FRAME_PREFIX) === true;
}

/**
 * Checks the declared symbol length as well as the AGF magic. Text-mode legacy
 * QR results expose raw ASCII bytes beginning with `AGF1`; a magic-only test
 * would misroute those bytes to the binary parser.
 */
export function isOpticalBinaryFrameCandidate(bytes: Uint8Array | undefined): bytes is Uint8Array {
  if (
    !bytes ||
    bytes.length <= FRAME_OVERHEAD_BYTES ||
    bytes[0] !== 0x41 ||
    bytes[1] !== 0x47 ||
    bytes[2] !== 0x46 ||
    (bytes[3] !== 0x31 && bytes[3] !== 0x32)
  ) {
    return false;
  }
  const symbolSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(28, false);
  return symbolSize > 0 &&
    symbolSize <= MAX_SYMBOL_BYTES &&
    bytes.length === FRAME_OVERHEAD_BYTES + symbolSize;
}

export function classifyOpticalCodeCandidate(
  bytes: Uint8Array | undefined,
  text: string | undefined,
): OpticalCodeCandidate | undefined {
  if (isOpticalBinaryFrameCandidate(bytes)) return { kind: "binary", value: bytes };
  if (isOpticalTextFrameCandidate(text)) return { kind: "text", value: text };
  return undefined;
}
