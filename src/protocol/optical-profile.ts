import { GRID_SYMBOL_BYTES, GRID_VISUAL_PHY_ID } from "../phy/grid/grid-codec";

export type OpticalProfileId = "grid" | "burst" | "ceiling" | "turbo" | "fast" | "balanced" | "legacy";
export type OpticalPayloadMode = "binary" | "text";
export type OpticalCodecId = "dense-v1" | "lt-v2";
export type VisualPhyId = "qr-model2-v1" | typeof GRID_VISUAL_PHY_ID;
export type QrMaskPattern = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type OpticalProfile = {
  id: OpticalProfileId;
  label: string;
  summary: string;
  symbolSize: number;
  defaultFps: number;
  minFps: number;
  maxFps: number;
  payloadMode: OpticalPayloadMode;
  codec: OpticalCodecId;
  continuousRepair: boolean;
  visualPhy: VisualPhyId;
  lanes: 1 | 2;
  qrVersion?: number;
  maskPattern?: QrMaskPattern;
  errorCorrectionLevel: "L" | "M";
};

export const OPTICAL_PROFILES: Record<OpticalProfileId, OpticalProfile> = {
  grid: {
    id: "grid",
    label: "Grid 30 lab",
    summary: "registered full-screen grid · 2,032 B/symbol · experimental post-QR PHY",
    symbolSize: GRID_SYMBOL_BYTES,
    defaultFps: 30,
    minFps: 10,
    maxFps: 60,
    payloadMode: "binary",
    codec: "lt-v2",
    continuousRepair: true,
    visualPhy: GRID_VISUAL_PHY_ID,
    lanes: 1,
    errorCorrectionLevel: "L",
  },
  burst: {
    id: "burst",
    label: "Burst",
    summary: "2× v30-L lanes · measurable 30–120 combined code/s ladder",
    symbolSize: 1_688,
    defaultFps: 60,
    minFps: 30,
    maxFps: 120,
    payloadMode: "binary",
    codec: "lt-v2",
    continuousRepair: true,
    visualPhy: "qr-model2-v1",
    lanes: 2,
    qrVersion: 30,
    maskPattern: 4,
    errorCorrectionLevel: "L",
  },
  ceiling: {
    id: "ceiling",
    label: "Ceiling lab",
    summary: "2× v40-L lanes · maximum standard-QR density · experimental",
    symbolSize: 2_900,
    defaultFps: 60,
    minFps: 30,
    maxFps: 120,
    payloadMode: "binary",
    codec: "lt-v2",
    continuousRepair: true,
    visualPhy: "qr-model2-v1",
    lanes: 2,
    qrVersion: 40,
    maskPattern: 4,
    errorCorrectionLevel: "L",
  },
  turbo: {
    id: "turbo",
    label: "Turbo",
    summary: "2,900-byte binary frames · 60 code/s experimental high-throughput path",
    symbolSize: 2_900,
    defaultFps: 60,
    minFps: 24,
    maxFps: 60,
    payloadMode: "binary",
    codec: "lt-v2",
    continuousRepair: true,
    visualPhy: "qr-model2-v1",
    lanes: 1,
    qrVersion: 40,
    maskPattern: 4,
    errorCorrectionLevel: "L",
  },
  fast: {
    id: "fast",
    label: "Steady",
    summary: "1,536-byte binary frames · conservative single-thread compatibility path",
    symbolSize: 1_536,
    defaultFps: 12,
    minFps: 6,
    maxFps: 15,
    payloadMode: "binary",
    codec: "dense-v1",
    continuousRepair: false,
    visualPhy: "qr-model2-v1",
    lanes: 1,
    errorCorrectionLevel: "M",
  },
  balanced: {
    id: "balanced",
    label: "Balanced",
    summary: "1,024-byte binary frames · easier focus at moderate speed",
    symbolSize: 1_024,
    defaultFps: 10,
    minFps: 4,
    maxFps: 12,
    payloadMode: "binary",
    codec: "dense-v1",
    continuousRepair: false,
    visualPhy: "qr-model2-v1",
    lanes: 1,
    errorCorrectionLevel: "M",
  },
  legacy: {
    id: "legacy",
    label: "Legacy",
    summary: "512-byte text frames · compatible with the milestone 9 receiver",
    symbolSize: 512,
    defaultFps: 4,
    minFps: 1,
    maxFps: 10,
    payloadMode: "text",
    codec: "dense-v1",
    continuousRepair: false,
    visualPhy: "qr-model2-v1",
    lanes: 1,
    errorCorrectionLevel: "M",
  },
};

export const OPTICAL_PROFILE_ORDER: OpticalProfileId[] = ["grid", "burst", "ceiling", "turbo", "fast", "balanced", "legacy"];
export const DEFAULT_OPTICAL_PROFILE_ID: OpticalProfileId = "burst";

export function nominalGoodputBytes(profile: OpticalProfile, fps: number): number {
  return profile.symbolSize * fps;
}
