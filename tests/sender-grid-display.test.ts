import { describe, expect, it, vi } from "vitest";
import {
  fitGridDisplay,
  GRID_ACQUISITION_PREAMBLE_MS,
  requestGridFullscreen,
} from "../src/sender/grid-display";

describe("sender Grid presentation", () => {
  it("fills a 1280x720 optical stage with equal five-pixel cells", () => {
    expect(fitGridDisplay(1_280, 720)).toEqual({
      scale: 5,
      width: 1_240,
      height: 680,
    });
  });

  it("rounds down to an integer cell scale instead of resampling the raster", () => {
    const fitted = fitGridDisplay(1_182, 648);
    expect(fitted).toEqual({ scale: 4, width: 992, height: 544 });
    expect(fitted.width % 248).toBe(0);
    expect(fitted.height % 136).toBe(0);
  });

  it("preserves a bounded acquisition preamble before animated scheduling", () => {
    expect(GRID_ACQUISITION_PREAMBLE_MS).toBe(1_000);
  });

  it("waits for raster-only fullscreen before resolving", async () => {
    let releaseFullscreen!: () => void;
    let resolved = false;
    const pendingFullscreen = new Promise<void>((resolve) => { releaseFullscreen = resolve; });
    const target = { requestFullscreen: () => pendingFullscreen };

    const entry = requestGridFullscreen(target, null).then(() => { resolved = true; });
    await Promise.resolve();
    expect(resolved).toBe(false);

    releaseFullscreen();
    await entry;
    expect(resolved).toBe(true);
  });

  it("does not request fullscreen twice when the raster already owns it", async () => {
    const requestFullscreen = vi.fn(async () => undefined);
    const target = { requestFullscreen };

    await requestGridFullscreen(target, target);
    expect(requestFullscreen).not.toHaveBeenCalled();
  });

  it("rejects invalid display bounds", () => {
    expect(() => fitGridDisplay(0, 720)).toThrow("positive finite");
    expect(() => fitGridDisplay(1_280, Number.NaN)).toThrow("positive finite");
  });
});
