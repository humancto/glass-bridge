import { describe, expect, it } from "vitest";
import {
  CameraExposureTracker,
  createVideoFrameExposureObservation,
} from "../src/receiver/camera-exposure";

describe("CameraExposureTracker", () => {
  it("counts iPhone rVFC callbacks when mediaTime is stuck but presentedFrames advances", () => {
    const tracker = new CameraExposureTracker();

    for (let callback = 0; callback < 600; callback += 1) {
      tracker.observe(createVideoFrameExposureObservation({
        mediaTime: 0,
        presentedFrames: callback + 1,
        presentationTime: 0,
      }, 0));
    }

    expect(tracker.callbackFrames).toBe(600);
    expect(tracker.cameraExposures).toBe(600);
    expect(tracker.duplicateCallbacks).toBe(0);
  });

  it("deduplicates rAF callbacks using video.currentTime when rVFC is unavailable", () => {
    const tracker = new CameraExposureTracker();

    for (let callback = 0; callback < 60; callback += 1) {
      tracker.observe({ currentTime: Math.floor(callback / 2) / 30 });
    }

    expect(tracker.callbackFrames).toBe(60);
    expect(tracker.cameraExposures).toBe(30);
    expect(tracker.duplicateCallbacks).toBe(30);
  });

  it("uses currentTime when mediaTime is present but stuck and presentedFrames is unavailable", () => {
    const tracker = new CameraExposureTracker();

    for (let callback = 0; callback < 60; callback += 1) {
      tracker.observe({ mediaTime: 0, currentTime: callback / 30 });
    }

    expect(tracker.cameraExposures).toBe(60);
    expect(tracker.duplicateCallbacks).toBe(0);
  });

  it("does not double-count repeated callbacks for one presented frame", () => {
    const tracker = new CameraExposureTracker();

    tracker.observe({ mediaTime: 0, presentedFrames: 1, presentationTime: 10, currentTime: 0 });
    tracker.observe({ mediaTime: 0, presentedFrames: 1, presentationTime: 20, currentTime: 1 / 60 });

    expect(tracker.callbackFrames).toBe(2);
    expect(tracker.cameraExposures).toBe(1);
    expect(tracker.duplicateCallbacks).toBe(1);
  });

  it("accepts a jump in presentedFrames as one newly delivered callback", () => {
    const tracker = new CameraExposureTracker();

    tracker.observe({ mediaTime: 0, presentedFrames: 1, presentationTime: 10, currentTime: 0 });
    tracker.observe({ mediaTime: 0, presentedFrames: 4, presentationTime: 20, currentTime: 0 });

    expect(tracker.cameraExposures).toBe(2);
    expect(tracker.duplicateCallbacks).toBe(0);
  });

  it("uses presentationTime when a non-conforming rVFC counter regresses", () => {
    const tracker = new CameraExposureTracker();

    tracker.observe({ mediaTime: 0, presentedFrames: 4, presentationTime: 10, currentTime: 0 });
    tracker.observe({ mediaTime: 0, presentedFrames: 3, presentationTime: 20, currentTime: 0 });

    expect(tracker.cameraExposures).toBe(2);
    expect(tracker.duplicateCallbacks).toBe(0);
  });

  it("uses presentationTime when presentedFrames is missing", () => {
    const tracker = new CameraExposureTracker();

    tracker.observe({ mediaTime: 0, presentationTime: 10, currentTime: 0 });
    tracker.observe({ mediaTime: 0, presentationTime: 20, currentTime: 0 });

    expect(tracker.cameraExposures).toBe(2);
    expect(tracker.duplicateCallbacks).toBe(0);
  });
});
