import { OPTICAL_PROFILES, type OpticalProfileId } from "../protocol/optical-profile";
import type { CapacityCameraMetrics } from "./capacity-report";

export type DeviceRunFailureClass =
  | "camera-error"
  | "decode-error"
  | "session-mismatch"
  | "rank-incomplete"
  | "verification-or-policy-error"
  | "operator-or-environment-error";

export type DeviceRunFailureReport = {
  schema: "glassbridge-device-run/1";
  run_id: string;
  measured_at: string;
  outcome: "failed";
  failure_class: DeviceRunFailureClass;
  reason: string;
  profile: {
    id: OpticalProfileId | "unbound";
    label: string;
    visual_phy?: string;
    target_symbol_rate?: number;
    lanes: number;
  };
  transfer_session?: string;
  progress: {
    rank: number;
    required: number;
    accepted_frames: number;
    duplicate_frames: number;
    rejected_frames: number;
  };
  camera: {
    active_seconds: number;
    exposures: number;
    observed_fps: number;
    negotiated_fps: number;
    width: number;
    height: number;
    decode_jobs: number;
    successful_decode_jobs: number;
    empty_decode_jobs: number;
    optical_acquisition_percent: number;
    busy_drops: number;
    decode_p50_ms: number;
    decode_p95_ms: number;
    workers: number;
  };
  device: string;
};

export function createDeviceRunFailureReport(input: {
  measuredAt?: Date;
  runId?: string;
  profileId?: OpticalProfileId;
  targetSymbolRate?: number;
  transferSession?: string;
  reason: string;
  progress: {
    rank: number;
    required: number;
    acceptedFrames: number;
    duplicateFrames: number;
    rejectedFrames: number;
  };
  camera: CapacityCameraMetrics;
  device: string;
}): DeviceRunFailureReport {
  const profile = input.profileId ? OPTICAL_PROFILES[input.profileId] : undefined;
  const decodeJobs = input.camera.decodeJobs ?? 0;
  const successfulDecodeJobs = input.camera.successfulDecodeJobs ?? 0;
  return {
    schema: "glassbridge-device-run/1",
    run_id: input.runId ?? globalThis.crypto.randomUUID(),
    measured_at: (input.measuredAt ?? new Date()).toISOString(),
    outcome: "failed",
    failure_class: classifyFailure(input.reason),
    reason: input.reason,
    profile: {
      id: profile?.id ?? "unbound",
      label: profile?.label ?? "Unbound profile",
      visual_phy: profile?.visualPhy,
      target_symbol_rate: input.targetSymbolRate,
      lanes: profile?.lanes ?? 0,
    },
    transfer_session: input.transferSession,
    progress: {
      rank: input.progress.rank,
      required: input.progress.required,
      accepted_frames: input.progress.acceptedFrames,
      duplicate_frames: input.progress.duplicateFrames,
      rejected_frames: input.progress.rejectedFrames,
    },
    camera: {
      active_seconds: round(input.camera.cameraSeconds ?? 0, 3),
      exposures: input.camera.cameraFrames ?? 0,
      observed_fps: round(input.camera.cameraFps, 2),
      negotiated_fps: round(input.camera.negotiatedFps, 2),
      width: input.camera.width,
      height: input.camera.height,
      decode_jobs: decodeJobs,
      successful_decode_jobs: successfulDecodeJobs,
      empty_decode_jobs: input.camera.emptyDecodeJobs ?? 0,
      optical_acquisition_percent: round(successfulDecodeJobs / Math.max(1, decodeJobs) * 100, 1),
      busy_drops: input.camera.busyDrops,
      decode_p50_ms: round(input.camera.medianDecodeMs, 2),
      decode_p95_ms: round(input.camera.p95DecodeMs, 2),
      workers: input.camera.workers,
    },
    device: input.device,
  };
}

export function classifyFailure(reason: string): DeviceRunFailureClass {
  if (/camera|permission|secure context|getusermedia/iu.test(reason)) return "camera-error";
  if (/decoder|wasm|zxing/iu.test(reason)) return "decode-error";
  if (/different transfer session|wrong.session|pairing/iu.test(reason)) return "session-mismatch";
  if (/rank|not enough independent frames/iu.test(reason)) return "rank-incomplete";
  if (/signature|digest|policy|replay|boundary|envelope|verification/iu.test(reason)) {
    return "verification-or-policy-error";
  }
  return "operator-or-environment-error";
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
