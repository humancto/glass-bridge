export type CaptureDimensions = { width: number; height: number };
export type CaptureRegion = { x: number; y: number; width: number; height: number };
export type CaptureLayout = {
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
  laneRegions?: [CaptureRegion, CaptureRegion];
};

type StoppableStream = Pick<MediaStream, "getTracks">;

export const GRID_CAPTURE_LONG_EDGE = 960;
export const GRID_CAPTURE_MAX_PIXELS = 960 * 540;

/**
 * Owns one asynchronous camera startup attempt. Every start, stop, reset, or
 * unmount advances the generation, so a late getUserMedia/video.play result
 * cannot become the active scanner. A stale stream is stopped immediately.
 */
export class CameraStartGuard {
  private generation = 0;
  private pendingStream?: { generation: number; stream: StoppableStream };

  begin(): number {
    this.generation += 1;
    this.stopPendingStream();
    return this.generation;
  }

  cancel(): void {
    this.generation += 1;
    this.stopPendingStream();
  }

  cancelIfCurrent(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    this.generation += 1;
    this.stopPendingStream();
    return true;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  trackStream(generation: number, stream: StoppableStream): boolean {
    if (!this.isCurrent(generation)) {
      stopMediaStream(stream);
      return false;
    }
    this.stopPendingStream();
    this.pendingStream = { generation, stream };
    return true;
  }

  activate(generation: number): boolean {
    if (!this.isCurrent(generation)) return false;
    if (this.pendingStream?.generation === generation) this.pendingStream = undefined;
    return true;
  }

  disposeIfStale(generation: number, stream?: StoppableStream): boolean {
    if (this.isCurrent(generation)) return false;
    stopMediaStream(stream);
    return true;
  }

  private stopPendingStream(): void {
    stopMediaStream(this.pendingStream?.stream);
    this.pendingStream = undefined;
  }
}

export function stopMediaStream(stream?: StoppableStream): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

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
 * Builds one internally consistent capture geometry from the video's current
 * intrinsic dimensions. Both orientations preserve the complete field of view;
 * dual-lane crops are always derived from the same bounded output raster.
 */
export function createCaptureLayout(
  sourceWidth: number,
  sourceHeight: number,
  visualMode: "grid" | "qr",
  lanes: 1 | 2,
): CaptureLayout {
  const dimensions = visualMode === "grid"
    ? fitGridCaptureDimensions(sourceWidth, sourceHeight)
    : fitCaptureDimensions(sourceWidth, sourceHeight);
  return {
    sourceWidth,
    sourceHeight,
    width: dimensions.width,
    height: dimensions.height,
    laneRegions: visualMode === "qr" && lanes === 2
      ? dualLaneCaptureRegions(dimensions.width, dimensions.height)
      : undefined,
  };
}

export function captureLayoutsEqual(left: CaptureLayout, right: CaptureLayout): boolean {
  return left.sourceWidth === right.sourceWidth &&
    left.sourceHeight === right.sourceHeight &&
    left.width === right.width &&
    left.height === right.height &&
    equalRegions(left.laneRegions, right.laneRegions);
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

function equalRegions(
  left: [CaptureRegion, CaptureRegion] | undefined,
  right: [CaptureRegion, CaptureRegion] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.every((region, index) => {
    const candidate = right[index];
    return region.x === candidate.x &&
      region.y === candidate.y &&
      region.width === candidate.width &&
      region.height === candidate.height;
  });
}
