import { ResultMetadataType } from "@zxing/library";
import { OpticalTransferDecoder, type IngestResult } from "./transport";
import { classifyOpticalCodeCandidate } from "./decode-metrics";

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
  const bytes = Array.isArray(byteSegments) &&
      byteSegments.length === 1 &&
      byteSegments[0] instanceof Uint8Array
    ? byteSegments[0]
    : undefined;
  const candidate = classifyOpticalCodeCandidate(bytes, text);
  if (candidate?.kind === "binary") return decoder.ingestFrame(candidate.value);
  if (candidate?.kind === "text") return decoder.ingestText(candidate.value);
  return decoder.snapshot();
}
