import { describe, expect, it } from "vitest";
import {
  decodeGridFrame,
  decodeGridModules,
  encodeGridModules,
  GRID_FRAME_BYTES,
  renderGridFrame,
  tryDecodeGridFrame,
  type PixelBuffer,
} from "../src/phy/grid/grid-codec";
import { OPTICAL_PROFILES } from "../src/protocol/optical-profile";
import { OpticalTransferDecoder } from "../src/receiver/transport";
import { OpticalTransferEncoder } from "../src/sender/transport";

describe("registered monochrome Grid PHY", () => {
  it("recovers one AGF2 frame from the exact rendered grid", () => {
    const encoder = makeEncoder(deterministicBytes(8_192));
    const expected = encoder.frameBytes(0);
    const result = tryDecodeGridFrame(renderGridFrame(expected));

    expect(expected).toHaveLength(GRID_FRAME_BYTES);
    expect(result?.frame).toEqual(expected);
    expect(result?.contrast).toBeGreaterThan(200);
  });

  it("uses orientation-distinct fiducials to recover a rotated camera raster", () => {
    const encoder = makeEncoder(deterministicBytes(8_192));
    const expected = encoder.frameBytes(7);
    const captured = rotateClockwise(upscale(renderGridFrame(expected), 4));
    const result = tryDecodeGridFrame(captured);

    expect(result?.frame).toEqual(expected);
    expect(result?.screenFillRatio).toBeGreaterThan(0.5);
  });

  it("recovers through camera-scale skew, brightness loss, and deterministic sensor noise", () => {
    const encoder = makeEncoder(deterministicBytes(8_192));
    const expected = encoder.frameBytes(11);
    const captured = skewIntoCapture(upscale(renderGridFrame(expected), 4), 1_280, 720);
    degradeCapture(captured);
    const result = tryDecodeGridFrame(captured);

    expect(result?.frame).toEqual(expected);
    expect(result?.contrast).toBeGreaterThan(120);
  });

  it("acquires all four markers through screen glare and camera colour lift", () => {
    const encoder = makeEncoder(deterministicBytes(8_192));
    const expected = encoder.frameBytes(12);
    const captured = skewIntoCapture(upscale(renderGridFrame(expected), 3), 1_280, 720);
    liftTowardWhite(captured, 0.5);

    const attempt = decodeGridFrame(captured);
    expect(attempt.outcome).toBe("decoded");
    expect(attempt.markersFound).toBe(true);
    expect(attempt.frame).toEqual(expected);
  });

  it("corrects one spatially interleaved bit error in selected codewords", () => {
    const encoder = makeEncoder(deterministicBytes(8_192));
    const expected = encoder.frameBytes(3);
    const modules = encodeGridModules(expected);
    let flipped = 0;
    for (let byteIndex = 0; byteIndex < GRID_FRAME_BYTES; byteIndex += 113) {
      const bitPlane = byteIndex % 12;
      const position = bitPlane * GRID_FRAME_BYTES + byteIndex;
      modules[position] ^= 1;
      flipped += 1;
    }
    const decoded = decodeGridModules(modules);

    expect(decoded.frame).toEqual(expected);
    expect(decoded.correctedCodewords).toBe(flipped);
  });

  it("feeds byte-exact Grid frames into the unchanged LT reconstruction layer", () => {
    const profile = OPTICAL_PROFILES.grid;
    const payload = deterministicBytes(profile.symbolSize * 3 - 29);
    const encoder = makeEncoder(payload);
    const decoder = new OpticalTransferDecoder(encoder.sessionId);
    let recovered: Uint8Array | undefined;

    for (let symbolId = 0; symbolId < encoder.sourceCount; symbolId += 1) {
      const observation = tryDecodeGridFrame(upscale(renderGridFrame(encoder.frameBytes(symbolId)), 3));
      expect(observation).toBeDefined();
      recovered = decoder.ingestFrame(observation!.frame).envelope;
    }

    expect(recovered).toEqual(payload);
  });

  it("fails closed when the registration markers are absent", () => {
    const blank: PixelBuffer = {
      width: 640,
      height: 360,
      data: new Uint8ClampedArray(640 * 360 * 4).fill(255),
    };
    expect(decodeGridFrame(blank)).toMatchObject({
      outcome: "markers-not-found",
      markersFound: false,
    });
    expect(tryDecodeGridFrame(blank)).toBeUndefined();
  });

  it("reports low contrast separately from marker acquisition failure", () => {
    const encoder = makeEncoder(deterministicBytes(8_192));
    const captured = renderGridFrame(encoder.frameBytes(2));
    flattenMonochromeData(captured);

    expect(decodeGridFrame(captured)).toMatchObject({
      outcome: "contrast-low",
      markersFound: true,
      contrast: 0,
    });
  });

  it("reuses a prior registration when the next exposure loses its marker colours", () => {
    const encoder = makeEncoder(deterministicBytes(8_192));
    const expected = encoder.frameBytes(6);
    const captured = upscale(renderGridFrame(expected), 4);
    const first = decodeGridFrame(captured);
    expect(first.outcome).toBe("decoded");
    expect(first.registration).toBeDefined();

    eraseMarkerColours(captured);
    const reused = decodeGridFrame(captured, first.registration);
    expect(reused.outcome).toBe("decoded");
    expect(reused.frame).toEqual(expected);
  });

  it("uses the full marker component when scattered same-colour pixels are present", () => {
    const encoder = makeEncoder(deterministicBytes(8_192));
    const expected = encoder.frameBytes(9);
    const captured = skewIntoCapture(upscale(renderGridFrame(expected), 3), 1_280, 720);
    addMarkerDistractors(captured);

    expect(decodeGridFrame(captured).frame).toEqual(expected);
  });
});

