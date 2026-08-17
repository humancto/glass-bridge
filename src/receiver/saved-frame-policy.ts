export const SAVED_FRAME_LIMITS = Object.freeze({
  // Covers the 144 KiB diagnostic sequence with repair margin without allowing
  // an unbounded photo-library decode on a phone.
  maxFiles: 160,
  // Phone screenshots and normally compressed photos should fit in 16 MiB.
  maxFileBytes: 16 * 1024 * 1024,
  // Bound one diagnostic run so a selection cannot monopolize browser storage or decoding.
  maxTotalBytes: 128 * 1024 * 1024,
  // JPEG metadata is scanned only this far; PNG dimensions require just 24 bytes.
  maxHeaderBytes: 256 * 1024,
  maxDimension: 8_192,
  maxPixelsPerImage: 24_000_000,
  // Roughly 125 full-HD frames; enough for the built-in diagnostic payload.
  maxTotalPixels: 256_000_000,
});

export class SavedFrameRunGuard {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  cancel(): void {
    this.generation += 1;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }
}

export type SavedFrameFormat = "png" | "jpeg";

export type SavedFrameSource = {
  readonly name: string;
  readonly size: number;
  slice(start?: number, end?: number, contentType?: string): Blob;
};

export type ValidatedSavedFrame<T extends SavedFrameSource = SavedFrameSource> = {
  file: T;
  format: SavedFrameFormat;
  width: number;
  height: number;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3,
  0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb,
  0xcd, 0xce, 0xcf,
]);

export async function validateSavedFrameSelection<T extends SavedFrameSource>(
  files: readonly T[],
  shouldContinue: () => boolean = () => true,
): Promise<ValidatedSavedFrame<T>[]> {
  if (files.length === 0) return [];
  if (files.length > SAVED_FRAME_LIMITS.maxFiles) {
    throw new Error(
      `Select no more than ${SAVED_FRAME_LIMITS.maxFiles} PNG or JPEG QR images in one diagnostic run.`,
    );
  }

  let totalBytes = 0;
  let totalPixels = 0;
  const validated: ValidatedSavedFrame<T>[] = [];
  for (let index = 0; index < files.length; index += 1) {
    assertActive(shouldContinue);
    const file = files[index];
    const label = fileLabel(file, index);
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`${label} is empty or has an invalid size. Choose an intact PNG or JPEG image.`);
    }
    if (file.size > SAVED_FRAME_LIMITS.maxFileBytes) {
      throw new Error(
        `${label} is larger than ${formatMiB(SAVED_FRAME_LIMITS.maxFileBytes)}. Resize or recompress it before decoding.`,
      );
    }
    totalBytes += file.size;
    if (totalBytes > SAVED_FRAME_LIMITS.maxTotalBytes) {
      throw new Error(
        `The selected images exceed ${formatMiB(SAVED_FRAME_LIMITS.maxTotalBytes)} combined. Split them into smaller diagnostic runs.`,
      );
    }

    const dimensions = await inspectImageHeader(file, label);
    assertActive(shouldContinue);
    if (dimensions.width > SAVED_FRAME_LIMITS.maxDimension || dimensions.height > SAVED_FRAME_LIMITS.maxDimension) {
      throw new Error(
        `${label} is ${dimensions.width}x${dimensions.height}; each dimension must be at most ${SAVED_FRAME_LIMITS.maxDimension}px. Resize it before decoding.`,
      );
    }
    const pixels = dimensions.width * dimensions.height;
    if (!Number.isSafeInteger(pixels) || pixels > SAVED_FRAME_LIMITS.maxPixelsPerImage) {
      throw new Error(
        `${label} expands to ${formatPixels(pixels)}; each image must be at most ${formatPixels(SAVED_FRAME_LIMITS.maxPixelsPerImage)}. Resize it before decoding.`,
      );
    }
    totalPixels += pixels;
    if (!Number.isSafeInteger(totalPixels) || totalPixels > SAVED_FRAME_LIMITS.maxTotalPixels) {
      throw new Error(
        `The selected images expand beyond ${formatPixels(SAVED_FRAME_LIMITS.maxTotalPixels)} combined. Split them into smaller diagnostic runs.`,
      );
    }
    validated.push({ file, ...dimensions });
  }
  return validated;
}

function assertActive(shouldContinue: () => boolean): void {
  if (!shouldContinue()) {
    throw new Error("Saved-frame decoding was cancelled.");
  }
}

