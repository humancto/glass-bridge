import { describe, expect, it } from "vitest";
import {
  SAVED_FRAME_LIMITS,
  SavedFrameRunGuard,
  validateSavedFrameSelection,
  type SavedFrameSource,
} from "../src/receiver/saved-frame-policy";

describe("saved QR frame availability policy", () => {
  it("accepts PNG and JPEG magic with bounded dimension headers", async () => {
    const validated = await validateSavedFrameSelection([
      frame("frame.png", pngHeader(1_290, 2_796)),
      frame("photo.jpg", jpegHeader(4_032, 3_024)),
    ]);

    expect(validated.map(({ format, width, height }) => ({ format, width, height }))).toEqual([
      { format: "png", width: 1_290, height: 2_796 },
      { format: "jpeg", width: 4_032, height: 3_024 },
    ]);
  });

  it("rejects oversized dimensions before decoding", async () => {
    await expect(validateSavedFrameSelection([
      frame("too-wide.png", pngHeader(SAVED_FRAME_LIMITS.maxDimension + 1, 1)),
    ])).rejects.toThrow(/each dimension must be at most/);
  });

  it("rejects decompression-bomb pixel dimensions before decoding", async () => {
    await expect(validateSavedFrameSelection([
      frame("bomb.png", pngHeader(6_000, 6_000)),
    ])).rejects.toThrow(/each image must be at most 24 megapixels/);
  });

  it("enforces file-count and per-file byte limits", async () => {
    const tooMany = Array.from({ length: SAVED_FRAME_LIMITS.maxFiles + 1 }, (_, index) =>
      frame(`frame-${index}.png`, pngHeader(1, 1)));
    await expect(validateSavedFrameSelection(tooMany)).rejects.toThrow(/no more than 160/);

    await expect(validateSavedFrameSelection([
      frame("oversized.png", pngHeader(1, 1), SAVED_FRAME_LIMITS.maxFileBytes + 1),
    ])).rejects.toThrow(/larger than 16 MiB/);
  });

  it("rejects truncated and malformed JPEG headers", async () => {
    await expect(validateSavedFrameSelection([
      frame("truncated.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x00])),
    ])).rejects.toThrow(/truncated JPEG segment/);

    await expect(validateSavedFrameSelection([
      frame("malformed.jpg", new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01])),
    ])).rejects.toThrow(/invalid JPEG segment length/);
  });

  it("enforces cumulative byte and decoded-pixel limits", async () => {
    const byteHeavy = Array.from({ length: 9 }, (_, index) => frame(
      `bytes-${index}.png`,
      pngHeader(1, 1),
      SAVED_FRAME_LIMITS.maxFileBytes,
    ));
    await expect(validateSavedFrameSelection(byteHeavy)).rejects.toThrow(/128 MiB combined/);

    const pixelHeavy = Array.from({ length: 13 }, (_, index) => frame(
      `pixels-${index}.png`,
      pngHeader(5_000, 4_000),
    ));
    await expect(validateSavedFrameSelection(pixelHeavy)).rejects.toThrow(/256 megapixels combined/);
  });

  it("cancels a pending header read and isolates a newer saved-frame run", async () => {
    const guard = new SavedFrameRunGuard();
    const firstGeneration = guard.begin();
    let resolveHeader!: (value: ArrayBuffer) => void;
    const pendingHeader = new Promise<ArrayBuffer>((resolve) => { resolveHeader = resolve; });
    const pendingFile: SavedFrameSource = {
      name: "late.png",
      size: 24,
      slice: () => ({ arrayBuffer: () => pendingHeader } as Blob),
    };
    const first = validateSavedFrameSelection(
      [pendingFile],
      () => guard.isCurrent(firstGeneration),
    );

    const secondGeneration = guard.begin();
    resolveHeader(pngHeader(1, 1).buffer as ArrayBuffer);
    await expect(first).rejects.toThrow(/cancelled/);
    await expect(validateSavedFrameSelection(
      [frame("current.png", pngHeader(1, 1))],
      () => guard.isCurrent(secondGeneration),
    )).resolves.toHaveLength(1);
  });

  it.each([
    ["vector.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>"],
    ["animation.gif", "GIF89a"],
    ["page.html", "<!doctype html><title>QR</title>"],
    ["unknown.bin", "not an image"],
  ])("rejects active or unknown format %s", async (name, contents) => {
    await expect(validateSavedFrameSelection([
      frame(name, new TextEncoder().encode(contents)),
    ])).rejects.toThrow(/SVG, GIF, WebP, HTML, and unknown formats are blocked/);
  });
});

function frame(name: string, bytes: Uint8Array, declaredSize = bytes.length): SavedFrameSource {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  const blob = new Blob([copy]);
  return {
    name,
    size: declaredSize,
    slice(start, end, contentType) {
      return blob.slice(start, end, contentType);
    },
  };
}

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
  ]);
  writeUint32(bytes, 16, width);
  writeUint32(bytes, 20, height);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x08, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01,
  ]);
}

function writeUint32(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
