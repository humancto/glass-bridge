export const GRID_VISUAL_PHY_ID = "mono-grid-v0" as const;
export const GRID_SYMBOL_BYTES = 2_032;
export const GRID_FRAME_BYTES = GRID_SYMBOL_BYTES + 44;

export const GRID_DATA_COLUMNS = 224;
export const GRID_DATA_ROWS = 112;
export const GRID_TOTAL_COLUMNS = 248;
export const GRID_TOTAL_ROWS = 136;

const DATA_X = 12;
const DATA_Y = 12;
const MARKER_RADIUS = 5;
const MARKER_POINTS = {
  topLeft: { x: 6, y: 6, color: [255, 0, 0] as const },
  topRight: { x: 241, y: 6, color: [0, 255, 0] as const },
  bottomRight: { x: 241, y: 129, color: [0, 80, 255] as const },
  bottomLeft: { x: 6, y: 129, color: [255, 0, 255] as const },
};
const DATA_BITS = GRID_DATA_COLUMNS * GRID_DATA_ROWS;
const ENCODED_BITS = GRID_FRAME_BYTES * 12;

if (ENCODED_BITS > DATA_BITS) {
  throw new Error("Grid frame does not fit the declared payload field.");
}

export type PixelBuffer = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

export type GridDecodeResult = {
  frame: Uint8Array;
  correctedCodewords: number;
  contrast: number;
  screenFillRatio: number;
};

type Point = { x: number; y: number };

export function encodeGridModules(frame: Uint8Array): Uint8Array {
  if (frame.length !== GRID_FRAME_BYTES) {
    throw new Error(`Grid v0 requires exactly ${GRID_FRAME_BYTES} frame bytes.`);
  }
  const modules = new Uint8Array(DATA_BITS);
  for (let byteIndex = 0; byteIndex < frame.length; byteIndex += 1) {
    const codeword = hammingEncode(frame[byteIndex] ^ whiteningByte(byteIndex));
    for (let bit = 0; bit < 12; bit += 1) {
      modules[bit * frame.length + byteIndex] = (codeword >>> bit) & 1;
    }
  }
  for (let index = ENCODED_BITS; index < modules.length; index += 1) {
    const x = index % GRID_DATA_COLUMNS;
    const y = Math.floor(index / GRID_DATA_COLUMNS);
    modules[index] = (x + y) & 1;
  }
  return modules;
}

export function decodeGridModules(modules: Uint8Array): { frame: Uint8Array; correctedCodewords: number } {
  if (modules.length !== DATA_BITS || modules.some((value) => value !== 0 && value !== 1)) {
    throw new Error("Grid v0 modules are malformed.");
  }
  const frame = new Uint8Array(GRID_FRAME_BYTES);
  let correctedCodewords = 0;
  for (let byteIndex = 0; byteIndex < frame.length; byteIndex += 1) {
    let codeword = 0;
    for (let bit = 0; bit < 12; bit += 1) {
      codeword |= modules[bit * frame.length + byteIndex] << bit;
    }
    const decoded = hammingDecode(codeword);
    correctedCodewords += Number(decoded.corrected);
    frame[byteIndex] = decoded.byte ^ whiteningByte(byteIndex);
  }
  return { frame, correctedCodewords };
}

export function renderGridFrame(frame: Uint8Array): PixelBuffer {
  const modules = encodeGridModules(frame);
  const data = new Uint8ClampedArray(GRID_TOTAL_COLUMNS * GRID_TOTAL_ROWS * 4);
  for (let pixel = 0; pixel < GRID_TOTAL_COLUMNS * GRID_TOTAL_ROWS; pixel += 1) {
    const offset = pixel * 4;
    data[offset] = 255;
    data[offset + 1] = 255;
    data[offset + 2] = 255;
    data[offset + 3] = 255;
  }
  for (let index = 0; index < modules.length; index += 1) {
    const x = DATA_X + index % GRID_DATA_COLUMNS;
    const y = DATA_Y + Math.floor(index / GRID_DATA_COLUMNS);
    const value = modules[index] === 1 ? 0 : 255;
    setPixel(data, GRID_TOTAL_COLUMNS, x, y, value, value, value);
  }
  for (const marker of Object.values(MARKER_POINTS)) {
    for (let y = marker.y - MARKER_RADIUS; y <= marker.y + MARKER_RADIUS; y += 1) {
      for (let x = marker.x - MARKER_RADIUS; x <= marker.x + MARKER_RADIUS; x += 1) {
        setPixel(
          data,
          GRID_TOTAL_COLUMNS,
          x,
          y,
          marker.color[0],
          marker.color[1],
          marker.color[2],
        );
      }
    }
  }
  return { data, width: GRID_TOTAL_COLUMNS, height: GRID_TOTAL_ROWS };
}

