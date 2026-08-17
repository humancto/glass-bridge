export type CameraExposureObservation = {
  mediaTime?: number;
  presentedFrames?: number;
  presentationTime?: number;
  currentTime?: number;
};

type VideoFrameMetadataLike = Pick<
  VideoFrameCallbackMetadata,
  "mediaTime" | "presentedFrames" | "presentationTime"
>;

export function createVideoFrameExposureObservation(
  metadata: VideoFrameMetadataLike,
  currentTime: number,
): CameraExposureObservation {
  return {
    mediaTime: metadata.mediaTime,
    presentedFrames: metadata.presentedFrames,
    presentationTime: metadata.presentationTime,
    currentTime,
  };
}

/**
 * Counts camera exposures without assuming every browser implements every
 * requestVideoFrameCallback metadata field correctly.
 *
 * presentedFrames is preferred when it is available because it is an explicit
 * presentation counter. presentationTime is the secondary rVFC signal when
 * that counter is missing or regresses. mediaTime and currentTime cover older
 * callback implementations and the requestAnimationFrame fallback.
 */
export class CameraExposureTracker {
  callbackFrames = 0;
  cameraExposures = 0;
  duplicateCallbacks = 0;

  private lastPresentedFrames: number | undefined;
  private lastPresentationTime: number | undefined;
  private lastMediaTime: number | undefined;
  private lastCurrentTime: number | undefined;

  observe(observation: number | CameraExposureObservation): boolean {
    this.callbackFrames += 1;
    const sample = typeof observation === "number"
      ? { mediaTime: observation }
      : observation;
    const presentedFrames = positiveInteger(sample.presentedFrames);
    const presentationTime = finiteNonNegative(sample.presentationTime);
    const mediaTime = finiteNonNegative(sample.mediaTime);
    const currentTime = finiteNonNegative(sample.currentTime);

    let isNewExposure = false;
    if (presentedFrames !== undefined) {
      const firstPresentedFrame = this.lastPresentedFrames === undefined;
      const presentedFrameAdvanced = !firstPresentedFrame &&
        presentedFrames > this.lastPresentedFrames!;
      const presentedFrameRepeated = !firstPresentedFrame &&
        presentedFrames === this.lastPresentedFrames;
      isNewExposure = firstPresentedFrame || presentedFrameAdvanced || (
        !presentedFrameRepeated && fallbackAdvanced(
          presentationTime,
          this.lastPresentationTime,
          mediaTime,
          this.lastMediaTime,
          currentTime,
          this.lastCurrentTime,
        )
      );
    } else {
      isNewExposure = fallbackAdvanced(
        presentationTime,
        this.lastPresentationTime,
        mediaTime,
        this.lastMediaTime,
        currentTime,
        this.lastCurrentTime,
      );
    }

    this.lastPresentedFrames = greatest(this.lastPresentedFrames, presentedFrames);
    this.lastPresentationTime = greatest(this.lastPresentationTime, presentationTime);
    this.lastMediaTime = greatest(this.lastMediaTime, mediaTime);
    this.lastCurrentTime = greatest(this.lastCurrentTime, currentTime);

    if (!isNewExposure) {
      this.duplicateCallbacks += 1;
      return false;
    }
    this.cameraExposures += 1;
    return true;
  }
}

function positiveInteger(value: number | undefined): number | undefined {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value : undefined;
}

function finiteNonNegative(value: number | undefined): number | undefined {
  return Number.isFinite(value) && (value ?? -1) >= 0 ? value : undefined;
}

function advanced(current: number | undefined, previous: number | undefined): boolean {
  if (current === undefined) return false;
  return previous === undefined || current > previous + 1e-6;
}

function fallbackAdvanced(
  presentationTime: number | undefined,
  lastPresentationTime: number | undefined,
  mediaTime: number | undefined,
  lastMediaTime: number | undefined,
  currentTime: number | undefined,
  lastCurrentTime: number | undefined,
): boolean {
  return advanced(presentationTime, lastPresentationTime) ||
    advanced(mediaTime, lastMediaTime) ||
    advanced(currentTime, lastCurrentTime);
}

function greatest(previous: number | undefined, current: number | undefined): number | undefined {
  if (current === undefined) return previous;
  return previous === undefined ? current : Math.max(previous, current);
}
