import type { GridDecodeOutcome } from "../phy/grid/grid-codec";

export const GRID_INITIAL_ACQUISITION_TIMEOUT_MS = 20_000;
export const GRID_TRANSFER_STALL_MS = 10_000;
export const GRID_CAMERA_SESSION_LIMIT_MS = 120_000;

export function gridDecodeTargetFps(symbolRate: number): number {
  if (!Number.isFinite(symbolRate) || symbolRate <= 0) {
    throw new Error("Grid symbol rate must be positive and finite.");
  }
  return Math.min(60, Math.max(12, Math.ceil(symbolRate * 2)));
}

export function gridEmptyJobLimit(symbolRate: number): number {
  return gridDecodeTargetFps(symbolRate) * GRID_TRANSFER_STALL_MS / 1_000;
}

export function shouldPauseGridAcquisition(input: {
  symbolRate: number;
  consecutiveNonProgressJobs: number;
  elapsedSinceProgressMs: number;
  hasAcceptedFrame: boolean;
}): boolean {
  if (!Number.isSafeInteger(input.consecutiveNonProgressJobs) || input.consecutiveNonProgressJobs < 0) {
    throw new Error("Grid non-progress job count must be a non-negative integer.");
  }
  if (!Number.isFinite(input.elapsedSinceProgressMs) || input.elapsedSinceProgressMs < 0) {
    throw new Error("Grid acquisition elapsed time must be non-negative and finite.");
  }
  const timeout = input.hasAcceptedFrame
    ? GRID_TRANSFER_STALL_MS
    : GRID_INITIAL_ACQUISITION_TIMEOUT_MS;
  return input.consecutiveNonProgressJobs >= gridEmptyJobLimit(input.symbolRate) &&
    input.elapsedSinceProgressMs >= timeout;
}

export function didGridTransportAdvance(
  previous: { acceptedFrames: number; rank: number },
  next: { acceptedFrames: number; rank: number },
): boolean {
  return next.acceptedFrames > previous.acceptedFrames;
}

export function shouldEndGridCameraSession(elapsedMs: number): boolean {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
    throw new Error("Grid camera-session elapsed time must be non-negative and finite.");
  }
  return elapsedMs >= GRID_CAMERA_SESSION_LIMIT_MS;
}

export function gridAcquisitionGuidance(
  outcome: GridDecodeOutcome | undefined,
  hasAcceptedFrame = false,
): string {
  if (hasAcceptedFrame) {
    return "No new valid optical symbol arrived for ten seconds, so scanning stopped. Keep every Grid corner visible and restart the sender at 10 symbols/s.";
  }
  switch (outcome) {
    case "markers-not-found":
      return "The Grid corners were not acquired. Use sender fullscreen, turn the phone landscape, and keep all four colored markers inside the guide.";
    case "geometry-invalid":
      return "The Grid corners were visible but did not form one stable screen. Fill the guide with only the sender display and hold the phone still.";
    case "contrast-low":
      return "The Grid was registered but contrast was too low. Increase sender brightness, avoid glare, and wait for camera focus before retrying.";
    case "frame-magic-invalid":
      return "The Grid was registered but its cells were not intact. Move closer, use sender fullscreen, and retry at 10 symbols/s.";
    case "invalid-image":
      return "The camera frame could not be sampled. Restart the receiver camera and retry.";
    default:
      return "No intact Grid symbol arrived within twenty seconds. Use sender fullscreen, hold the phone landscape, and retry at 10 symbols/s.";
  }
}

export function gridSessionLimitGuidance(): string {
  return "The 120-second Grid lab session limit was reached, so scanning stopped and no incomplete file was released. Restart the receiver and sender to run another measurement.";
}