export function tryDecodeGridFrame(image: PixelBuffer): GridDecodeResult | undefined {
  if (
    !Number.isSafeInteger(image.width) || image.width < GRID_TOTAL_COLUMNS ||
    !Number.isSafeInteger(image.height) || image.height < GRID_TOTAL_ROWS ||
    image.data.length !== image.width * image.height * 4
  ) {
    return undefined;
  }
  const markers = locateMarkers(image);
  if (!markers) return undefined;
  const transform = quadrilateralTransform(
    markers.topLeft,
    markers.topRight,
    markers.bottomRight,
    markers.bottomLeft,
  );
  const samples = new Uint8Array(DATA_BITS);
  for (let index = 0; index < samples.length; index += 1) {
    const column = index % GRID_DATA_COLUMNS;
    const row = Math.floor(index / GRID_DATA_COLUMNS);
    const gridX = DATA_X + column;
    const gridY = DATA_Y + row;
    const u = (gridX - MARKER_POINTS.topLeft.x) /
      (MARKER_POINTS.topRight.x - MARKER_POINTS.topLeft.x);
    const v = (gridY - MARKER_POINTS.topLeft.y) /
      (MARKER_POINTS.bottomLeft.y - MARKER_POINTS.topLeft.y);
    const point = transform(u, v);
    samples[index] = lumaAt(image, point.x, point.y);
  }
  const ordered = [...samples].sort((left, right) => left - right);
  const dark = percentile(ordered, 0.1);
  const light = percentile(ordered, 0.9);
  if (light - dark < 48) return undefined;
  const threshold = (dark + light) / 2;
  const modules = Uint8Array.from(samples, (sample) => Number(sample < threshold));
  const decoded = decodeGridModules(modules);
  if (!looksLikeOpticalFrame(decoded.frame)) return undefined;
  const screenArea = quadrilateralArea([
    markers.topLeft,
    markers.topRight,
    markers.bottomRight,
    markers.bottomLeft,
  ]);
  return {
    ...decoded,
    contrast: light - dark,
    screenFillRatio: screenArea / (image.width * image.height),
  };
}

function hammingEncode(byte: number): number {
  const bits = new Uint8Array(13);
  const dataPositions = [3, 5, 6, 7, 9, 10, 11, 12];
  dataPositions.forEach((position, bit) => { bits[position] = (byte >>> bit) & 1; });
  for (const parity of [1, 2, 4, 8]) {
    let value = 0;
    for (let position = 1; position <= 12; position += 1) {
      if (position !== parity && (position & parity) !== 0) value ^= bits[position];
    }
    bits[parity] = value;
  }
  let codeword = 0;
  for (let position = 1; position <= 12; position += 1) {
    codeword |= bits[position] << (position - 1);
  }
  return codeword;
}

function hammingDecode(input: number): { byte: number; corrected: boolean } {
  let codeword = input;
  let syndrome = 0;
  for (const parity of [1, 2, 4, 8]) {
    let value = 0;
    for (let position = 1; position <= 12; position += 1) {
      if ((position & parity) !== 0) value ^= (codeword >>> (position - 1)) & 1;
    }
    if (value !== 0) syndrome |= parity;
  }
  const corrected = syndrome >= 1 && syndrome <= 12;
  if (corrected) codeword ^= 1 << (syndrome - 1);
  const dataPositions = [3, 5, 6, 7, 9, 10, 11, 12];
  let byte = 0;
  dataPositions.forEach((position, bit) => {
    byte |= ((codeword >>> (position - 1)) & 1) << bit;
  });
  return { byte, corrected };
}

function whiteningByte(index: number): number {
  let value = Math.imul(index + 1, 0x9e37_79b1) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85eb_ca6b) >>> 0;
  value ^= value >>> 13;
  return value & 0xff;
}

