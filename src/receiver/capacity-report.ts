import { OPTICAL_PROFILES, type OpticalProfileId, type VisualPhyId } from "../protocol/optical-profile";
import type { OpticalPayloadEncoding } from "../protocol/optical-payload";
import type { TransportMeasurement } from "./capacity-measurement";

export const CAPACITY_HISTORY_KEY = "glassbridge-capacity-history-v2";
export const CAPACITY_HISTORY_LIMIT = 20;

export type CapacityCameraMetrics = {
  cameraFps: number;
  decodeFps: number;
  medianDecodeMs: number;
  p95DecodeMs: number;
  busyDrops: number;
  workers: number;
  width: number;
  height: number;
  negotiatedFps: number;
  cameraSeconds?: number;
  cameraFrames?: number;
  decodeJobs?: number;
  successfulDecodeJobs?: number;
  emptyDecodeJobs?: number;
};

export type CapacityReport = {
  schema: "glassbridge-capacity/2" | "glassbridge-capacity/3" | "glassbridge-capacity/4";
  measured_at: string;
  profile: {
    id: OpticalProfileId | "unbound";
    label: string;
    lanes: number;
    qr_version?: number;
    visual_phy?: VisualPhyId;
    target_symbol_rate?: number;
  };
  transfer_session?: string;
  file_bytes: number;
  payload_sha256?: string;
  transfer_seconds: number;
  verified_payload_bytes_per_second: number;
  accepted_codes: number;
  required_codes: number;
  duplicate_codes: number;
  rejected_codes: number;
  observed_codes: number;
  accepted_codes_per_second: number;
  accepted_symbol_bytes_per_second: number;
  symbol_bytes: number;
  decoded_acceptance_percent: number;
  fountain_overhead_percent: number;
  payload_efficiency_percent: number;
  transport?: {
    encoding: OpticalPayloadEncoding;
    signed_envelope_bytes: number;
    optical_object_bytes: number;
    optical_reduction_percent: number;
  };
  camera: {
    observed_fps: number;
    negotiated_fps: number;
    width: number;
    height: number;
    valid_codes_per_second: number;
    busy_drops: number;
    decode_p50_ms: number;
    decode_p95_ms: number;
    workers: number;
    camera_active_seconds?: number;
    camera_exposures?: number;
    decode_jobs?: number;
    successful_decode_jobs?: number;
    empty_decode_jobs?: number;
    optical_acquisition_percent?: number;
  };
  device: string;
};

export type CapacityComparison = {
  runNumber: number;
  previousGoodput?: number;
  previousAcceptedCodesPerSecond?: number;
  bestGoodputBefore?: number;
  bestAcceptedCodesPerSecond?: number;
  changeFromPrevious?: number;
  changeFromBest?: number;
  isNewBest: boolean;
};

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "getItem" | "setItem">;

