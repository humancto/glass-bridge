import { describe, expect, it } from "vitest";
import { fitCaptureDimensions } from "../src/receiver/camera-capture";

describe("camera capture sizing", () => {
  it("preserves a full 1280x720 landscape frame for two optical lanes", () => {
    expect(fitCaptureDimensions(1_280, 720)).toEqual({ width: 1_280, height: 720 });
    expect(fitCaptureDimensions(1_920, 1_080)).toEqual({ width: 1_280, height: 720 });
  });

  it("preserves portrait aspect ratio instead of center-cropping", () => {
    expect(fitCaptureDimensions(1_080, 1_920)).toEqual({ width: 405, height: 720 });
  });

  it("rejects invalid dimensions", () => {
    expect(() => fitCaptureDimensions(0, 720)).toThrow(/positive/);
  });
});
