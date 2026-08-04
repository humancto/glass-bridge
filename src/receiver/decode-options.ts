import type { ReaderOptions } from "zxing-wasm/reader";

/**
 * The production camera decoder and the pixel-level integration tests share
 * these options. Keeping one object prevents a fast synthetic test from
 * silently exercising a more permissive decoder than the phone.
 */
export const TURBO_READER_OPTIONS = {
  formats: ["QRCode"],
  maxNumberOfSymbols: 2,
  tryHarder: false,
  // Fast upright/normal decoding remains first; these enable fallback for
  // phone orientation and unusual display polarity without tryHarder.
  tryRotate: true,
  tryInvert: true,
  tryDownscale: false,
  returnErrors: false,
} satisfies ReaderOptions;
