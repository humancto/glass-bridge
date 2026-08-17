import { GRID_TOTAL_COLUMNS, GRID_TOTAL_ROWS } from "../phy/grid/grid-codec";

export const GRID_ACQUISITION_PREAMBLE_MS = 1_000;

type FullscreenTarget = {
  requestFullscreen(): Promise<void>;
};

/**
 * Enters raster-only fullscreen and resolves only after the browser confirms
 * the transition. The sender starts its acquisition preamble after this
 * promise, so none of the lock window is spent resizing the page.
 */
export async function requestGridFullscreen(
  target: FullscreenTarget | null,
  currentFullscreenElement: unknown,
): Promise<void> {
  if (!target) throw new Error("The Grid display is not ready for fullscreen.");
  if (currentFullscreenElement !== target) await target.requestFullscreen();
}

export type GridDisplaySize = {
  scale: number;
  width: number;
  height: number;
};

/**
 * Fits the logical Grid raster into the available CSS pixel rectangle without
 * fractional cell scaling. Keeping every module an equal integer-sized square
 * avoids adding a browser-resampling step before the camera sees the field.
 */
export function fitGridDisplay(
  availableWidth: number,
  availableHeight: number,
): GridDisplaySize {
  if (
    !Number.isFinite(availableWidth) || availableWidth <= 0 ||
    !Number.isFinite(availableHeight) || availableHeight <= 0
  ) {
    throw new Error("Grid display bounds must be positive finite values.");
  }
  const scale = Math.max(1, Math.floor(Math.min(
    availableWidth / GRID_TOTAL_COLUMNS,
    availableHeight / GRID_TOTAL_ROWS,
  )));
  return {
    scale,
    width: GRID_TOTAL_COLUMNS * scale,
    height: GRID_TOTAL_ROWS * scale,
  };
}
