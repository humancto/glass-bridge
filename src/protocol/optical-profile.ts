export type OpticalProfileId = "turbo" | "fast" | "balanced" | "legacy";
export type OpticalPayloadMode = "binary" | "text";
export type OpticalCodecId = "dense-v1" | "lt-v2";
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
  qrVersion?: number;
  maskPattern?: QrMaskPattern;
  errorCorrectionLevel: "L" | "M";
};

export const OPTICAL_PROFILES: Record<OpticalProfileId, OpticalProfile> = {
  turbo: {
    id: "turbo",
    label: "Turbo",
    summary: "2,900-byte binary frames · 60 FPS experimental high-throughput path",
    symbolSize: 2_900,
    defaultFps: 60,
    minFps: 24,
    maxFps: 60,
    payloadMode: "binary",
    codec: "lt-v2",
    continuousRepair: true,
    qrVersion: 40,
    maskPattern: 0,
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
    errorCorrectionLevel: "M",
  },
};

export const OPTICAL_PROFILE_ORDER: OpticalProfileId[] = ["turbo", "fast", "balanced", "legacy"];
export const DEFAULT_OPTICAL_PROFILE_ID: OpticalProfileId = "turbo";

export function nominalGoodputBytes(profile: OpticalProfile, fps: number): number {
  return profile.symbolSize * fps;
}