async function inspectImageHeader(
  file: SavedFrameSource,
  label: string,
): Promise<{ format: SavedFrameFormat; width: number; height: number }> {
  const prefix = await readPrefix(file, 32);
  if (hasBytes(prefix, PNG_SIGNATURE)) {
    return { format: "png", ...parsePngDimensions(prefix, label) };
  }
  if (prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff) {
    const header = file.size <= prefix.length
      ? prefix
      : await readPrefix(file, SAVED_FRAME_LIMITS.maxHeaderBytes);
    return { format: "jpeg", ...parseJpegDimensions(header, file.size, label) };
  }
  throw new Error(
    `${label} is not a PNG or JPEG image. SVG, GIF, WebP, HTML, and unknown formats are blocked; export the QR frame as PNG or JPEG.`,
  );
}

function parsePngDimensions(bytes: Uint8Array, label: string): { width: number; height: number } {
  if (
    bytes.length < 24 ||
    readUint32(bytes, 8) !== 13 ||
    bytes[12] !== 0x49 || bytes[13] !== 0x48 || bytes[14] !== 0x44 || bytes[15] !== 0x52
  ) {
    throw new Error(`${label} has a truncated or malformed PNG header. Export the image again.`);
  }
  const width = readUint32(bytes, 16);
  const height = readUint32(bytes, 20);
  if (width === 0 || height === 0) {
    throw new Error(`${label} has invalid zero-sized PNG dimensions. Export the image again.`);
  }
  return { width, height };
}

function parseJpegDimensions(
  bytes: Uint8Array,
  fileSize: number,
  label: string,
): { width: number; height: number } {
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) {
      throw new Error(`${label} has a malformed JPEG marker sequence. Export the image again.`);
    }
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) break;
    const marker = bytes[offset];
    offset += 1;

    if (marker === 0x00 || marker === 0xd8) {
      throw new Error(`${label} has a malformed JPEG marker sequence. Export the image again.`);
    }
    if (marker === 0xd9 || marker === 0xda) {
      throw new Error(`${label} does not declare JPEG dimensions before its image data. Export the image again.`);
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

    if (offset + 2 > bytes.length) break;
    const segmentLength = readUint16(bytes, offset);
    if (segmentLength < 2) {
      throw new Error(`${label} has an invalid JPEG segment length. Export the image again.`);
    }
    const segmentEnd = offset + segmentLength;
    if (segmentEnd > bytes.length) {
      if (fileSize > bytes.length) {
        throw new Error(
          `${label} does not declare dimensions within the first ${formatKiB(SAVED_FRAME_LIMITS.maxHeaderBytes)}. Remove excessive metadata or export it again.`,
        );
      }
      throw new Error(`${label} has a truncated JPEG segment. Export the image again.`);
    }
    if (JPEG_START_OF_FRAME_MARKERS.has(marker)) {
      if (segmentLength < 8) {
        throw new Error(`${label} has a truncated JPEG dimensions segment. Export the image again.`);
      }
      const height = readUint16(bytes, offset + 3);
      const width = readUint16(bytes, offset + 5);
      if (width === 0 || height === 0) {
        throw new Error(`${label} has invalid zero-sized JPEG dimensions. Export the image again.`);
      }
      return { width, height };
    }
    offset = segmentEnd;
  }

  const reason = fileSize > bytes.length
    ? `does not declare dimensions within the first ${formatKiB(SAVED_FRAME_LIMITS.maxHeaderBytes)}`
    : "has a truncated JPEG header";
  throw new Error(`${label} ${reason}. Remove excessive metadata or export it again.`);
}

async function readPrefix(file: SavedFrameSource, limit: number): Promise<Uint8Array> {
  const length = Math.min(file.size, limit);
  return new Uint8Array(await file.slice(0, length).arrayBuffer());
}

function hasBytes(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((byte, index) => bytes[index] === byte);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] * 0x100) + bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] * 0x1000000) +
    (bytes[offset + 1] * 0x10000) +
    (bytes[offset + 2] * 0x100) +
    bytes[offset + 3]
  );
}

function fileLabel(file: SavedFrameSource, index: number): string {
  return file.name.trim() ? `Image ${index + 1} (${file.name})` : `Image ${index + 1}`;
}

function formatKiB(bytes: number): string {
  return `${bytes / 1024} KiB`;
}

function formatMiB(bytes: number): string {
  return `${bytes / (1024 * 1024)} MiB`;
}

function formatPixels(pixels: number): string {
  return `${(pixels / 1_000_000).toFixed(pixels % 1_000_000 === 0 ? 0 : 1)} megapixels`;
}
