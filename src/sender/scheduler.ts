export type FrameSchedule = {
  deadlineMs: number;
  delayMs: number;
};

export type RefreshSymbols = {
  count: number;
  credit: number;
  dropped: number;
};

/**
 * Converts a combined symbol-rate target into work for one display refresh.
 * A dual-lane sender can commit at most two distinct codes per refresh. Work
 * that missed its display opportunity is reported, not replayed in a burst,
 * because an optical receiver cannot observe frames that were never visible.
 */
export function symbolsForRefresh(
  previousCredit: number,
  elapsedMs: number,
  symbolsPerSecond: number,
  maxSymbolsPerRefresh: number,
): RefreshSymbols {
  if (
    !Number.isFinite(previousCredit) || previousCredit < 0 || previousCredit >= 1 ||
    !Number.isFinite(elapsedMs) || elapsedMs < 0 ||
    !Number.isFinite(symbolsPerSecond) || symbolsPerSecond <= 0 ||
    !Number.isSafeInteger(maxSymbolsPerRefresh) || maxSymbolsPerRefresh <= 0
  ) {
    throw new Error("Refresh scheduling requires valid credit, timing, rate, and lane capacity.");
  }
  const accrued = previousCredit + elapsedMs * symbolsPerSecond / 1_000;
  const requested = Math.floor(accrued + 1e-9);
  return {
    count: Math.min(requested, maxSymbolsPerRefresh),
    credit: accrued - Math.floor(accrued),
    dropped: Math.max(0, requested - maxSymbolsPerRefresh),
  };
}

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
