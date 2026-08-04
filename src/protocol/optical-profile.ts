export type OpticalProfileId = "fast" | "balanced" | "legacy";
export type OpticalPayloadMode = "binary" | "text";

export type OpticalProfile = {
  id: OpticalProfileId;
  label: string;
  summary: string;
  symbolSize: number;
  defaultFps: number;
  minFps: number;
  maxFps: number;
  payloadMode: OpticalPayloadMode;
  errorCorrectionLevel: "M";
};

export const OPTICAL_PROFILES: Record<OpticalProfileId, OpticalProfile> = {
  fast: {
    id: "fast",
    label: "Fast",
    summary: "1,536-byte binary frames · best for a steady phone and laptop",
    symbolSize: 1_536,
    defaultFps: 12,
    minFps: 6,
    maxFps: 15,
    payloadMode: "binary",
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
    errorCorrectionLevel: "M",
  },
};

export const OPTICAL_PROFILE_ORDER: OpticalProfileId[] = ["fast", "balanced", "legacy"];
export const DEFAULT_OPTICAL_PROFILE_ID: OpticalProfileId = "fast";

export function nominalGoodputBytes(profile: OpticalProfile, fps: number): number {
  return profile.symbolSize * fps;
}

