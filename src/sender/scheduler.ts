export type FrameSchedule = {
  deadlineMs: number;
  delayMs: number;
};

/**
 * Advances a target-clock schedule without adding QR render time to every frame.
 * A sender that falls more than one interval behind catches up once, then resumes
 * normal pacing instead of entering an unbounded zero-delay loop.
 */
export function scheduleNextFrame(
  previousDeadlineMs: number,
  renderedAtMs: number,
  fps: number,
): FrameSchedule {
  if (
    !Number.isFinite(previousDeadlineMs) ||
    !Number.isFinite(renderedAtMs) ||
    !Number.isFinite(fps) ||
    fps <= 0
  ) {
    throw new Error("Frame scheduling requires finite timestamps and a positive FPS.");
  }
  const intervalMs = 1_000 / fps;
  const candidate = previousDeadlineMs + intervalMs;
  const deadlineMs = candidate < renderedAtMs - intervalMs ? renderedAtMs : candidate;
  return {
    deadlineMs,
    delayMs: Math.max(0, deadlineMs - renderedAtMs),
  };
}
