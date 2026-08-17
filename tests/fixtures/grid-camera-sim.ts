import type { GridRegistration, PixelBuffer } from "../../src/phy/grid/grid-codec";

export type CameraPoint = { x: number; y: number };

export type CameraSceneOptions = {
  width?: number;
  height?: number;
  quad?: [CameraPoint, CameraPoint, CameraPoint, CameraPoint];
  blurRadius?: 0 | 1;
  moireAmplitude?: number;
  brightness?: number;
  distractors?: boolean;
};

export const DEFAULT_CAMERA_QUAD: [CameraPoint, CameraPoint, CameraPoint, CameraPoint] = [
  { x: 84.4, y: 61.7 },
  { x: 875.2, y: 78.3 },
  { x: 846.6, y: 479.4 },
  { x: 111.8, y: 493.1 },
];

/**
 * Models a camera raster rather than an ideal integer-scaled canvas: the grid
 * is projected into a fractional quadrilateral, bilinearly resampled, exposed
 * through a mild luminance pattern, and surrounded by ordinary colored UI.
 */
export function makeCameraScene(
  source: PixelBuffer,
  options: CameraSceneOptions = {},
): PixelBuffer {
  const width = options.width ?? 960;
  const height = options.height ?? 540;
  const quad = options.quad ?? DEFAULT_CAMERA_QUAD;
  const background = rgba(226, 231, 235);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < data.length; offset += 4) data.set(background, offset);

  const transform = squareToQuadrilateral(quad);
  const inverse = invert3x3(transform);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const normalized = project(inverse, x + 0.5, y + 0.5);
      if (
        normalized.x < 0 || normalized.x > 1 ||
        normalized.y < 0 || normalized.y > 1
      ) continue;
      const sampled = bilinearSample(
        source,
        normalized.x * source.width - 0.5,
        normalized.y * source.height - 0.5,
      );
      const destination = (y * width + x) * 4;
      const brightness = options.brightness ?? 0.92;
      const moire = (options.moireAmplitude ?? 0) * Math.sin(x * 0.91 + y * 0.37);
      data[destination] = clamp(sampled[0] * brightness + moire);
      data[destination + 1] = clamp(sampled[1] * brightness + moire * 0.7);
      data[destination + 2] = clamp(sampled[2] * brightness - moire * 0.35);
      data[destination + 3] = 255;
    }
  }

  if (options.distractors ?? true) paintUiDistractors(data, width, height);
  const scene = { data, width, height };
  return options.blurRadius === 1 ? boxBlur(scene) : scene;
}

/** Exact registration for the generated projection, used as a simulator control. */
export function cameraRegistration(
  source: PixelBuffer,
  options: CameraSceneOptions = {},
): GridRegistration {
  const width = options.width ?? 960;
  const height = options.height ?? 540;
  const transform = squareToQuadrilateral(options.quad ?? DEFAULT_CAMERA_QUAD);
  const marker = (x: number, y: number) => project(
    transform,
    (x + 0.5) / source.width,
    (y + 0.5) / source.height,
  );
  const topLeft = marker(6, 6);
  const topRight = marker(241, 6);
  const bottomRight = marker(241, 129);
  const bottomLeft = marker(6, 129);
  const area = quadrilateralArea([topLeft, topRight, bottomRight, bottomLeft]);
  const horizontalPitch = (
    distance(topLeft, topRight) + distance(bottomLeft, bottomRight)
  ) / 2 / 235;
  const verticalPitch = (
    distance(topLeft, bottomLeft) + distance(topRight, bottomRight)
  ) / 2 / 123;
  return {
    topLeft,
    topRight,
    bottomRight,
    bottomLeft,
    screenFillRatio: area / (width * height),
    sampleRadius: Math.max(0, Math.min(2, Math.floor((Math.min(horizontalPitch, verticalPitch) - 1) / 2))),
  };
}

/** Combines two delivered camera rasters at a rolling-shutter row boundary. */
export function transitionTear(
  previous: PixelBuffer,
  next: PixelBuffer,
  splitRatio = 0.47,
): PixelBuffer {
  if (
    previous.width !== next.width || previous.height !== next.height ||
    splitRatio <= 0 || splitRatio >= 1
  ) throw new Error("Transition tear inputs must share dimensions and a bounded split.");
  const split = Math.floor(previous.height * splitRatio);
  const data = new Uint8ClampedArray(previous.data.length);
  const boundary = split * previous.width * 4;
  data.set(previous.data.subarray(0, boundary));
  data.set(next.data.subarray(boundary), boundary);
  return { data, width: previous.width, height: previous.height };
}

