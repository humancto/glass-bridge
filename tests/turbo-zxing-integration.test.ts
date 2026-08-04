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

  it("recovers two Burst symbols from one landscape camera frame", async () => {
    const burst = OPTICAL_PROFILES.burst;
    const encoder = new OpticalTransferEncoder(deterministicBytes(144 * 1_024), {
      sessionId: Uint8Array.from({ length: 16 }, (_, index) => (index * 13 + 7) & 0xff),
      symbolSize: burst.symbolSize,
      codec: burst.codec,
    });
    const expected = [encoder.frameBytes(0), encoder.frameBytes(1)];
    const results = await readBarcodes(renderBurstFrame(expected[0], expected[1]), TURBO_READER_OPTIONS);
    const decoded = results.filter((result) => result.isValid).map((result) => result.bytes);

    expect(TURBO_READER_OPTIONS.maxNumberOfSymbols).toBe(2);
    expect(decoded).toHaveLength(2);
    for (const frame of expected) {
      expect(decoded.some((candidate) => equalBytes(candidate, frame))).toBe(true);
    }
  });

  it("recovers two maximum-density v40 symbols from one ideal landscape frame", async () => {
    const ceiling = OPTICAL_PROFILES.ceiling;
    const encoder = new OpticalTransferEncoder(deterministicBytes(144 * 1_024), {
      sessionId: Uint8Array.from({ length: 16 }, (_, index) => (index * 13 + 7) & 0xff),
      symbolSize: ceiling.symbolSize,
      codec: ceiling.codec,
    });
    const expected = [encoder.frameBytes(0), encoder.frameBytes(1)];
    const results = await readBarcodes(renderCeilingFrame(expected[0], expected[1]), TURBO_READER_OPTIONS);
    const decoded = results.filter((result) => result.isValid).map((result) => result.bytes);

    expect(decoded).toHaveLength(2);
    for (const frame of expected) {
      expect(decoded.some((candidate) => equalBytes(candidate, frame))).toBe(true);
    }
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

function renderBurstFrame(leftFrame: Uint8Array, rightFrame: Uint8Array): ImageData {
  const width = 1_280;
  const height = 720;
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  const frames = [leftFrame, rightFrame];
  frames.forEach((frame, lane) => {
    const qr = QRCode.create([{ data: frame, mode: "byte" }], {
      version: OPTICAL_PROFILES.burst.qrVersion,
      errorCorrectionLevel: OPTICAL_PROFILES.burst.errorCorrectionLevel,
      maskPattern: OPTICAL_PROFILES.burst.maskPattern,
    });
    paintQr(data, width, qr, 4, 40 + lane * 620, 70);
  });
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function renderCeilingFrame(leftFrame: Uint8Array, rightFrame: Uint8Array): ImageData {
  const width = 1_280;
  const height = 720;
  const scale = 3;
  const quietModules = 4;
  const profile = OPTICAL_PROFILES.ceiling;
  const totalModules = 21 + ((profile.qrVersion ?? 40) - 1) * 4 + quietModules * 2;
  const qrPixels = totalModules * scale;
  const gap = 40;
  const startX = Math.floor((width - qrPixels * 2 - gap) / 2);
  const startY = Math.floor((height - qrPixels) / 2);
  const data = new Uint8ClampedArray(width * height * 4);
  data.fill(255);
  [leftFrame, rightFrame].forEach((frame, lane) => {
    const qr = QRCode.create([{ data: frame, mode: "byte" }], {
      version: profile.qrVersion,
      errorCorrectionLevel: profile.errorCorrectionLevel,
      maskPattern: profile.maskPattern,
    });
    paintQr(data, width, qr, scale, startX + lane * (qrPixels + gap), startY);
  });
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function paintQr(
  data: Uint8ClampedArray,
  imageWidth: number,
  qr: ReturnType<typeof QRCode.create>,
  scale: number,
  offsetX: number,
  offsetY: number,
): void {
  for (let moduleY = -QUIET_ZONE_MODULES; moduleY < qr.modules.size + QUIET_ZONE_MODULES; moduleY += 1) {
    for (let moduleX = -QUIET_ZONE_MODULES; moduleX < qr.modules.size + QUIET_ZONE_MODULES; moduleX += 1) {
      const dark = moduleX >= 0 && moduleY >= 0
        && moduleX < qr.modules.size && moduleY < qr.modules.size
        && qr.modules.get(moduleY, moduleX);
      if (!dark) continue;
      const startX = offsetX + (moduleX + QUIET_ZONE_MODULES) * scale;
      const startY = offsetY + (moduleY + QUIET_ZONE_MODULES) * scale;
      for (let y = startY; y < startY + scale; y += 1) {
        for (let x = startX; x < startX + scale; x += 1) {
          const pixel = (y * imageWidth + x) * 4;
          data[pixel] = 0;
          data[pixel + 1] = 0;
          data[pixel + 2] = 0;
        }
      }
    }
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function deterministicBytes(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (index * 31 + 17) & 0xff);
}
