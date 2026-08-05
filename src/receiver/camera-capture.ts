export type CaptureDimensions = { width: number; height: number };

/**
 * Preserve the complete camera field of view while bounding decoder work by
 * long edge and total pixels. The symmetric bounds are intentional: Safari
 * may report a landscape phone camera as a portrait-shaped track.
 */
export function fitCaptureDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxLongEdge = 1_280,
  maxPixels = 1_280 * 720,
): CaptureDimensions {
  if (![sourceWidth, sourceHeight, maxLongEdge, maxPixels].every(Number.isFinite)) {
    throw new Error("Camera dimensions must be finite.");
  }
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxLongEdge <= 0 || maxPixels <= 0) {
    throw new Error("Camera dimensions must be positive.");
  }
  const scale = Math.min(
    1,
    maxLongEdge / Math.max(sourceWidth, sourceHeight),
    Math.sqrt(maxPixels / (sourceWidth * sourceHeight)),
  );
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}