function squareToQuadrilateral(
  [topLeft, topRight, bottomRight, bottomLeft]: [CameraPoint, CameraPoint, CameraPoint, CameraPoint],
): number[] {
  const dx1 = topRight.x - bottomRight.x;
  const dx2 = bottomLeft.x - bottomRight.x;
  const dx3 = topLeft.x - topRight.x + bottomRight.x - bottomLeft.x;
  const dy1 = topRight.y - bottomRight.y;
  const dy2 = bottomLeft.y - bottomRight.y;
  const dy3 = topLeft.y - topRight.y + bottomRight.y - bottomLeft.y;
  const denominator = dx1 * dy2 - dx2 * dy1;
  const g = Math.abs(denominator) > 1e-9 ? (dx3 * dy2 - dx2 * dy3) / denominator : 0;
  const h = Math.abs(denominator) > 1e-9 ? (dx1 * dy3 - dx3 * dy1) / denominator : 0;
  return [
    topRight.x - topLeft.x + g * topRight.x,
    bottomLeft.x - topLeft.x + h * bottomLeft.x,
    topLeft.x,
    topRight.y - topLeft.y + g * topRight.y,
    bottomLeft.y - topLeft.y + h * bottomLeft.y,
    topLeft.y,
    g,
    h,
    1,
  ];
}

function invert3x3(matrix: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = matrix;
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-12) throw new Error("Camera quadrilateral is singular.");
  return [
    (e * i - f * h) / determinant,
    (c * h - b * i) / determinant,
    (b * f - c * e) / determinant,
    (f * g - d * i) / determinant,
    (a * i - c * g) / determinant,
    (c * d - a * f) / determinant,
    (d * h - e * g) / determinant,
    (b * g - a * h) / determinant,
    (a * e - b * d) / determinant,
  ];
}

function project(matrix: number[], x: number, y: number): CameraPoint {
  const scale = matrix[6] * x + matrix[7] * y + matrix[8];
  return {
    x: (matrix[0] * x + matrix[1] * y + matrix[2]) / scale,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / scale,
  };
}

function bilinearSample(image: PixelBuffer, x: number, y: number): [number, number, number] {
  const clampedX = Math.max(0, Math.min(image.width - 1, x));
  const clampedY = Math.max(0, Math.min(image.height - 1, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  return [0, 1, 2].map((channel) => {
    const top = channelAt(image, x0, y0, channel) * (1 - fx) + channelAt(image, x1, y0, channel) * fx;
    const bottom = channelAt(image, x0, y1, channel) * (1 - fx) + channelAt(image, x1, y1, channel) * fx;
    return top * (1 - fy) + bottom * fy;
  }) as [number, number, number];
}

function channelAt(image: PixelBuffer, x: number, y: number, channel: number): number {
  return image.data[(y * image.width + x) * 4 + channel];
}

function boxBlur(image: PixelBuffer): PixelBuffer {
  const data = new Uint8ClampedArray(image.data.length);
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const destination = (y * image.width + x) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        let sum = 0;
        let count = 0;
        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = Math.max(0, Math.min(image.width - 1, x + offsetX));
            const sampleY = Math.max(0, Math.min(image.height - 1, y + offsetY));
            sum += channelAt(image, sampleX, sampleY, channel);
            count += 1;
          }
        }
        data[destination + channel] = Math.round(sum / count);
      }
      data[destination + 3] = 255;
    }
  }
  return { data, width: image.width, height: image.height };
}

function paintUiDistractors(data: Uint8ClampedArray, width: number, height: number): void {
  const swatches = [
    { x: 15, y: 18, width: 70, height: 18, color: rgba(255, 182, 35) },
    { x: width - 96, y: 21, width: 72, height: 20, color: rgba(30, 190, 210) },
    { x: 18, y: height - 42, width: 58, height: 16, color: rgba(145, 90, 220) },
    // Small marker-like notification dots should not outweigh the real, much
    // larger fiducials when registration averages candidate pixels.
    { x: width - 29, y: height - 29, width: 4, height: 4, color: rgba(235, 42, 55) },
    { x: 25, y: height - 24, width: 4, height: 4, color: rgba(35, 210, 70) },
  ];
  for (const swatch of swatches) {
    for (let y = swatch.y; y < swatch.y + swatch.height; y += 1) {
      for (let x = swatch.x; x < swatch.x + swatch.width; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        data.set(swatch.color, (y * width + x) * 4);
      }
    }
  }
}

function rgba(red: number, green: number, blue: number): Uint8ClampedArray {
  return new Uint8ClampedArray([red, green, blue, 255]);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function distance(left: CameraPoint, right: CameraPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function quadrilateralArea(points: CameraPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}
