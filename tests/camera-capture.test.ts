import { describe, expect, it } from "vitest";
import {
  CameraStartGuard,
  cameraVideoConstraints,
  captureLayoutsEqual,
  centeredCoverRegion,
  createCaptureLayout,
  dualLaneCaptureRegions,
  fitCaptureDimensions,
  fitGridCaptureDimensions,
} from "../src/receiver/camera-capture";

describe("camera startup generation guard", () => {
  it("stops a stream that resolves after startup was cancelled", async () => {
    const guard = new CameraStartGuard();
    const generation = guard.begin();
    const late = deferred<FakeStream>();
    const startup = late.promise.then((stream) => guard.trackStream(generation, stream));

    guard.cancel();
    const stream = new FakeStream();
    late.resolve(stream);

    await expect(startup).resolves.toBe(false);
    expect(stream.stopCount).toBe(1);
    expect(guard.isCurrent(generation)).toBe(false);
  });

  it("stops an acquired stream immediately when cancelled during video.play", async () => {
    const guard = new CameraStartGuard();
    const generation = guard.begin();
    const stream = new FakeStream();
    expect(guard.trackStream(generation, stream)).toBe(true);

    const play = deferred<void>();
    const startup = play.promise.then(() => {
      if (guard.disposeIfStale(generation, stream)) return false;
      return guard.activate(generation);
    });
    guard.cancel();

    expect(stream.stopCount).toBe(1);
    play.resolve();
    await expect(startup).resolves.toBe(false);
    expect(guard.isCurrent(generation)).toBe(false);
  });

  it("does not let stale controls cancel a newer startup generation", () => {
    const guard = new CameraStartGuard();
    const staleGeneration = guard.begin();
    const currentGeneration = guard.begin();

    expect(guard.cancelIfCurrent(staleGeneration)).toBe(false);
    expect(guard.isCurrent(currentGeneration)).toBe(true);
  });
});

describe("camera capture sizing", () => {
  it("prioritizes 1080p-class spatial resolution over forced 60 fps for Grid", () => {
    expect(cameraVideoConstraints("grid")).toMatchObject({
      width: { ideal: 1_920 },
      height: { ideal: 1_080 },
      frameRate: { ideal: 30, max: 30 },
    });
    expect(cameraVideoConstraints("qr", true).frameRate).toEqual({ exact: 60 });
    expect(cameraVideoConstraints("qr", false).frameRate).toEqual({ ideal: 60 });
  });

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

describe("Grid camera capture sizing", () => {
  it("reduces a 16:9 Grid decode raster to 960x540 without cropping", () => {
    expect(fitGridCaptureDimensions(1_280, 720)).toEqual({ width: 960, height: 540 });
    expect(fitGridCaptureDimensions(1_920, 1_080)).toEqual({ width: 960, height: 540 });
  });

  it("keeps a fixed 16:9 Grid decoder for a portrait-shaped Safari source", () => {
    expect(fitGridCaptureDimensions(720, 1_280)).toEqual({ width: 960, height: 540 });
  });

  it("uses the fixed Grid decoder for sources below the output budget", () => {
    expect(fitGridCaptureDimensions(640, 360)).toEqual({ width: 960, height: 540 });
  });

  it("matches the centered 16:9 preview crop for portrait and landscape sources", () => {
    const portrait = createCaptureLayout(720, 1_280, "grid", 1);
    const samePortrait = createCaptureLayout(720, 1_280, "grid", 1);
    const landscape = createCaptureLayout(1_280, 720, "grid", 1);

    expect(portrait).toMatchObject({
      sourceWidth: 720,
      sourceHeight: 1_280,
      sourceRegion: { x: 0, y: 437, width: 720, height: 405 },
      width: 960,
      height: 540,
    });
    expect(captureLayoutsEqual(portrait, samePortrait)).toBe(true);
    expect(captureLayoutsEqual(portrait, landscape)).toBe(false);
    expect(landscape).toMatchObject({
      sourceWidth: 1_280,
      sourceHeight: 720,
      sourceRegion: { x: 0, y: 0, width: 1_280, height: 720 },
      width: 960,
      height: 540,
    });
    expect(portrait.width / portrait.height).toBeCloseTo(16 / 9);
    expect(landscape.width / landscape.height).toBeCloseTo(16 / 9);
    expect(centeredCoverRegion(1_280, 720)).toEqual({ x: 0, y: 0, width: 1_280, height: 720 });
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

  it("recomputes both QR lane crops after a portrait-to-landscape change", () => {
    const portrait = createCaptureLayout(720, 1_280, "qr", 2);
    const landscape = createCaptureLayout(1_280, 720, "qr", 2);
    expect(portrait.laneRegions).toEqual(dualLaneCaptureRegions(720, 1_280));
    expect(landscape.laneRegions).toEqual(dualLaneCaptureRegions(1_280, 720));
    expect(captureLayoutsEqual(portrait, landscape)).toBe(false);
  });
});

class FakeStream {
  stopCount = 0;

  getTracks(): MediaStreamTrack[] {
    return [{ stop: () => { this.stopCount += 1; } } as MediaStreamTrack];
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
