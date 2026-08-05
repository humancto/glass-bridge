import { describe, expect, it } from "vitest";
import { dualLaneCaptureRegions, fitCaptureDimensions } from "../src/receiver/camera-capture";

describe("camera capture sizing", () => {
  it("preserves a full 1280x720 landscape frame for two optical lanes", () => {
    expect(fitCaptureDimensions(1_280, 720)).toEqual({ width: 1_280, height: 720 });
    expect(fitCaptureDimensions(1_920, 1_080)).toEqual({ width: 1_280, height: 720 });
  });

  it("preserves the full pixel budget when Safari labels a landscape feed as portrait", () => {
    expect(fitCaptureDimensions(720, 1_280)).toEqual({ width: 720, height: 1_280 });
    expect(fitCaptureDimensions(1_080, 1_920)).toEqual({ width: 720, height: 1_280 });
  });

  it("rejects invalid dimensions", () => {
    expect(() => fitCaptureDimensions(0, 720)).toThrow(/positive/);
  });
});

describe("dual-lane camera regions", () => {
  it("splits a landscape exposure into overlapping left and right decoders", () => {
    expect(dualLaneCaptureRegions(1_280, 720)).toEqual([
      { x: 0, y: 0, width: 742, height: 720 },
      { x: 538, y: 0, width: 742, height: 720 },
    ]);
  });

  it("preserves overlap for portrait-shaped Safari camera tracks", () => {
    const [left, right] = dualLaneCaptureRegions(720, 1_280);
    expect(left.width).toBe(417);
    expect(right.x).toBe(303);
    expect(right.width).toBe(417);
  });

  it("rejects unsafe dimensions and overlap", () => {
    expect(() => dualLaneCaptureRegions(1, 720)).toThrow(/valid dimensions/);
    expect(() => dualLaneCaptureRegions(720, 1_280, 0.5)).toThrow(/valid dimensions/);
  });
});
