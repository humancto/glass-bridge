export type CaptureDimensions = { width: number; height: number };
export type CaptureRegion = { x: number; y: number; width: number; height: number };

export const GRID_CAPTURE_LONG_EDGE = 960;
export const GRID_CAPTURE_MAX_PIXELS = 960 * 540;

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

/**
 * Grid uses the complete camera field of view but a smaller RGBA raster than
 * dense QR. A 16:9 camera becomes 960x540 (or 540x960 when Safari reports the
 * track rotated), reducing per-exposure bytes by 43.75% from 1280x720.
 */
export function fitGridCaptureDimensions(
  sourceWidth: number,
  sourceHeight: number,
): CaptureDimensions {
  return fitCaptureDimensions(
    sourceWidth,
    sourceHeight,
    GRID_CAPTURE_LONG_EDGE,
    GRID_CAPTURE_MAX_PIXELS,
  );
}

/**
 * Gives each dual-lane decoder one side of the exposure with a small center
 * overlap. Independent QR acquisition is cheaper and more reliable than asking
 * one scanner to locate both dense symbols in the entire camera frame.
 */
export function dualLaneCaptureRegions(
  width: number,
  height: number,
  overlapRatio = 0.08,
): [CaptureRegion, CaptureRegion] {
  if (
    !Number.isSafeInteger(width) || width < 2 ||
    !Number.isSafeInteger(height) || height < 1 ||
    !Number.isFinite(overlapRatio) || overlapRatio < 0 || overlapRatio > 0.25
  ) {
    throw new Error("Dual-lane capture requires valid dimensions and overlap.");
  }
  const middle = Math.floor(width / 2);
  const overlap = Math.min(middle, Math.max(8, Math.floor(width * overlapRatio)));
  return [
    { x: 0, y: 0, width: Math.min(width, middle + overlap), height },
    { x: Math.max(0, middle - overlap), y: 0, width: width - Math.max(0, middle - overlap), height },
  ];
}
