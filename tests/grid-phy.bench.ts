import { bench, describe } from "vitest";
import {
  renderGridFrame,
  tryDecodeGridFrame,
  type PixelBuffer,
} from "../src/phy/grid/grid-codec";
import { OPTICAL_PROFILES } from "../src/protocol/optical-profile";
import { OpticalTransferEncoder } from "../src/sender/transport";

const profile = OPTICAL_PROFILES.grid;
const encoder = new OpticalTransferEncoder(deterministicBytes(144 * 1_024), {
  sessionId: new Uint8Array(16).fill(0x47),
  symbolSize: profile.symbolSize,
  codec: profile.codec,
});
const frame = encoder.frameBytes(0);
const cameraRaster = placeInCapture(scaleNearest(renderGridFrame(frame), 3), 1_280, 720);

describe("Grid PHY CPU reference", () => {
  bench("render one 2,032-byte Grid symbol", () => {
    renderGridFrame(frame);
  });

  bench("register and decode one ideal 1280x720 camera exposure", () => {
    const decoded = tryDecodeGridFrame(cameraRaster);
    if (!decoded || !equalBytes(decoded.frame, frame)) throw new Error("Grid benchmark lost frame bytes.");
  });
});

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff);
}

function scaleNearest(image: PixelBuffer, scale: number): PixelBuffer {
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

function placeInCapture(image: PixelBuffer, width: number, height: number): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const offsetX = Math.floor((width - image.width) / 2);
  const offsetY = Math.floor((height - image.height) / 2);
  for (let y = 0; y < image.height; y += 1) {
    const source = y * image.width * 4;
    const destination = ((offsetY + y) * width + offsetX) * 4;
    data.set(image.data.subarray(source, source + image.width * 4), destination);
  }
  return { data, width, height };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
