export type CaptureDimensions = { width: number; height: number };

/** Preserve the complete camera field of view while bounding decoder work. */
export function fitCaptureDimensions(
  sourceWidth: number,
  sourceHeight: number,
  maxWidth = 1_280,
  maxHeight = 720,
): CaptureDimensions {
  if (![sourceWidth, sourceHeight, maxWidth, maxHeight].every(Number.isFinite)) {
    throw new Error("Camera dimensions must be finite.");
  }
  if (sourceWidth <= 0 || sourceHeight <= 0 || maxWidth <= 0 || maxHeight <= 0) {
    throw new Error("Camera dimensions must be positive.");
  }
  const scale = Math.min(1, maxWidth / sourceWidth, maxHeight / sourceHeight);
  return {
    width: Math.max(1, Math.floor(sourceWidth * scale)),
    height: Math.max(1, Math.floor(sourceHeight * scale)),
  };
}