export function createCapacityReport(input: {
  measuredAt?: Date;
  profileId?: OpticalProfileId;
  targetSymbolRate?: number;
  transferSession?: string;
  fileBytes: number;
  payloadSha256: string;
  measurement: TransportMeasurement;
  opticalPayload: {
    encoding: OpticalPayloadEncoding;
    originalBytes: number;
    transmittedBytes: number;
  };
  camera: CapacityCameraMetrics;
  device: string;
}): CapacityReport {
  const profile = input.profileId ? OPTICAL_PROFILES[input.profileId] : undefined;
  const measurement = input.measurement;
  return {
    schema: "glassbridge-capacity/4",
    measured_at: (input.measuredAt ?? new Date()).toISOString(),
    profile: {
      id: profile?.id ?? "unbound",
      label: profile?.label ?? "Unbound profile",
      lanes: profile?.lanes ?? 0,
      qr_version: profile?.qrVersion,
      visual_phy: profile?.visualPhy,
      target_symbol_rate: input.targetSymbolRate,
    },
    transfer_session: input.transferSession,
    file_bytes: input.fileBytes,
    payload_sha256: input.payloadSha256,
    transfer_seconds: round(measurement.seconds, 3),
    verified_payload_bytes_per_second: Math.round(measurement.payloadBytesPerSecond),
    accepted_codes: measurement.acceptedCodes,
    required_codes: measurement.requiredCodes,
    duplicate_codes: measurement.duplicateCodes,
    rejected_codes: measurement.rejectedCodes,
    observed_codes: measurement.observedCodes,
    accepted_codes_per_second: round(measurement.acceptedCodesPerSecond, 2),
    accepted_symbol_bytes_per_second: Math.round(measurement.acceptedSymbolBytesPerSecond),
    symbol_bytes: measurement.symbolSize,
    decoded_acceptance_percent: round(measurement.acceptanceRate * 100, 1),
    fountain_overhead_percent: round(measurement.fountainOverhead * 100, 1),
    payload_efficiency_percent: round(measurement.payloadEfficiency * 100, 1),
    transport: {
      encoding: input.opticalPayload.encoding,
      signed_envelope_bytes: input.opticalPayload.originalBytes,
      optical_object_bytes: input.opticalPayload.transmittedBytes,
      optical_reduction_percent: round(
        (1 - input.opticalPayload.transmittedBytes / input.opticalPayload.originalBytes) * 100,
        1,
      ),
    },
    camera: {
      observed_fps: round(input.camera.cameraFps, 2),
      negotiated_fps: round(input.camera.negotiatedFps, 2),
      width: input.camera.width,
      height: input.camera.height,
      valid_codes_per_second: round(input.camera.decodeFps, 2),
      busy_drops: input.camera.busyDrops,
      decode_p50_ms: round(input.camera.medianDecodeMs, 2),
      decode_p95_ms: round(input.camera.p95DecodeMs, 2),
      workers: input.camera.workers,
      camera_active_seconds: round(input.camera.cameraSeconds ?? 0, 3),
      camera_exposures: input.camera.cameraFrames ?? 0,
      decode_jobs: input.camera.decodeJobs ?? 0,
      successful_decode_jobs: input.camera.successfulDecodeJobs ?? 0,
      empty_decode_jobs: input.camera.emptyDecodeJobs ?? 0,
      optical_acquisition_percent: round(
        (input.camera.successfulDecodeJobs ?? 0) /
          Math.max(1, input.camera.decodeJobs ?? 0) * 100,
        1,
      ),
    },
    device: input.device,
  };
}

export function compareCapacityReport(
  current: CapacityReport,
  history: CapacityReport[],
): CapacityComparison {
  const comparable = history.filter((report) =>
    report.profile.id === current.profile.id &&
    report.profile.visual_phy === current.profile.visual_phy &&
    report.profile.target_symbol_rate === current.profile.target_symbol_rate &&
    report.file_bytes === current.file_bytes &&
    report.device === current.device &&
    (current.payload_sha256 === undefined || report.payload_sha256 === current.payload_sha256)
  );
  const previous = comparable.at(-1);
  const best = comparable.reduce<CapacityReport | undefined>((value, report) => (
    value === undefined || report.verified_payload_bytes_per_second > value.verified_payload_bytes_per_second
      ? report
      : value
  ), undefined);
  const goodput = current.verified_payload_bytes_per_second;
  return {
    runNumber: comparable.length + 1,
    previousGoodput: previous?.verified_payload_bytes_per_second,
    previousAcceptedCodesPerSecond: previous?.accepted_codes_per_second,
    bestGoodputBefore: best?.verified_payload_bytes_per_second,
    bestAcceptedCodesPerSecond: best?.accepted_codes_per_second,
    changeFromPrevious: previous === undefined ? undefined : goodput / previous.verified_payload_bytes_per_second - 1,
    changeFromBest: best === undefined ? undefined : goodput / best.verified_payload_bytes_per_second - 1,
    isNewBest: best === undefined || goodput > best.verified_payload_bytes_per_second,
  };
}

export function readCapacityHistory(storage: StorageReader): CapacityReport[] {
  try {
    const value = JSON.parse(storage.getItem(CAPACITY_HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(value)) return [];
    return value.filter(isCapacityReport).slice(-CAPACITY_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

export function storeCapacityReport(
  storage: StorageWriter,
  report: CapacityReport,
): CapacityReport[] {
  const history = [...readCapacityHistory(storage), report].slice(-CAPACITY_HISTORY_LIMIT);
  storage.setItem(CAPACITY_HISTORY_KEY, JSON.stringify(history));
  return history;
}

function isCapacityReport(value: unknown): value is CapacityReport {
  if (!value || typeof value !== "object") return false;
  const report = value as Partial<CapacityReport>;
  return (report.schema === "glassbridge-capacity/2" || report.schema === "glassbridge-capacity/3" || report.schema === "glassbridge-capacity/4") &&
    typeof report.measured_at === "string" &&
    typeof report.file_bytes === "number" &&
    (report.schema === "glassbridge-capacity/2" || (
      typeof report.payload_sha256 === "string" && /^[a-f0-9]{64}$/u.test(report.payload_sha256)
    )) &&
    typeof report.verified_payload_bytes_per_second === "number" &&
    typeof report.profile?.id === "string";
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