function makeEncoder(payload: Uint8Array): OpticalTransferEncoder {
  const profile = OPTICAL_PROFILES.grid;
  return new OpticalTransferEncoder(payload, {
    sessionId: Uint8Array.from({ length: 16 }, (_, index) => (index * 17 + 5) & 0xff),
    symbolSize: profile.symbolSize,
    codec: profile.codec,
  });
}

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff);
}

function upscale(image: PixelBuffer, scale: number): PixelBuffer {
  const width = image.width * scale;
  const height = image.height * scale;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const source = (Math.floor(y / scale) * image.width + Math.floor(x / scale)) * 4;
      const destination = (y * width + x) * 4;
      data.set(image.data.subarray(source, source + 4), destination);
    }
  }
  return { data, width, height };
}

function rotateClockwise(image: PixelBuffer): PixelBuffer {
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const destination = (x * image.height + (image.height - y - 1)) * 4;
      data.set(image.data.subarray(source, source + 4), destination);
    }
  }
  return { data, width: image.height, height: image.width };
}

function skewIntoCapture(image: PixelBuffer, width: number, height: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 0; y < image.height; y += 1) {
    const shear = Math.floor(y * 0.18);
    for (let x = 0; x < image.width; x += 1) {
      const destinationX = 50 + x + shear;
      const destinationY = 82 + y;
      if (destinationX >= width || destinationY >= height) continue;
      const source = (y * image.width + x) * 4;
      const destination = (destinationY * width + destinationX) * 4;
      data.set(image.data.subarray(source, source + 4), destination);
    }
  }
  return { data, width, height };
}

function degradeCapture(image: PixelBuffer): void {
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const offset = pixel * 4;
    const noise = ((pixel * 17 + 11) % 21) - 10;
    for (let channel = 0; channel < 3; channel += 1) {
      image.data[offset + channel] = Math.round(image.data[offset + channel] * 0.72 + noise);
    }
  }
}

function liftTowardWhite(image: PixelBuffer, amount: number): void {
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1) {
      image.data[offset + channel] = Math.round(
        image.data[offset + channel] * (1 - amount) + 255 * amount,
      );
    }
  }
}

function flattenMonochromeData(image: PixelBuffer): void {
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const offset = pixel * 4;
    if (isMarkerColour(image.data[offset], image.data[offset + 1], image.data[offset + 2])) continue;
    image.data[offset] = 128;
    image.data[offset + 1] = 128;
    image.data[offset + 2] = 128;
  }
}

function eraseMarkerColours(image: PixelBuffer): void {
  for (let pixel = 0; pixel < image.width * image.height; pixel += 1) {
    const offset = pixel * 4;
    if (!isMarkerColour(image.data[offset], image.data[offset + 1], image.data[offset + 2])) continue;
    image.data[offset] = 255;
    image.data[offset + 1] = 255;
    image.data[offset + 2] = 255;
  }
}

function isMarkerColour(red: number, green: number, blue: number): boolean {
  return (red === 255 && green === 0 && blue === 0) ||
    (red === 0 && green === 255 && blue === 0) ||
    (red === 0 && green === 80 && blue === 255) ||
    (red === 255 && green === 0 && blue === 255);
}

function addMarkerDistractors(image: PixelBuffer): void {
  const colours = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 80, 255],
    [255, 0, 255],
  ] as const;
  for (let index = 0; index < 96; index += 1) {
    const x = (index * 109 + 17) % image.width;
    const y = (index * 73 + 31) % image.height;
    const offset = (y * image.width + x) * 4;
    const colour = colours[index % colours.length];
    image.data[offset] = colour[0];
    image.data[offset + 1] = colour[1];
    image.data[offset + 2] = colour[2];
  }
}
