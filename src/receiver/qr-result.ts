import { ResultMetadataType } from "@zxing/library";
import { OpticalTransferDecoder, type IngestResult } from "./transport";

const TEXT_FRAME_PREFIX = "AGF1B64:";
const FRAME_OVERHEAD_BYTES = 44;
const MAX_SYMBOL_BYTES = 2_048;

export type DecodedQrResult = {
  getText(): string;
  getResultMetadata(): ReadonlyMap<ResultMetadataType, object>;
};

/**
 * ZXing's raw result bytes include QR data codewords, not just the byte segment.
 * BYTE_SEGMENTS is the byte-exact payload emitted by qrcode's binary mode.
 */
export function ingestDecodedQr(
  result: DecodedQrResult,
  decoder: OpticalTransferDecoder,
): IngestResult {
  const text = result.getText();
  const byteSegments = result.getResultMetadata().get(ResultMetadataType.BYTE_SEGMENTS);
  if (
    Array.isArray(byteSegments) &&
    byteSegments.length === 1 &&
    byteSegments[0] instanceof Uint8Array &&
    isStructuralBinaryFrame(byteSegments[0])
  ) {
    return decoder.ingestFrame(byteSegments[0]);
  }
  if (text.startsWith(TEXT_FRAME_PREFIX)) {
    return decoder.ingestText(text);
  }
  return decoder.ingestText(text);
}

function isStructuralBinaryFrame(bytes: Uint8Array): boolean {
  if (
    bytes.length <= FRAME_OVERHEAD_BYTES ||
    bytes[0] !== 0x41 ||
    bytes[1] !== 0x47 ||
    bytes[2] !== 0x46 ||
    bytes[3] !== 0x31
  ) {
    return false;
  }
  const symbolSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    .getUint32(28, false);
  return (
    symbolSize > 0 &&
    symbolSize <= MAX_SYMBOL_BYTES &&
    bytes.length === FRAME_OVERHEAD_BYTES + symbolSize
  );
}
