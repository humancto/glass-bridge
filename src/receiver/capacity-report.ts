import { OPTICAL_PROFILES, type OpticalProfileId, type VisualPhyId } from "../protocol/optical-profile";
import type { OpticalPayloadEncoding } from "../protocol/optical-payload";
import type { GridDecodeOutcome } from "../phy/grid/grid-codec";
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
  sourceWidth?: number;
  sourceHeight?: number;
  negotiatedFps: number;
  cameraSeconds?: number;
  cameraFrames?: number;
  decodeJobs?: number;
  successfulDecodeJobs?: number;
  emptyDecodeJobs?: number;
  uniqueFps?: number;
  duplicateFps?: number;
  throttledFrames?: number;
  gridOutcome?: GridDecodeOutcome;
  gridContrast?: number;
  gridScreenFillRatio?: number;
  gridCorrectedCodewords?: number;
  gridRegistrationReusePercent?: number;
  timeToFirstValidMs?: number;
};

export type CapacityReport = {
  schema: "glassbridge-capacity/2" | "glassbridge-capacity/3" | "glassbridge-capacity/4" | "glassbridge-capacity/5";
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
  camera_to_verified_seconds?: number;
  camera_to_verified_payload_bytes_per_second?: number;
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
    source_width?: number;
    source_height?: number;
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
    unique_codes_per_second?: number;
    duplicate_codes_per_second?: number;
    rate_limited_exposures?: number;
    grid_last_outcome?: GridDecodeOutcome;
    grid_contrast?: number;
    grid_screen_fill_percent?: number;
    grid_corrected_codewords?: number;
    grid_registration_reuse_percent?: number;
    time_to_first_valid_ms?: number;
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
  cameraToVerifiedSeconds?: number;
  device: string;
}): CapacityReport {
  const profile = input.profileId ? OPTICAL_PROFILES[input.profileId] : undefined;
  const measurement = input.measurement;
  return {
    schema: "glassbridge-capacity/5",
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
    camera_to_verified_seconds: optionalRound(input.cameraToVerifiedSeconds, 3),
    camera_to_verified_payload_bytes_per_second: input.cameraToVerifiedSeconds === undefined
      ? undefined
      : Math.round(input.fileBytes / Math.max(0.001, input.cameraToVerifiedSeconds)),
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
      source_width: input.camera.sourceWidth,
      source_height: input.camera.sourceHeight,
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
      unique_codes_per_second: optionalRound(input.camera.uniqueFps, 2),
      duplicate_codes_per_second: optionalRound(input.camera.duplicateFps, 2),
      rate_limited_exposures: input.camera.throttledFrames,
      grid_last_outcome: input.camera.gridOutcome,
      grid_contrast: optionalRound(input.camera.gridContrast, 1),
      grid_screen_fill_percent: input.camera.gridScreenFillRatio === undefined
        ? undefined
        : round(input.camera.gridScreenFillRatio * 100, 1),
      grid_corrected_codewords: input.camera.gridCorrectedCodewords,
      grid_registration_reuse_percent: optionalRound(input.camera.gridRegistrationReusePercent, 1),
      time_to_first_valid_ms: optionalRound(input.camera.timeToFirstValidMs, 1),
    },
    device: input.device,
  };
}

export function compareCapacityReport(
  current: CapacityReport,
  history: CapacityReport[],
): CapacityComparison {
  const usesCameraWindow = current.camera_to_verified_payload_bytes_per_second !== undefined;
  const comparable = history.filter((report) =>
    report.profile.id === current.profile.id &&
    report.profile.visual_phy === current.profile.visual_phy &&
    report.profile.target_symbol_rate === current.profile.target_symbol_rate &&
    report.file_bytes === current.file_bytes &&
    report.device === current.device &&
    (report.camera_to_verified_payload_bytes_per_second !== undefined) === usesCameraWindow &&
    (current.payload_sha256 === undefined || report.payload_sha256 === current.payload_sha256)
  );
  const previous = comparable.at(-1);
  const best = comparable.reduce<CapacityReport | undefined>((value, report) => (
    value === undefined || comparisonGoodput(report) > comparisonGoodput(value)
      ? report
      : value
  ), undefined);
  const goodput = comparisonGoodput(current);
  return {
    runNumber: comparable.length + 1,
    previousGoodput: previous ? comparisonGoodput(previous) : undefined,
    previousAcceptedCodesPerSecond: previous?.accepted_codes_per_second,
    bestGoodputBefore: best ? comparisonGoodput(best) : undefined,
    bestAcceptedCodesPerSecond: best?.accepted_codes_per_second,
    changeFromPrevious: previous === undefined ? undefined : goodput / comparisonGoodput(previous) - 1,
    changeFromBest: best === undefined ? undefined : goodput / comparisonGoodput(best) - 1,
    isNewBest: best === undefined || goodput > comparisonGoodput(best),
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
  return (report.schema === "glassbridge-capacity/2" || report.schema === "glassbridge-capacity/3" || report.schema === "glassbridge-capacity/4" || report.schema === "glassbridge-capacity/5") &&
    typeof report.measured_at === "string" &&
    typeof report.file_bytes === "number" &&
    (report.schema === "glassbridge-capacity/2" || (
      typeof report.payload_sha256 === "string" && /^[a-f0-9]{64}$/u.test(report.payload_sha256)
    )) &&
    typeof report.verified_payload_bytes_per_second === "number" &&
    typeof report.profile?.id === "string";
}

function comparisonGoodput(report: CapacityReport): number {
  return report.camera_to_verified_payload_bytes_per_second ?? report.verified_payload_bytes_per_second;
}

function optionalRound(value: number | undefined, digits: number): number | undefined {
  return value === undefined ? undefined : round(value, digits);
}

function round(value: number, digits: number): number {
  return Number(value.toFixed(digits));
}