function locateMarkers(image: PixelBuffer): Record<keyof typeof MARKER_POINTS, Point> | undefined {
  const accumulators = {
    topLeft: accumulator(),
    topRight: accumulator(),
    bottomRight: accumulator(),
    bottomLeft: accumulator(),
  };
  const stride = Math.max(1, Math.floor(Math.min(image.width / 640, image.height / 360)));
  for (let y = 0; y < image.height; y += stride) {
    for (let x = 0; x < image.width; x += stride) {
      const offset = (y * image.width + x) * 4;
      const red = image.data[offset];
      const green = image.data[offset + 1];
      const blue = image.data[offset + 2];
      const key = classifyMarker(red, green, blue);
      if (!key) continue;
      const value = accumulators[key];
      value.x += x;
      value.y += y;
      value.count += 1;
    }
  }
  const minimum = Math.max(6, Math.floor(image.width * image.height / 200_000));
  if (Object.values(accumulators).some((value) => value.count < minimum)) return undefined;
  const points = Object.fromEntries(Object.entries(accumulators).map(([key, value]) => [key, {
    x: value.x / value.count,
    y: value.y / value.count,
  }])) as Record<keyof typeof MARKER_POINTS, Point>;
  const area = quadrilateralArea([points.topLeft, points.topRight, points.bottomRight, points.bottomLeft]);
  if (area < image.width * image.height * 0.08) return undefined;
  return points;
}

function classifyMarker(red: number, green: number, blue: number): keyof typeof MARKER_POINTS | undefined {
  if (red > 150 && green < 105 && blue < 105) return "topLeft";
  if (green > 145 && red < 125 && blue < 125) return "topRight";
  if (blue > 145 && red < 125 && green < 145) return "bottomRight";
  if (red > 145 && blue > 145 && green < 125) return "bottomLeft";
  return undefined;
}

function quadrilateralTransform(
  topLeft: Point,
  topRight: Point,
  bottomRight: Point,
  bottomLeft: Point,
): (u: number, v: number) => Point {
  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const projective = Math.abs(denominator) > 1e-9;
  const g = projective ? (dx3 * dy2 - dx2 * dy3) / denominator : 0;
  const h = projective ? (dx1 * dy3 - dx3 * dy1) / denominator : 0;
  const a = topRight.x - topLeft.x + g * topRight.x;
  const b = bottomLeft.x - topLeft.x + h * bottomLeft.x;
  const d = topRight.y - topLeft.y + g * topRight.y;
  const e = bottomLeft.y - topLeft.y + h * bottomLeft.y;
  return (u, v) => {
    const scale = g * u + h * v + 1;
    return {
      x: (a * u + b * v + topLeft.x) / scale,
      y: (d * u + e * v + topLeft.y) / scale,
    };
  };
}

function lumaAt(image: PixelBuffer, x: number, y: number): number {
  const clampedX = Math.max(0, Math.min(image.width - 1, Math.round(x)));
  const clampedY = Math.max(0, Math.min(image.height - 1, Math.round(y)));
  const offset = (clampedY * image.width + clampedX) * 4;
  return Math.round(
    image.data[offset] * 0.2126 +
    image.data[offset + 1] * 0.7152 +
    image.data[offset + 2] * 0.0722
  );
}

function percentile(values: number[], ratio: number): number {
  return values[Math.min(values.length - 1, Math.floor((values.length - 1) * ratio))];
}

function quadrilateralArea(points: Point[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const next = points[(index + 1) % points.length];
    area += points[index].x * next.y - next.x * points[index].y;
  }
  return Math.abs(area) / 2;
}

function looksLikeOpticalFrame(frame: Uint8Array): boolean {
  return frame.length >= 44 && frame[0] === 0x41 && frame[1] === 0x47 && frame[2] === 0x46 &&
    (frame[3] === 0x31 || frame[3] === 0x32);
}

function setPixel(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  red: number,
  green: number,
  blue: number,
): void {
  const offset = (y * width + x) * 4;
  data[offset] = red;
  data[offset + 1] = green;
  data[offset + 2] = blue;
  data[offset + 3] = 255;
}

function accumulator(): { x: number; y: number; count: number } {
  return { x: 0, y: 0, count: 0 };
}
