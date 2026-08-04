import { ResultMetadataType } from "@zxing/library";
import { OpticalTransferDecoder, type IngestResult } from "./transport";

const TEXT_FRAME_PREFIX = "AGF1B64:";

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
  if (text.startsWith(TEXT_FRAME_PREFIX)) {
    return decoder.ingestText(text);
  }

  const byteSegments = result.getResultMetadata().get(ResultMetadataType.BYTE_SEGMENTS);
  if (
    Array.isArray(byteSegments) &&
    byteSegments.length === 1 &&
    byteSegments[0] instanceof Uint8Array
  ) {
    return decoder.ingestFrame(byteSegments[0]);
  }
  return decoder.ingestText(text);
}

