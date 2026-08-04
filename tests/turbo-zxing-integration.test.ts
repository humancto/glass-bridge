import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareZXingModule, readBarcodes } from "zxing-wasm/reader";
import { OPTICAL_PROFILES } from "../src/protocol/optical-profile";
import { TURBO_READER_OPTIONS } from "../src/receiver/decode-options";
import { OpticalTransferDecoder } from "../src/receiver/transport";
import { OpticalTransferEncoder } from "../src/sender/transport";

const CAPTURE_SIZE = 720;
const QUIET_ZONE_MODULES = 4;
const TURBO = OPTICAL_PROFILES.turbo;

describe("Turbo QR pixels through the production ZXing-WASM reader", () => {
  beforeAll(async () => {
    const wasmPath = fileURLToPath(import.meta.resolve("zxing-wasm/reader/zxing_reader.wasm"));
    await prepareZXingModule({
      overrides: { wasmBinary: readFileSync(wasmPath) },
      fireImmediately: true,
    });
  });

  it("recovers all 2,944 AGF2 bytes from a version 40-L camera-sized raster", async () => {
    const encoder = makeEncoder(deterministicBytes(144 * 1_024));
    const expected = encoder.frameBytes(0);
    const decoded = await decodeQr(renderTurboFrame(expected));

    expect(expected).toHaveLength(2_944);
    expect(decoded).toEqual(expected);
  });

  it("recovers the same binary frame after a 90-degree camera rotation", async () => {
    const encoder = makeEncoder(deterministicBytes(144 * 1_024));
    const expected = encoder.frameBytes(7);
    const decoded = await decodeQr(rotateClockwise(renderTurboFrame(expected)));

    expect(TURBO_READER_OPTIONS.tryRotate).toBe(true);
    expect(decoded).toEqual(expected);
  });

  it("reconstructs a transfer only from frames decoded out of real QR pixels", async () => {
    const payload = deterministicBytes(TURBO.symbolSize * 3 - 61);
    const encoder = makeEncoder(payload);
    const decoder = new OpticalTransferDecoder();
    let reconstructed: Uint8Array | undefined;

    for (let symbolId = 0; symbolId < encoder.sourceCount; symbolId += 1) {
      const decodedFrame = await decodeQr(renderTurboFrame(encoder.frameBytes(symbolId)));
      reconstructed = decoder.ingestFrame(decodedFrame).envelope;
    }

    expect(reconstructed).toEqual(payload);
    expect(decoder.snapshot().codec).toBe("lt-v2");
  });
});

function makeEncoder(payload: Uint8Array): OpticalTransferEncoder {
  return new OpticalTransferEncoder(payload, {
    sessionId: Uint8Array.from({ length: 16 }, (_, index) => (index * 13 + 7) & 0xff),
    symbolSize: TURBO.symbolSize,
    codec: TURBO.codec,
  });
}

async function decodeQr(image: ImageData): Promise<Uint8Array> {
  const results = await readBarcodes(image, TURBO_READER_OPTIONS);
  const valid = results.find((result) => result.isValid);
  expect(valid, results.map((result) => result.error).join("; ")).toBeDefined();
  return valid!.bytes;
}

function renderTurboFrame(frame: Uint8Array): ImageData {
  const qr = QRCode.create([{ data: frame, mode: "byte" }], {
    version: TURBO.qrVersion,
    errorCorrectionLevel: TURBO.errorCorrectionLevel,
    maskPattern: TURBO.maskPattern,
  });
  const modules = qr.modules.size;
  const scale = Math.floor(CAPTURE_SIZE / (modules + QUIET_ZONE_MODULES * 2));
  const qrPixels = (modules + QUIET_ZONE_MODULES * 2) * scale;
  const offset = Math.floor((CAPTURE_SIZE - qrPixels) / 2);
  const data = new Uint8ClampedArray(CAPTURE_SIZE * CAPTURE_SIZE * 4);
  data.fill(255);

  for (let moduleY = 0; moduleY < modules; moduleY += 1) {
    for (let moduleX = 0; moduleX < modules; moduleX += 1) {
      if (!qr.modules.get(moduleY, moduleX)) continue;
      const startX = offset + (moduleX + QUIET_ZONE_MODULES) * scale;
      const startY = offset + (moduleY + QUIET_ZONE_MODULES) * scale;
      for (let y = startY; y < startY + scale; y += 1) {
        for (let x = startX; x < startX + scale; x += 1) {
          const pixel = (y * CAPTURE_SIZE + x) * 4;
          data[pixel] = 0;
          data[pixel + 1] = 0;
          data[pixel + 2] = 0;
        }
      }
    }
  }

  return { data, width: CAPTURE_SIZE, height: CAPTURE_SIZE, colorSpace: "srgb" } as ImageData;
}

function rotateClockwise(image: ImageData): ImageData {
  const rotated = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const source = (y * image.width + x) * 4;
      const destination = (x * image.height + (image.height - y - 1)) * 4;
      rotated.set(image.data.subarray(source, source + 4), destination);
    }
  }
  return { data: rotated, width: image.height, height: image.width, colorSpace: "srgb" } as ImageData;
}

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff);
}
