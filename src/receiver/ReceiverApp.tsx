import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseBootstrapHash,
  trustFingerprint,
  verifyAgxEnvelope,
  type BootstrapTrust,
  type VerifiedTransfer,
} from "./agx";
import { evaluateBrowserPolicy, type LocalPolicyDecision } from "./policy";
import { ingestDecodedQr } from "./qr-result";
import {
  DecodeWorkerPool,
  replaceDecodeWorkerPool,
  type DecodeResult,
} from "./decode-worker-pool";
import {
  CameraStartGuard,
  captureLayoutsEqual,
  createCaptureLayout,
  stopMediaStream,
} from "./camera-capture";
import { OPTICAL_PROFILES } from "../protocol/optical-profile";
import type { GridDecodeOutcome } from "../phy/grid/grid-codec";
import {
  GRID_CAMERA_SESSION_LIMIT_MS,
  GRID_INITIAL_ACQUISITION_TIMEOUT_MS,
  GRID_TRANSFER_STALL_MS,
  didGridTransportAdvance,
  gridAcquisitionGuidance,
  gridDecodeTargetFps,
  gridSessionLimitGuidance,
  shouldPauseGridAcquisition,
  shouldEndGridCameraSession,
} from "./grid-acquisition";
import {
  measureTransport,
} from "./capacity-measurement";
import { createDeviceRunFailureReport } from "./device-run-report";
import { unpackOpticalPayload } from "../protocol/optical-payload";
import {
  CAPACITY_HISTORY_LIMIT,
  assessCameraSampling,
  compareCapacityReport,
  createCapacityReport,
  readCapacityHistory,
  storeCapacityReport,
  type CapacityComparison,
  type CapacityReport,
} from "./capacity-report";
import {
  createBrowserReleaseReceipt,
  type BrowserReleaseReceipt,
} from "./receipt";
import { assertFreshTransfer, reserveTransferRelease } from "./replay";
import {
  base64UrlDecode,
  OpticalTransferDecoder,
  type TransferProgress,
} from "./transport";
import { parseStoredPairing, serializeStoredPairing } from "./pairing-storage";
import { SavedFrameRunGuard, validateSavedFrameSelection } from "./saved-frame-policy";
import { classifyOpticalCodeCandidate, didTransportAcceptFrame } from "./decode-metrics";
import {
  CameraExposureTracker,
  createVideoFrameExposureObservation,
  type CameraExposureObservation,
} from "./camera-exposure";

export { CameraExposureTracker } from "./camera-exposure";

type Stage = "unpaired" | "paired" | "scanning" | "verifying" | "quarantined" | "releasing" | "released" | "error";
type SourceMode = "camera" | "files";
type ScannerControls = { stop(): void };

type LiveMetrics = {
  cameraFps: number;
  decodeFps: number;
  uniqueFps: number;
  duplicateFps: number;
  medianDecodeMs: number;
  p95DecodeMs: number;
  busyDrops: number;
  workers: number;
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  negotiatedFps: number;
  cameraSeconds: number;
  callbackFrames: number;
  cameraExposures: number;
  duplicateCallbacks: number;
  submittedExposures: number;
  rateLimitedExposures: number;
  cameraFrames: number;
  decodeJobs: number;
  successfulDecodeJobs: number;
  emptyDecodeJobs: number;
  throttledFrames: number;
  captureCopyP50Ms: number;
  captureCopyP95Ms: number;
  workerRoundTripP50Ms: number;
  workerRoundTripP95Ms: number;
  rgbaBytesPerSecond: number;
  sameFrameReacquisitions: number;
  sameFrameReacquisitionSuccesses: number;
  sameFrameReacquisitionP50Ms: number;
  sameFrameReacquisitionP95Ms: number;
  samplingRatio?: number;
  samplingStatus: "oversampled" | "single-sampled" | "undersampled" | "unknown";
  samplingWarning?: string;
  gridOutcome?: GridDecodeOutcome;
  gridContrast?: number;
  gridScreenFillRatio?: number;
  gridCorrectedCodewords?: number;
  gridRegistrationReusePercent?: number;
  timeToFirstValidMs?: number;
};

const SESSION_TRUST_KEY = "glassbridge-demo-trust-v3";
const INVALID_FRAME_LIMIT = 180;
const EMPTY_PROGRESS: TransferProgress = {
  rank: 0,
  required: 0,
  acceptedFrames: 0,
  duplicateFrames: 0,
  rejectedFrames: 0,
  complete: false,
  symbolSize: 0,
  payloadLength: 0,
  expectedFrames: 0,
};

const EMPTY_METRICS: LiveMetrics = {
  cameraFps: 0,
  decodeFps: 0,
  uniqueFps: 0,
  duplicateFps: 0,
  medianDecodeMs: 0,
  p95DecodeMs: 0,
  busyDrops: 0,
  workers: 0,
  width: 0,
  height: 0,
  sourceWidth: 0,
  sourceHeight: 0,
  negotiatedFps: 0,
  cameraSeconds: 0,
  callbackFrames: 0,
  cameraExposures: 0,
  duplicateCallbacks: 0,
  submittedExposures: 0,
  rateLimitedExposures: 0,
  cameraFrames: 0,
  decodeJobs: 0,
  successfulDecodeJobs: 0,
  emptyDecodeJobs: 0,
  throttledFrames: 0,
  captureCopyP50Ms: 0,
  captureCopyP95Ms: 0,
  workerRoundTripP50Ms: 0,
  workerRoundTripP95Ms: 0,
  rgbaBytesPerSecond: 0,
  sameFrameReacquisitions: 0,
  sameFrameReacquisitionSuccesses: 0,
  sameFrameReacquisitionP50Ms: 0,
  sameFrameReacquisitionP95Ms: 0,
  samplingStatus: "unknown",
};

function readTrust(): { trust?: BootstrapTrust; error?: string } {
  try {
    if (window.location.hash.length > 1) {
      const trust = parseBootstrapHash(window.location.hash);
      window.sessionStorage.setItem(
        SESSION_TRUST_KEY,
        serializeStoredPairing(trust),
      );
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      return { trust };
    }
    const stored = window.sessionStorage.getItem(SESSION_TRUST_KEY);
    if (!stored) {
      return {};
    }
    return { trust: parseStoredPairing(stored) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Pairing failed." };
  }
}

function createPairedOpticalDecoder(trust?: BootstrapTrust): OpticalTransferDecoder {
  const profile = trust?.profileId ? OPTICAL_PROFILES[trust.profileId] : undefined;
  return new OpticalTransferDecoder(trust?.sessionId, {
    codec: profile?.codec,
    symbolSize: profile?.symbolSize,
  });
}

export default function ReceiverApp() {
  const initial = useMemo(readTrust, []);
  const [trust] = useState(initial.trust);
  const [stage, setStage] = useState<Stage>(initial.trust ? "paired" : initial.error ? "error" : "unpaired");
  const [error, setError] = useState(initial.error ?? "");
  const [fingerprint, setFingerprint] = useState("calculating…");
  const [progress, setProgress] = useState<TransferProgress>(EMPTY_PROGRESS);
  const [verified, setVerified] = useState<VerifiedTransfer>();
  const [policyDecision, setPolicyDecision] = useState<LocalPolicyDecision>();
  const [receipt, setReceipt] = useState<BrowserReleaseReceipt>();
  const [saveStatus, setSaveStatus] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("camera");
  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics>(EMPTY_METRICS);
  const [capacityReport, setCapacityReport] = useState<CapacityReport>();
  const [capacityComparison, setCapacityComparison] = useState<CapacityComparison>();
  const [capacityHistorySaved, setCapacityHistorySaved] = useState(false);
  const [measurementStatus, setMeasurementStatus] = useState("");
  const [mustRepair, setMustRepair] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<ScannerControls | undefined>(undefined);
  const cameraStartGuardRef = useRef(new CameraStartGuard());
  const savedFrameRunGuardRef = useRef(new SavedFrameRunGuard());
  const decoderRef = useRef(createPairedOpticalDecoder(initial.trust));
  const verifyingRef = useRef(false);
  const releasingRef = useRef(false);
  const lastProgressPaintRef = useRef(0);
  const transferStartedAtRef = useRef<number | undefined>(undefined);
  const lastAcceptedAtRef = useRef<number | undefined>(undefined);
  const cameraStartedAtRef = useRef<number | undefined>(undefined);
  const liveMetricsRef = useRef<LiveMetrics>(EMPTY_METRICS);

  useEffect(() => {
    if (!trust) {
      return;
    }
    void trustFingerprint(trust)
      .then(setFingerprint)
      .catch(() => setFingerprint("unavailable"));
  }, [trust]);

  useEffect(() => () => cancelCameraActivity(), []);

  function cancelCameraActivity(): void {
    cameraStartGuardRef.current.cancel();
    savedFrameRunGuardRef.current.cancel();
    controlsRef.current?.stop();
    controlsRef.current = undefined;
    const video = videoRef.current;
    if (video) video.srcObject = null;
  }

  function publishProgress(next: TransferProgress, force = false): void {
    const now = performance.now();
    if (force || now - lastProgressPaintRef.current >= 80) {
      lastProgressPaintRef.current = now;
      setProgress(next);
    }
  }

  async function finishEnvelope(
    envelope: Uint8Array,
    callbackControls?: ScannerControls,
    completion?: TransferProgress,
    shouldContinue: () => boolean = () => true,
  ): Promise<void> {
    if (!trust || verifyingRef.current) {
      return;
    }
    verifyingRef.current = true;
    callbackControls?.stop();
    setStage("verifying");
    try {
      const opticalPayload = await unpackOpticalPayload(envelope, trust.packing ?? "identity");
      if (!shouldContinue()) {
        verifyingRef.current = false;
        return;
      }
      const transfer = await verifyAgxEnvelope(opticalPayload.bytes, trust);
      if (!shouldContinue()) {
        verifyingRef.current = false;
        return;
      }
      const decision = await evaluateBrowserPolicy(transfer);
      if (!shouldContinue()) {
        verifyingRef.current = false;
        return;
      }
      if (!decision.allowed) {
        throw new Error(`${decision.code}: ${decision.reason}`);
      }
      assertFreshTransfer(transfer);
      const verifiedAtMs = performance.now();
      setVerified(transfer);
      setPolicyDecision(decision);
      const startedAt = transferStartedAtRef.current;
      if (startedAt !== undefined && completion && completion.acceptedFrames > 0) {
        try {
          const seconds = Math.max(0.001, (verifiedAtMs - startedAt) / 1_000);
          const nextMeasurement = measureTransport(transfer.payload.length, seconds, completion);
          const nextReport = createCapacityReport({
            profileId: trust.profileId,
            targetSymbolRate: trust.targetSymbolRate,
            transferSession: trust.sessionId ? formatSession(trust.sessionId) : undefined,
            fileBytes: transfer.payload.length,
            payloadSha256: transfer.payloadSha256,
            measurement: nextMeasurement,
            opticalPayload,
            camera: liveMetricsRef.current,
            cameraToVerifiedSeconds: cameraStartedAtRef.current === undefined
              ? undefined
              : Math.max(0.001, (verifiedAtMs - cameraStartedAtRef.current) / 1_000),
            opticalFrameWindowSeconds: lastAcceptedAtRef.current === undefined ||
                completion.acceptedFrames < 2 || lastAcceptedAtRef.current <= startedAt
              ? undefined
              : (lastAcceptedAtRef.current - startedAt) / 1_000,
            device: navigator.userAgent,
          });
          let previousReports: CapacityReport[] = [];
          let historySaved = false;
          try {
            previousReports = readCapacityHistory(window.localStorage);
            storeCapacityReport(window.localStorage, nextReport);
            historySaved = true;
          } catch {
            // Private browsing or a full storage quota must not fail the transfer.
          }
          setCapacityReport(nextReport);
          setCapacityComparison(compareCapacityReport(nextReport, previousReports));
          setCapacityHistorySaved(historySaved);
        } catch {
          // Diagnostics are optional evidence. A telemetry regression must not
          // invalidate an object that passed signature, digest, policy, and replay checks.
          setMeasurementStatus("Verified transfer; benchmark analytics were unavailable for this run.");
        }
      }
      if (!shouldContinue()) {
        verifyingRef.current = false;
        return;
      }
      setStage("quarantined");
    } catch (verificationError) {
      if (!shouldContinue()) {
        verifyingRef.current = false;
        return;
      }
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : "Cryptographic verification failed.",
      );
      setStage("error");
    }
  }

  async function startCamera(): Promise<void> {
    if (!trust || !videoRef.current) {
      return;
    }
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Live camera scanning requires the HTTPS receiver page in Safari or Chrome.");
      setStage("error");
      return;
    }

    cancelCameraActivity();
    const cameraGeneration = cameraStartGuardRef.current.begin();
    decoderRef.current.reset();
    verifyingRef.current = false;
    releasingRef.current = false;
    setVerified(undefined);
    setPolicyDecision(undefined);
    setReceipt(undefined);
    setProgress(EMPTY_PROGRESS);
    lastProgressPaintRef.current = 0;
    setError("");
    setSaveStatus("");
    setLiveMetrics(EMPTY_METRICS);
    liveMetricsRef.current = EMPTY_METRICS;
    setCapacityReport(undefined);
    setCapacityComparison(undefined);
    setCapacityHistorySaved(false);
    setMeasurementStatus("");
    setMustRepair(false);
    transferStartedAtRef.current = undefined;
    lastAcceptedAtRef.current = undefined;
    cameraStartedAtRef.current = undefined;
    setSourceMode("camera");
    setStage("scanning");

    let stream: MediaStream | undefined;
    try {
      stream = await openCameraStream();
      if (!cameraStartGuardRef.current.trackStream(cameraGeneration, stream)) return;
      const video = videoRef.current;
      if (!video) {
        cameraStartGuardRef.current.cancelIfCurrent(cameraGeneration);
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (cameraStartGuardRef.current.disposeIfStale(cameraGeneration, stream)) {
        if (video.srcObject === stream) video.srcObject = null;
        return;
      }
      if (!cameraStartGuardRef.current.activate(cameraGeneration)) {
        stopMediaStream(stream);
        if (video.srcObject === stream) video.srcObject = null;
        return;
      }

      const trackSettings = stream.getVideoTracks()[0]?.getSettings();
      const opticalProfile = trust.profileId ? OPTICAL_PROFILES[trust.profileId] : undefined;
      const opticalLanes = opticalProfile?.lanes ?? 1;
      const visualPhy = opticalProfile?.visualPhy ?? "qr-model2-v1";
      const hasIntrinsicSize = video.videoWidth > 0 && video.videoHeight > 0;
      let captureLayout = createCaptureLayout(
        hasIntrinsicSize ? video.videoWidth : trackSettings?.width || 1_280,
        hasIntrinsicSize ? video.videoHeight : trackSettings?.height || 720,
        visualPhy === "mono-grid-v0" ? "grid" : "qr",
        opticalLanes,
      );
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = captureLayout.width;
      captureCanvas.height = captureLayout.height;
      const captureContext = captureCanvas.getContext("2d", { willReadFrequently: true });
      if (!captureContext) throw new Error("The camera capture surface is unavailable.");
      const workerCount = visualPhy === "mono-grid-v0"
        ? 1
        : Math.min(4, Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
      const targetDecodeFps = visualPhy === "mono-grid-v0"
        ? gridDecodeTargetFps(trust.targetSymbolRate ?? opticalProfile?.defaultFps ?? 30)
        : 60;
      const captureIntervalMs = 1_000 / targetDecodeFps;
      let active = true;
      let callbackId = 0;
      const exposureTracker = new CameraExposureTracker();
      let decodedFrames = 0;
      let decodeJobs = 0;
      let successfulDecodeJobs = 0;
      let emptyDecodeJobs = 0;
      let busyDrops = 0;
      let submittedExposures = 0;
      let rateLimitedExposures = 0;
      let rgbaBytesCopied = 0;
      let sameFrameReacquisitions = 0;
      let sameFrameReacquisitionSuccesses = 0;
      let consecutiveNonProgressGridJobs = 0;
      let lastGridProgressAt = performance.now();
      let hasAcceptedGridFrame = false;
      let lastQrProgressAt = performance.now();
      let hasAcceptedQrFrame = false;
      let lastCaptureSubmittedAt = Number.NEGATIVE_INFINITY;
      let acquisitionWatchdogId = 0;
      let sessionWatchdogId = 0;
      let gridOutcome: GridDecodeOutcome | undefined;
      let gridContrast: number | undefined;
      let gridScreenFillRatio: number | undefined;
      let gridCorrectedCodewords: number | undefined;
      let gridRegistrationJobs = 0;
      let gridRegistrationReuseJobs = 0;
      let timeToFirstValidMs: number | undefined;
      const cameraStartedAt = performance.now();
      cameraStartedAtRef.current = cameraStartedAt;
      const hasVideoFrameTimestamps = "requestVideoFrameCallback" in video;
      let lastMetricsPaint = cameraStartedAt;
      const decodeTimes: number[] = [];
      const captureCopyTimes: number[] = [];
      const workerRoundTripTimes: number[] = [];
      const sameFrameReacquisitionTimes: number[] = [];

      const updateMetrics = (force = false) => {
        const now = performance.now();
        if (!force && now - lastMetricsPaint < 500) return;
        const seconds = Math.max(0.001, (now - cameraStartedAt) / 1_000);
        const sorted = [...decodeTimes].sort((left, right) => left - right);
        const sortedCaptureCopy = [...captureCopyTimes].sort((left, right) => left - right);
        const sortedWorkerRoundTrips = [...workerRoundTripTimes].sort((left, right) => left - right);
        const sortedSameFrameRoundTrips = [...sameFrameReacquisitionTimes]
          .sort((left, right) => left - right);
        const decoderSnapshot = decoderRef.current.snapshot();
        const cameraFps = exposureTracker.cameraExposures / seconds;
        const sampling = hasVideoFrameTimestamps
          ? assessCameraSampling(cameraFps, trust.targetSymbolRate, opticalLanes)
          : {
              status: "unknown" as const,
              warning: "This browser exposes animation callbacks but not video-frame metadata; exposure FPS is estimated from video.currentTime and is not publication-grade.",
            };
        const nextMetrics: LiveMetrics = {
          cameraFps,
          decodeFps: decodedFrames / seconds,
          uniqueFps: decoderSnapshot.acceptedFrames / seconds,
          duplicateFps: decoderSnapshot.duplicateFrames / seconds,
          medianDecodeMs: percentile(sorted, 0.5),
          p95DecodeMs: percentile(sorted, 0.95),
          busyDrops,
          workers: workerCount,
          width: captureLayout.width,
          height: captureLayout.height,
          sourceWidth: captureLayout.sourceWidth,
          sourceHeight: captureLayout.sourceHeight,
          negotiatedFps: trackSettings?.frameRate ?? 0,
          cameraSeconds: seconds,
          callbackFrames: exposureTracker.callbackFrames,
          cameraExposures: exposureTracker.cameraExposures,
          duplicateCallbacks: exposureTracker.duplicateCallbacks,
          submittedExposures,
          rateLimitedExposures,
          // Legacy aliases remain populated for old local history readers.
          cameraFrames: exposureTracker.cameraExposures,
          decodeJobs,
          successfulDecodeJobs,
          emptyDecodeJobs,
          throttledFrames: rateLimitedExposures,
          captureCopyP50Ms: percentile(sortedCaptureCopy, 0.5),
          captureCopyP95Ms: percentile(sortedCaptureCopy, 0.95),
          workerRoundTripP50Ms: percentile(sortedWorkerRoundTrips, 0.5),
          workerRoundTripP95Ms: percentile(sortedWorkerRoundTrips, 0.95),
          rgbaBytesPerSecond: rgbaBytesCopied / seconds,
          sameFrameReacquisitions,
          sameFrameReacquisitionSuccesses,
          sameFrameReacquisitionP50Ms: percentile(sortedSameFrameRoundTrips, 0.5),
          sameFrameReacquisitionP95Ms: percentile(sortedSameFrameRoundTrips, 0.95),
          samplingRatio: sampling.ratio,
          samplingStatus: sampling.status,
          samplingWarning: sampling.warning,
          gridOutcome,
          gridContrast,
          gridScreenFillRatio,
          gridCorrectedCodewords,
          gridRegistrationReusePercent: gridRegistrationJobs > 0
            ? gridRegistrationReuseJobs / gridRegistrationJobs * 100
            : undefined,
          timeToFirstValidMs,
        };
        liveMetricsRef.current = nextMetrics;
        setLiveMetrics(nextMetrics);
        lastMetricsPaint = now;
      };

      let controls: ScannerControls;
      const failDecoder = (failure: unknown) => {
        if (!active) return;
        updateMetrics(true);
        const message = failure instanceof Error
          ? failure.message
          : typeof failure === "string" ? failure : "Optical decode pipeline failed.";
        controls.stop();
        controlsRef.current = undefined;
        setError(`Optical decoder unavailable: ${message}`);
        setStage("error");
      };
      const failGridAcquisition = () => {
        if (!active || visualPhy !== "mono-grid-v0") return;
        updateMetrics(true);
        controls.stop();
        controlsRef.current = undefined;
        setError(gridAcquisitionGuidance(gridOutcome, hasAcceptedGridFrame));
        setStage("error");
      };
      const armGridAcquisitionWatchdog = () => {
        if (visualPhy !== "mono-grid-v0") return;
        window.clearTimeout(acquisitionWatchdogId);
        const timeout = hasAcceptedGridFrame
          ? GRID_TRANSFER_STALL_MS
          : GRID_INITIAL_ACQUISITION_TIMEOUT_MS;
        const elapsed = performance.now() - lastGridProgressAt;
        acquisitionWatchdogId = window.setTimeout(() => {
          if (!active) return;
          const stalledFor = performance.now() - lastGridProgressAt;
          const currentTimeout = hasAcceptedGridFrame
            ? GRID_TRANSFER_STALL_MS
            : GRID_INITIAL_ACQUISITION_TIMEOUT_MS;
          if (stalledFor >= currentTimeout) {
            failGridAcquisition();
            return;
          }
          armGridAcquisitionWatchdog();
        }, Math.max(1, timeout - elapsed));
      };
      const failQrAcquisition = () => {
        if (!active || visualPhy === "mono-grid-v0") return;
        updateMetrics(true);
        controls.stop();
        controlsRef.current = undefined;
        setError(hasAcceptedQrFrame
          ? "Scanning stopped after ten seconds without a new intact QR transport symbol. Restart at 30/s, keep every code fully inside the guide, and move closer until the modules are sharp."
          : "No intact GlassBridge QR transport symbol arrived within twenty seconds. Keep every code fully inside the guide, improve focus/lighting, and restart at 30/s.");
        setStage("error");
      };
      const armQrAcquisitionWatchdog = () => {
        if (visualPhy === "mono-grid-v0") return;
        window.clearTimeout(acquisitionWatchdogId);
        const timeout = hasAcceptedQrFrame
          ? GRID_TRANSFER_STALL_MS
          : GRID_INITIAL_ACQUISITION_TIMEOUT_MS;
        const elapsed = performance.now() - lastQrProgressAt;
        acquisitionWatchdogId = window.setTimeout(() => {
          if (!active) return;
          const stalledFor = performance.now() - lastQrProgressAt;
          const currentTimeout = hasAcceptedQrFrame
            ? GRID_TRANSFER_STALL_MS
            : GRID_INITIAL_ACQUISITION_TIMEOUT_MS;
          if (stalledFor >= currentTimeout) {
            failQrAcquisition();
            return;
          }
          armQrAcquisitionWatchdog();
        }, Math.max(1, timeout - elapsed));
      };
      const failGridSession = () => {
        if (!active || visualPhy !== "mono-grid-v0") return;
        updateMetrics(true);
        controls.stop();
        controlsRef.current = undefined;
        setError(gridSessionLimitGuidance());
        setStage("error");
      };
      const armGridSessionWatchdog = () => {
        if (visualPhy !== "mono-grid-v0") return;
        window.clearTimeout(sessionWatchdogId);
        const elapsed = performance.now() - cameraStartedAt;
        sessionWatchdogId = window.setTimeout(() => {
          if (!active) return;
          if (shouldEndGridCameraSession(performance.now() - cameraStartedAt)) {
            failGridSession();
            return;
          }
          armGridSessionWatchdog();
        }, Math.max(1, GRID_CAMERA_SESSION_LIMIT_MS - elapsed));
      };
      const handleDecodeResult = (result: DecodeResult) => {
        if (!active || verifyingRef.current) return;
        const resultReceivedAt = performance.now();
        decodeTimes.push(result.decodeMs);
        if (decodeTimes.length > 240) decodeTimes.splice(0, decodeTimes.length - 240);
        if (result.roundTripMs !== undefined) {
          workerRoundTripTimes.push(result.roundTripMs);
          if (workerRoundTripTimes.length > 240) {
            workerRoundTripTimes.splice(0, workerRoundTripTimes.length - 240);
          }
        }
        if (result.error) {
          failDecoder(result.error);
          return;
        }
        const codes = result.codes ?? [];
        if (result.grid) {
          gridOutcome = result.grid.outcome;
          gridContrast = result.grid.contrast;
          gridScreenFillRatio = result.grid.screenFillRatio;
          gridCorrectedCodewords = result.grid.correctedCodewords;
          gridRegistrationJobs += 1;
          gridRegistrationReuseJobs += Number(result.grid.registrationReused);
          if (result.grid.reacquiredSameFrame) {
            sameFrameReacquisitions += 1;
            sameFrameReacquisitionSuccesses += Number(result.grid.transportValid === true);
            if (result.roundTripMs !== undefined) {
              sameFrameReacquisitionTimes.push(result.roundTripMs);
              if (sameFrameReacquisitionTimes.length > 120) {
                sameFrameReacquisitionTimes.splice(
                  0,
                  sameFrameReacquisitionTimes.length - 120,
                );
              }
            }
          }
        }
        decodeJobs += 1;
        if (codes.length === 0) {
          emptyDecodeJobs += 1;
          if (visualPhy === "mono-grid-v0") {
            consecutiveNonProgressGridJobs += 1;
            const symbolRate = trust.targetSymbolRate ?? opticalProfile?.defaultFps ?? 30;
            if (shouldPauseGridAcquisition({
              symbolRate,
              consecutiveNonProgressJobs: consecutiveNonProgressGridJobs,
              elapsedSinceProgressMs: performance.now() - lastGridProgressAt,
              hasAcceptedFrame: hasAcceptedGridFrame,
            })) {
              failGridAcquisition();
              return;
            }
          }
          updateMetrics();
          return;
        }
        let transportValidCodeCount = 0;
        let gridJobAccepted = false;
        for (const code of codes) {
          const decoder = decoderRef.current;
          const before = decoder.snapshot();
          const candidate = classifyOpticalCodeCandidate(code.bytes, code.text);
          const next = candidate?.kind === "binary"
            ? decoder.ingestFrame(candidate.value)
            : candidate?.kind === "text"
              ? decoder.ingestText(candidate.value)
              : undefined;
          if (!next) continue;
          if (next.rejectionReason === "wrong-session") {
            updateMetrics(true);
            controls.stop();
            controlsRef.current = undefined;
            setMustRepair(true);
            setError("This phone is paired to a different transfer session. Scan the stationary pairing QR currently shown on the laptop, then try again.");
            setStage("error");
            return;
          }
          if (didTransportAcceptFrame(before, next)) {
            transportValidCodeCount += 1;
          }
          if (visualPhy !== "mono-grid-v0" && next.acceptedFrames > before.acceptedFrames) {
            hasAcceptedQrFrame = true;
            lastQrProgressAt = performance.now();
            armQrAcquisitionWatchdog();
          }
          const transportAdvanced = didGridTransportAdvance(before, next);
          if (visualPhy === "mono-grid-v0" && transportAdvanced) {
            gridJobAccepted = true;
            hasAcceptedGridFrame = true;
            consecutiveNonProgressGridJobs = 0;
            lastGridProgressAt = performance.now();
            armGridAcquisitionWatchdog();
          }
          if (transportAdvanced && timeToFirstValidMs === undefined) {
            timeToFirstValidMs = performance.now() - cameraStartedAt;
          }
          if (next.acceptedFrames > before.acceptedFrames) {
            const acceptedAt = resultReceivedAt;
            if (transferStartedAtRef.current === undefined) {
              transferStartedAtRef.current = acceptedAt;
            }
            lastAcceptedAtRef.current = acceptedAt;
          }
          publishProgress(next, next.complete);
          if (next.acceptedFrames === 0 && next.rejectedFrames >= INVALID_FRAME_LIMIT) {
            updateMetrics(true);
            controls.stop();
            controlsRef.current = undefined;
            setError(visualPhy === "mono-grid-v0"
              ? "The camera found the Grid markers, but no intact GlassBridge frame survived. Keep all four colored corners inside the guide, use fullscreen on the sender, and restart at 10/s before increasing speed."
              : "The camera can see QR shapes, but no intact GlassBridge frame survived. Keep both codes fully inside the guide, move closer until each code is sharp, and restart at 30/s before increasing speed.");
            setStage("error");
            return;
          }
          if (next.envelope) {
            updateMetrics(true);
            void finishEnvelope(next.envelope, controls, next);
            break;
          }
        }
        if (transportValidCodeCount > 0) {
          successfulDecodeJobs += 1;
          decodedFrames += transportValidCodeCount;
        } else {
          // Preserve decoded bytes for transport rejection accounting, but do
          // not label barcode-valid/CRC-invalid data as a valid optical code.
          emptyDecodeJobs += 1;
        }
        if (visualPhy === "mono-grid-v0" && !gridJobAccepted) {
          consecutiveNonProgressGridJobs += 1;
        }
        if (!verifyingRef.current) updateMetrics();
      };
      const createWorkerPool = () => new DecodeWorkerPool(workerCount, (result) => {
        try {
          handleDecodeResult(result);
        } catch (resultError) {
          failDecoder(resultError);
        }
      });
      let pool = createWorkerPool();
      const refreshCaptureLayout = (): boolean => {
        const hasCurrentIntrinsicSize = video.videoWidth > 0 && video.videoHeight > 0;
        const nextLayout = createCaptureLayout(
          hasCurrentIntrinsicSize ? video.videoWidth : captureLayout.sourceWidth,
          hasCurrentIntrinsicSize ? video.videoHeight : captureLayout.sourceHeight,
          visualPhy === "mono-grid-v0" ? "grid" : "qr",
          opticalLanes,
        );
        if (captureLayoutsEqual(captureLayout, nextLayout)) return true;

        // Retire the old workers before resizing the canvas. Grid registration
        // is worker-local, so no job or homography from the previous geometry
        // can be applied to the first frame in the new orientation.
        const replacement = replaceDecodeWorkerPool(pool, createWorkerPool, failDecoder);
        if (!replacement) return false;
        pool = replacement;
        captureLayout = nextLayout;
        captureCanvas.width = nextLayout.width;
        captureCanvas.height = nextLayout.height;
        lastCaptureSubmittedAt = Number.NEGATIVE_INFINITY;
        gridOutcome = undefined;
        gridContrast = undefined;
        gridScreenFillRatio = undefined;
        gridCorrectedCodewords = undefined;
        return true;
      };

      const stop = () => {
        if (!active) return;
        updateMetrics(true);
        active = false;
        cameraStartGuardRef.current.cancelIfCurrent(cameraGeneration);
        window.clearTimeout(acquisitionWatchdogId);
        window.clearTimeout(sessionWatchdogId);
        if ("cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(callbackId);
        else window.cancelAnimationFrame(callbackId);
        pool.stop();
        stopMediaStream(stream);
        if (video.srcObject === stream) video.srcObject = null;
        if (controlsRef.current === controls) controlsRef.current = undefined;
      };
      controls = { stop };
      controlsRef.current = controls;
      armGridAcquisitionWatchdog();
      armQrAcquisitionWatchdog();
      armGridSessionWatchdog();

      const captureFrame = (now: number, exposure: CameraExposureObservation) => {
        if (!active || verifyingRef.current) return;
        if (!exposureTracker.observe(exposure)) {
          updateMetrics();
          return;
        }
        if (!refreshCaptureLayout()) return;
        if (visualPhy === "mono-grid-v0") {
          if (now - lastCaptureSubmittedAt < captureIntervalMs * 0.8) {
            rateLimitedExposures += 1;
            updateMetrics();
            return;
          }
        }
        if (pool.busyCount === pool.size) {
          busyDrops += 1;
          updateMetrics();
          return;
        }
        const frameLayout = captureLayout;
        const captureCopyStartedAt = performance.now();
        captureContext.drawImage(
          video,
          0,
          0,
          frameLayout.sourceWidth,
          frameLayout.sourceHeight,
          0,
          0,
          frameLayout.width,
          frameLayout.height,
        );
        const jobs: Array<{ image: ImageData; maxSymbols: 1 | 2 }> = [];
        if (frameLayout.laneRegions && exposureTracker.cameraExposures % 15 !== 0) {
          // Alternate submission priority so a saturated worker pool cannot
          // repeatedly favor the left lane and starve the right lane.
          const orderedRegions = exposureTracker.cameraExposures % 2 === 0
            ? frameLayout.laneRegions
            : [frameLayout.laneRegions[1], frameLayout.laneRegions[0]];
          for (const region of orderedRegions) {
            jobs.push({
              image: captureContext.getImageData(region.x, region.y, region.width, region.height),
              maxSymbols: 1,
            });
          }
        } else {
          // Periodic full-frame acquisition lets the operator recover when the
          // display is not perfectly centered across the two lane regions.
          jobs.push({
            image: captureContext.getImageData(0, 0, frameLayout.width, frameLayout.height),
            maxSymbols: opticalLanes,
          });
        }
        rgbaBytesCopied += jobs.reduce((bytes, job) => bytes + job.image.data.byteLength, 0);
        captureCopyTimes.push(performance.now() - captureCopyStartedAt);
        if (captureCopyTimes.length > 240) {
          captureCopyTimes.splice(0, captureCopyTimes.length - 240);
        }
        let submitted = false;
        for (const job of jobs) {
          if (pool.submit(job.image, job.maxSymbols, visualPhy)) submitted = true;
          else busyDrops += 1;
        }
        if (submitted) {
          submittedExposures += 1;
          lastCaptureSubmittedAt = now;
        }
        updateMetrics();
      };

      const captureSafely = (now: number, exposure: CameraExposureObservation) => {
        try {
          captureFrame(now, exposure);
        } catch (captureError) {
          failDecoder(captureError);
        }
      };

      if (hasVideoFrameTimestamps) {
        const onVideoFrame: VideoFrameRequestCallback = (now, metadata) => {
          captureSafely(
            now,
            createVideoFrameExposureObservation(metadata, video.currentTime),
          );
          if (active) {
            try {
              callbackId = video.requestVideoFrameCallback(onVideoFrame);
            } catch (callbackError) {
              failDecoder(callbackError);
            }
          }
        };
        callbackId = video.requestVideoFrameCallback(onVideoFrame);
      } else {
        const onAnimationFrame = () => {
          captureSafely(performance.now(), {
            currentTime: (video as HTMLVideoElement).currentTime,
          });
          if (active) {
            try {
              callbackId = window.requestAnimationFrame(onAnimationFrame);
            } catch (callbackError) {
              failDecoder(callbackError);
            }
          }
        };
        callbackId = window.requestAnimationFrame(onAnimationFrame);
      }
    } catch (cameraError) {
      const wasCurrent = cameraStartGuardRef.current.isCurrent(cameraGeneration);
      if (wasCurrent) {
        if (controlsRef.current) controlsRef.current.stop();
        else cameraStartGuardRef.current.cancelIfCurrent(cameraGeneration);
        controlsRef.current = undefined;
      }
      stopMediaStream(stream);
      const currentVideo = videoRef.current;
      if (currentVideo?.srcObject === stream) currentVideo.srcObject = null;
      if (!wasCurrent) return;
      setError(
        cameraError instanceof Error
          ? `Camera unavailable: ${cameraError.message}`
          : "Camera permission was not granted.",
      );
      setStage("error");
    }
  }

  async function receiveSavedFrames(files: FileList | null): Promise<void> {
    if (!trust || !files || files.length === 0) {
      return;
    }
    cancelCameraActivity();
    const savedFrameGeneration = savedFrameRunGuardRef.current.begin();
    const runIsCurrent = () => savedFrameRunGuardRef.current.isCurrent(savedFrameGeneration);
    decoderRef.current.reset();
    verifyingRef.current = false;
    setVerified(undefined);
    setPolicyDecision(undefined);
    setReceipt(undefined);
    setProgress(EMPTY_PROGRESS);
    lastProgressPaintRef.current = 0;
    setError("");
    setSourceMode("files");
    setStage("scanning");

    try {
      const savedFrames = await validateSavedFrameSelection(Array.from(files), runIsCurrent);
      if (!runIsCurrent()) return;
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      if (!runIsCurrent()) return;
      const reader = new BrowserQRCodeReader();
      for (const { file } of savedFrames) {
        if (!runIsCurrent()) return;
        const url = URL.createObjectURL(file);
        try {
          const result = await reader.decodeFromImageUrl(url);
          if (!runIsCurrent()) return;
          const next = ingestDecodedQr(result, decoderRef.current);
          publishProgress(next, next.complete);
          if (next.envelope) {
            await finishEnvelope(next.envelope, undefined, undefined, runIsCurrent);
            return;
          }
        } catch {
          if (!runIsCurrent()) return;
          publishProgress(decoderRef.current.ingestText("invalid-frame"));
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      if (!runIsCurrent()) return;
      const finalProgress = decoderRef.current.snapshot();
      setError(`Not enough independent frames: rank ${finalProgress.rank} of ${finalProgress.required || "unknown"}.`);
      setStage("error");
    } catch (savedFrameError) {
      if (!runIsCurrent()) return;
      setError(
        savedFrameError instanceof Error
          ? savedFrameError.message
          : "The saved QR frames could not be validated or decoded.",
      );
      setStage("error");
    } finally {
      if (runIsCurrent() && fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function stopCamera(): void {
    cancelCameraActivity();
    if (fileInputRef.current) fileInputRef.current.value = "";
    setError(sourceMode === "files"
      ? "Operator stopped saved-frame decoding before verification."
      : "Operator stopped camera scanning before verification.");
    setStage("error");
  }

  function resetToPaired(): void {
    cancelCameraActivity();
    decoderRef.current.reset();
    verifyingRef.current = false;
    releasingRef.current = false;
    setVerified(undefined);
    setPolicyDecision(undefined);
    setReceipt(undefined);
    setProgress(EMPTY_PROGRESS);
    setError("");
    setSaveStatus("");
    setLiveMetrics(EMPTY_METRICS);
    liveMetricsRef.current = EMPTY_METRICS;
    setCapacityReport(undefined);
    setCapacityComparison(undefined);
    setCapacityHistorySaved(false);
    setMeasurementStatus("");
    setMustRepair(false);
    transferStartedAtRef.current = undefined;
    lastAcceptedAtRef.current = undefined;
    cameraStartedAtRef.current = undefined;
    setSourceMode("camera");
    setStage("paired");
  }

  function clearPairing(): void {
    cancelCameraActivity();
    window.sessionStorage.removeItem(SESSION_TRUST_KEY);
    window.location.reload();
  }

  async function copyCapacityReport(): Promise<void> {
    if (!capacityReport) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(capacityReport, null, 2));
      setMeasurementStatus("Benchmark JSON copied.");
    } catch {
      setMeasurementStatus("Copy was blocked. Use Save / share benchmark JSON instead.");
    }
  }

  async function shareCapacityReport(): Promise<void> {
    if (!capacityReport) return;
    const sharedGoodput = capacityReport.camera_to_verified_payload_bytes_per_second ??
      capacityReport.verified_payload_bytes_per_second;
    const sharedWindow = capacityReport.camera_to_verified_payload_bytes_per_second === undefined
      ? "legacy first accepted → verification complete"
      : "camera-open diagnostic → verified";
    const file = new File(
      [JSON.stringify(capacityReport, null, 2)],
      `glassbridge-benchmark-${capacityReport.measured_at.replaceAll(":", "-")}.json`,
      { type: "application/json" },
    );
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title: "GlassBridge transfer benchmark",
          text: `${formatRate(sharedGoodput)} diagnostic verified rate · ${sharedWindow} · not synchronized-start benchmark timing`,
          files: [file],
        });
        setMeasurementStatus("Benchmark JSON shared.");
      } else {
        downloadFile(file);
        setMeasurementStatus("Benchmark JSON download started.");
      }
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") {
        setMeasurementStatus("Benchmark share cancelled. The result remains on this screen.");
      } else {
        setMeasurementStatus("The browser could not export the benchmark. Copy the JSON instead.");
      }
    }
  }

  async function shareFailureReport(): Promise<void> {
    if (!trust) return;
    const snapshot = decoderRef.current.snapshot();
    const report = createDeviceRunFailureReport({
      profileId: trust.profileId,
      targetSymbolRate: trust.targetSymbolRate,
      transferSession: trust.sessionId ? formatSession(trust.sessionId) : undefined,
      reason: error || "The receiver stopped before verification.",
      sourceMode: sourceMode === "files" ? "saved-frames" : "camera",
      progress: snapshot,
      camera: liveMetricsRef.current,
      device: navigator.userAgent,
    });
    const file = new File(
      [JSON.stringify(report, null, 2)],
      `glassbridge-failure-${report.measured_at.replaceAll(":", "-")}.json`,
      { type: "application/json" },
    );
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title: "GlassBridge failed-run diagnostics",
          text: `${report.failure_class}: no payload released`,
          files: [file],
        });
        setMeasurementStatus("Failure diagnostics shared.");
      } else {
        downloadFile(file);
        setMeasurementStatus("Failure diagnostics download started.");
      }
    } catch (shareError) {
      setMeasurementStatus(shareError instanceof DOMException && shareError.name === "AbortError"
        ? "Failure diagnostics share cancelled."
        : "The browser could not export failure diagnostics.");
    }
  }

  async function authorizeRelease(): Promise<void> {
    if (!verified || !policyDecision?.allowed || releasingRef.current) {
      return;
    }
    releasingRef.current = true;
    setStage("releasing");
    setSaveStatus("Creating a receiver-signed release receipt…");
    try {
      const nextReceipt = await createBrowserReleaseReceipt(verified, progress);
      await reserveTransferRelease(verified, nextReceipt.observedUnix);
      setReceipt(nextReceipt);
      setStage("released");
      await deliverReleasedFiles(verified, nextReceipt);
    } catch (releaseError) {
      setError(releaseError instanceof Error ? releaseError.message : "The receiver could not authorize release.");
      setStage("error");
    } finally {
      releasingRef.current = false;
    }
  }

  async function deliverReleasedFiles(
    transfer: VerifiedTransfer,
    releaseReceipt: BrowserReleaseReceipt,
  ): Promise<void> {
    const file = new File([transfer.payload.slice().buffer], transfer.filename, {
      type: transfer.mediaType,
    });
    const evidenceFiles = releaseEvidenceFiles(transfer, releaseReceipt);
    const files = [file, ...evidenceFiles];
    const sharedFiles = navigator.canShare?.({ files })
      ? files
      : navigator.canShare?.({ files: [file] })
        ? [file]
        : undefined;
    if (navigator.share && sharedFiles) {
      try {
        await navigator.share({
          files: sharedFiles,
          title: "Authorized GlassBridge transfer",
          text: `Policy ${policyDecision?.code ?? "GB-ALLOW"} · sender ${transfer.signerKeyId} · receiver ${releaseReceipt.receiverKeyId}`,
        });
        setSaveStatus(sharedFiles.length > 1
          ? "Share completed with the file, signed receipt, receipt JSON, and receiver public key."
          : "File share completed. Download the signed evidence below to preserve the audit record.");
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") {
          setSaveStatus("Share cancelled. Release remains authorized; you can try again or download the evidence.");
          return;
        }
      }
    }

    try {
      downloadFile(file);
      setSaveStatus("File download started. Preserve the signed receipt and receiver public key below.");
    } catch {
      setSaveStatus("The browser could not save the file. Try Save / Share again.");
    }
  }

  function downloadEvidence(kind: "cose" | "json" | "key"): void {
    if (!verified || !receipt) return;
    const [cose, json, key] = releaseEvidenceFiles(verified, receipt);
    downloadFile(kind === "cose" ? cose : kind === "json" ? json : key);
  }

  const solvedPercent = progress.required > 0 ? (progress.rank / progress.required) * 99 : 0;
  const receivedPercent = progress.expectedFrames > 0
    ? (progress.acceptedFrames / progress.expectedFrames) * 96
    : 0;
  const percent = progress.complete ? 100 : Math.min(99, Math.round(Math.max(solvedPercent, receivedPercent)));

  return (
    <main className="receiver-app">
      <header className="receiver-header">
        <a className="receiver-brand" href={import.meta.env.BASE_URL}>
          <span>GB</span>
          <div><b>GlassBridge</b><small>LIVE OPTICAL RECEIVER</small></div>
        </a>
        <span className={`stage-pill stage-${stage}`}>{stage.toUpperCase()}</span>
      </header>

      {stage === "unpaired" && (
        <section className="receiver-panel intro-panel">
          <p className="receiver-kicker">PHONE RECEIVER / STEP 1</p>
          <h1>Scan the pairing QR on the laptop.</h1>
          <p>
            On the laptop, open GlassBridge Send, choose a file, and prepare the transfer.
            Scan its stationary QR with the phone's normal Camera. No file payload has crossed yet.
          </p>
          <div className="empty-camera" aria-hidden="true"><span>⌁</span></div>
          <p className="security-note">The animated data stream is accepted only after you confirm the sender fingerprint.</p>
        </section>
      )}

      {trust && (stage === "paired" || stage === "scanning" || stage === "verifying") && (
        <section className="receiver-panel scanner-panel">
          <div className="trust-strip">
            <div><span>PAIRED SENDER</span><strong>{fingerprint}</strong></div>
            <div><span>BOUNDARY</span><strong>{trust.boundary}</strong></div>
            {trust.sessionId && <div><span>TRANSFER SESSION</span><strong>{formatSession(trust.sessionId)}</strong></div>}
            {trust.packing && <div><span>PACKING</span><strong>{trust.packing.toUpperCase()}</strong></div>}
            {trust.visualPhy && <div><span>VISUAL PHY</span><strong>{trust.visualPhy}</strong></div>}
            {trust.targetSymbolRate && <div><span>TARGET RATE</span><strong>{trust.targetSymbolRate} symbols/s</strong></div>}
          </div>

          <div className={`camera-shell ${stage === "scanning" && sourceMode === "camera" ? "camera-live" : ""}`}>
            <video ref={videoRef} muted playsInline aria-label="Live camera preview" />
            <div className="camera-reticle" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
            {(stage !== "scanning" || sourceMode === "files") && (
              <div className="camera-placeholder">
                {stage === "verifying" || sourceMode === "files" ? <span className="spinner"></span> : <b>Ready for photons</b>}
                <small>{stage === "verifying" ? "Verifying signature and digest…" : sourceMode === "files" ? "Decoding selected QR frames…" : "Aim at the laptop display"}</small>
              </div>
            )}
          </div>

          <div className="progress-card">
            <div className="progress-copy">
              <span>{stage === "scanning" ? "RECONSTRUCTION" : stage === "verifying" ? "TRUST CHECK" : "CONFIRM PAIRING"}</span>
              <strong>{stage === "scanning" ? `${progress.acceptedFrames} unique frames · ${progress.rank} / ${progress.required || "—"} blocks recovered` : stage === "verifying" ? "Envelope reconstructed" : "Key is not trusted until you continue"}</strong>
            </div>
            <progress
              className="progress-track"
              max="100"
              value={stage === "verifying" ? 100 : percent}
              aria-label="Optical reconstruction progress"
            />
            <div className="frame-stats"><span>{progress.acceptedFrames} accepted</span><span>{progress.duplicateFrames} duplicates</span><span>{progress.rejectedFrames} rejected</span></div>
          </div>

          {stage === "scanning" && sourceMode === "camera" && (
            <div className="live-metrics" aria-label="Live optical pipeline measurements">
              <div>
                <span>CAMERA</span>
                <strong>{liveMetrics.cameraFps.toFixed(1)} FPS</strong>
                <small>decode {liveMetrics.width}×{liveMetrics.height} · source {liveMetrics.sourceWidth}×{liveMetrics.sourceHeight} @ {liveMetrics.negotiatedFps.toFixed(0) || "—"}</small>
                <small>{liveMetrics.cameraExposures} exposures · {liveMetrics.callbackFrames} callbacks · {liveMetrics.duplicateCallbacks} duplicate callbacks</small>
                {liveMetrics.timeToFirstValidMs !== undefined && <small>first valid {(liveMetrics.timeToFirstValidMs / 1_000).toFixed(2)} s</small>}
                {liveMetrics.samplingWarning && <small role="status">{liveMetrics.samplingWarning}</small>}
              </div>
              <div>
                <span>ACQUIRED SYMBOLS</span>
                <strong>{liveMetrics.decodeFps.toFixed(1)} / SEC</strong>
                <small>{liveMetrics.uniqueFps.toFixed(1)} unique/s · {liveMetrics.duplicateFps.toFixed(1)} duplicate/s</small>
              </div>
              <div>
                <span>PRESSURE</span>
                <strong>{liveMetrics.busyDrops} busy · {liveMetrics.rateLimitedExposures} limited</strong>
                <small>
                  decode p50 {liveMetrics.medianDecodeMs.toFixed(0)} / p95 {liveMetrics.p95DecodeMs.toFixed(0)} ms
                  {` · round trip p95 ${liveMetrics.workerRoundTripP95Ms.toFixed(0)} ms`}
                  {liveMetrics.gridOutcome ? ` · ${liveMetrics.gridOutcome}` : ""}
                  {liveMetrics.gridContrast !== undefined ? ` · contrast ${liveMetrics.gridContrast}` : ""}
                </small>
              </div>
            </div>
          )}

          {stage === "paired" ? (
            <>
              <button className="receiver-button primary" type="button" onClick={() => void startCamera()}>
                Trust sender &amp; open camera
              </button>
              <p className="security-note">
                {trust.visualPhy === "mono-grid-v0"
                  ? "Use sender fullscreen, turn the phone landscape, and keep all four colored Grid corners inside the guide. You have twenty seconds to switch devices and aim; ten seconds without a new valid symbol stops scanning. This lab camera session also ends after 120 seconds and requires a restart."
                  : "Landscape is recommended for dual-lane capacity modes, but it is never a blocker. Start the camera and keep both QR codes fully inside the guide."}
              </p>
              <button className="receiver-button secondary" type="button" onClick={() => fileInputRef.current?.click()}>
                Diagnostic: decode saved QR frames
              </button>
              <input
                ref={fileInputRef}
                className="hidden-input"
                type="file"
                accept="image/png,image/jpeg"
                multiple
                onChange={(event) => void receiveSavedFrames(event.currentTarget.files)}
              />
            </>
          ) : stage === "scanning" ? (
            <button className="receiver-button secondary" type="button" onClick={stopCamera}>Stop scanning</button>
          ) : null}
          <button className="text-button" type="button" onClick={clearPairing}>Forget this pairing</button>
        </section>
      )}

      {(stage === "quarantined" || stage === "releasing") && verified && policyDecision && (
        <section className="receiver-panel verified-panel">
          <div className="verified-mark">✓</div>
          <p className="receiver-kicker">VERIFIED QUARANTINE / POLICY {policyDecision.code}</p>
          <h1>Verified. Held for approval.</h1>
          <p>The payload remains in memory and is not exposed as a file until you explicitly authorize release.</p>
          {capacityReport && capacityComparison && (
            <CapacityScorecard
              report={capacityReport}
              comparison={capacityComparison}
              historySaved={capacityHistorySaved}
              status={measurementStatus}
              onCopy={() => void copyCapacityReport()}
              onShare={() => void shareCapacityReport()}
            />
          )}
          <div className="policy-decision">
            <span>LOCAL DECISION</span>
            <strong>{policyDecision.code}</strong>
            <small>{policyDecision.reason}</small>
          </div>
          <dl className="verified-details">
            <div><dt>File</dt><dd>{verified.filename}</dd></div>
            <div><dt>Size</dt><dd>{verified.payload.length.toLocaleString()} bytes</dd></div>
            <div><dt>Signer</dt><dd>{verified.signerKeyId}</dd></div>
            <div><dt>Boundary</dt><dd>{verified.boundary}</dd></div>
            <div><dt>Purpose</dt><dd>{verified.purpose}</dd></div>
            <div><dt>Policy</dt><dd>{verified.policyId}</dd></div>
            <div><dt>SHA-256</dt><dd>{verified.payloadSha256}</dd></div>
          </dl>
          <button
            className="receiver-button primary save-button"
            type="button"
            disabled={stage === "releasing"}
            onClick={() => void authorizeRelease()}
          >
            {stage === "releasing" ? "Signing receipt and reserving replay state…" : "Approve release & create signed receipt"}
          </button>
          {saveStatus && <p className="save-status" role="status">{saveStatus}</p>}
          <button className="text-button" type="button" onClick={clearPairing}>Reject and forget this pairing</button>
        </section>
      )}

      {stage === "released" && verified && receipt && policyDecision && (
        <section className="receiver-panel verified-panel released-panel">
          <div className="verified-mark">✓</div>
          <p className="receiver-kicker">RELEASE AUTHORIZED / SIGNED EVIDENCE READY</p>
          <h1>Released with a receipt.</h1>
          <p>The envelope is now in the bounded replay ledger. The receipt proves this receiver authorized browser exposure—not that another application opened the file.</p>
          {capacityReport && capacityComparison && (
            <CapacityScorecard
              report={capacityReport}
              comparison={capacityComparison}
              historySaved={capacityHistorySaved}
              status={measurementStatus}
              onCopy={() => void copyCapacityReport()}
              onShare={() => void shareCapacityReport()}
            />
          )}
          <dl className="verified-details">
            <div><dt>File</dt><dd>{verified.filename}</dd></div>
            <div><dt>Envelope</dt><dd>{verified.envelopeId}</dd></div>
            <div><dt>Sender</dt><dd>{verified.signerKeyId}</dd></div>
            <div><dt>Receiver</dt><dd>{receipt.receiverKeyId}</dd></div>
            <div><dt>Decision</dt><dd>{policyDecision.code}</dd></div>
            <div><dt>Event</dt><dd>release-authorized</dd></div>
          </dl>
          <button className="receiver-button primary save-button" type="button" onClick={() => void deliverReleasedFiles(verified, receipt)}>
            Save / Share authorized file again
          </button>
          {saveStatus && <p className="save-status" role="status">{saveStatus}</p>}
          <div className="evidence-actions" aria-label="Download signed release evidence">
            <button type="button" onClick={() => downloadEvidence("cose")}>Signed receipt</button>
            <button type="button" onClick={() => downloadEvidence("json")}>Receipt JSON</button>
            <button type="button" onClick={() => downloadEvidence("key")}>Receiver public key</button>
          </div>
          <button className="receiver-button secondary" type="button" onClick={resetToPaired}>Prepare another fresh envelope</button>
          <button className="text-button" type="button" onClick={clearPairing}>Forget this pairing</button>
        </section>
      )}

      {stage === "error" && (
        <section className="receiver-panel error-panel" role="alert">
          <div className="error-mark">!</div>
          <p className="receiver-kicker">FAIL CLOSED</p>
          <h1>Nothing was released.</h1>
          <p>{error}</p>
          {trust && (
            <button className="receiver-button secondary" type="button" onClick={() => void shareFailureReport()}>
              Save / share failure diagnostics
            </button>
          )}
          {measurementStatus && <p className="measurement-status" role="status">{measurementStatus}</p>}
          {trust && !mustRepair ? (
            <button className="receiver-button primary" type="button" onClick={resetToPaired}>Return to paired receiver</button>
          ) : (
            <button className="receiver-button secondary" type="button" onClick={clearPairing}>Scan the current pairing QR</button>
          )}
          <button className="text-button" type="button" onClick={clearPairing}>Clear pairing state</button>
        </section>
      )}

      <footer className="receiver-footer">
        <span>Payload path: screen → camera</span>
        <span>Local policy · replay ledger · signed release receipt</span>
        <span>Pre-alpha research · not a certified data diode</span>
      </footer>
    </main>
  );
}

export function CapacityScorecard({
  report,
  comparison,
  historySaved,
  status,
  onCopy,
  onShare,
}: {
  report: CapacityReport;
  comparison: CapacityComparison;
  historySaved: boolean;
  status: string;
  onCopy: () => void;
  onShare: () => void;
}) {
  const headlineGoodput = report.camera_to_verified_payload_bytes_per_second ??
    report.verified_payload_bytes_per_second;
  const headlineSeconds = report.camera_to_verified_seconds ?? report.transfer_seconds;
  const includesAcquisition = report.camera_to_verified_seconds !== undefined;
  const opticalCodeRate = report.optical_accepted_codes_per_second ??
    report.accepted_codes_per_second;
  const opticalSymbolRate = report.optical_accepted_symbol_bytes_per_second ??
    report.accepted_symbol_bytes_per_second;
  const previousDelta = comparison.changeFromPrevious;
  const deltaClass = previousDelta === undefined || Math.abs(previousDelta) < 0.005
    ? "neutral"
    : previousDelta > 0 ? "positive" : "negative";
  return (
    <section className="capacity-scorecard" aria-label="Post-receive transfer analytics">
      <div className="capacity-scorecard-heading">
        <div>
          <span>POST-RECEIVE ANALYTICS</span>
          <strong>Diagnostic verified transfer rate</strong>
        </div>
        <b className={comparison.isNewBest ? "new-best" : "run-number"}>
          {comparison.isNewBest && comparison.runNumber > 1 ? "NEW BROWSER BASELINE" : `RUN ${comparison.runNumber}`}
        </b>
      </div>
      <div className="capacity-hero">
        <strong>{formatRate(headlineGoodput)}</strong>
        <span>{formatBytes(report.file_bytes)} cryptographically verified in {headlineSeconds.toFixed(2)} sec · {includesAcquisition ? "camera open → verified" : "legacy first accepted → verification complete"}</span>
      </div>
      <p className="capacity-history-note">
        Receiver diagnostic only: sender optical start is not synchronized, so this rate is useful for same-setup iteration but is not a publication-grade speed benchmark.
      </p>
      <div className="capacity-comparison">
        {comparison.previousGoodput === undefined ? (
          <div className="capacity-baseline">
            <span>BROWSER BASELINE</span>
            <strong>First {report.profile.label} result saved</strong>
            <small>Repeat this profile and payload size to see the change.</small>
          </div>
        ) : (
          <>
            <div>
              <span>VS PREVIOUS</span>
              <strong className={deltaClass}>{formatDelta(previousDelta)}</strong>
              <small>Previous {formatRate(comparison.previousGoodput)} · {comparison.previousAcceptedCodesPerSecond?.toFixed(1) ?? "—"} codes/s</small>
            </div>
            <div>
              <span>PREVIOUS BEST</span>
              <strong>{formatRate(comparison.bestGoodputBefore ?? 0)}</strong>
              <small>{formatDelta(comparison.changeFromBest)} this run · {comparison.bestAcceptedCodesPerSecond?.toFixed(1) ?? "—"} codes/s</small>
            </div>
          </>
        )}
      </div>
      <div className="capacity-metric-grid">
        <div><span>END TO END</span><strong>{headlineSeconds.toFixed(2)} s</strong><small>{includesAcquisition ? "camera open → verified" : "legacy first accepted code → verification complete"}</small></div>
        <div><span>CODE RATE</span><strong>{opticalCodeRate.toFixed(1)}/s</strong><small>{report.accepted_codes} accepted codes · {report.optical_accepted_codes_per_second === undefined ? "legacy verification window" : "optical frame window"}</small></div>
        <div><span>ACCEPTANCE</span><strong>{report.decoded_acceptance_percent.toFixed(1)}%</strong><small>accepted ÷ all decoded codes</small></div>
        <div><span>EFFECTIVE PAYLOAD EFFICIENCY</span><strong>{report.payload_efficiency_percent.toFixed(1)}%</strong><small>file bytes ÷ accepted symbol bytes · compression may exceed 100%</small></div>
      </div>
      <details className="capacity-diagnostics">
        <summary>Pipeline diagnostics</summary>
        <dl>
          <div><dt>Profile</dt><dd>{report.profile.label} · {report.profile.lanes || "—"} lane{report.profile.lanes === 1 ? "" : "s"}{report.profile.qr_version ? ` · QR v${report.profile.qr_version}` : ""}</dd></div>
          <div><dt>Accepted / required</dt><dd>{report.accepted_codes} / {report.required_codes} codes</dd></div>
          <div><dt>Rejected / duplicate</dt><dd>{report.rejected_codes} / {report.duplicate_codes} codes</dd></div>
          <div><dt>{report.optical_accepted_symbol_bytes_per_second === undefined ? "Legacy accepted symbol rate" : "Accepted optical rate"}</dt><dd>{formatRate(opticalSymbolRate)}</dd></div>
          {report.optical_frame_window_seconds !== undefined && <div><dt>Optical frame window</dt><dd>{report.optical_frame_window_seconds.toFixed(3)} s from first accepted unique frame → last accepted unique frame · {(report.optical_accepted_codes_per_second ?? 0).toFixed(1)} codes/s · Grid includes its valid acquisition preamble</dd></div>}
          {includesAcquisition && <div><dt>Legacy verification-window goodput</dt><dd>{formatRate(report.verified_payload_bytes_per_second)} · {report.transfer_seconds.toFixed(2)} s from first accepted code → verification complete</dd></div>}
          <div><dt>Fountain overhead</dt><dd>{report.fountain_overhead_percent.toFixed(1)}%</dd></div>
          {report.transport && <div><dt>Optical packing</dt><dd>{report.transport.encoding} · {formatBytes(report.transport.optical_object_bytes)} transmitted · {report.transport.optical_reduction_percent.toFixed(1)}% reduction</dd></div>}
          <div><dt>Camera</dt><dd>{report.camera.width}×{report.camera.height} decode{report.camera.source_width ? ` · ${report.camera.source_width}×${report.camera.source_height} source` : ""} · {report.camera.observed_fps.toFixed(1)} observed / {report.camera.negotiated_fps.toFixed(0)} negotiated FPS · {report.camera.camera_exposures ?? "—"} exposures · {report.camera.callback_frames ?? "—"} callbacks · {report.camera.duplicate_callbacks ?? "—"} duplicate</dd></div>
          {report.camera.sampling_status && <div><dt>Camera sampling</dt><dd>{report.camera.sampling_status} · {report.camera.sampling_ratio?.toFixed(2) ?? "—"}× exposure/target ratio{report.camera.sampling_warning ? ` · ${report.camera.sampling_warning}` : ""}</dd></div>}
          {report.camera.time_to_first_valid_ms !== undefined && <div><dt>First valid symbol</dt><dd>{(report.camera.time_to_first_valid_ms / 1_000).toFixed(2)} s after camera open</dd></div>}
          <div><dt>Decoder</dt><dd>{report.camera.valid_codes_per_second.toFixed(1)} valid codes/s · p50 {report.camera.decode_p50_ms.toFixed(1)} ms · p95 {report.camera.decode_p95_ms.toFixed(1)} ms</dd></div>
          {report.camera.decode_jobs !== undefined && <div><dt>Optical acquisition</dt><dd>{report.camera.optical_acquisition_percent?.toFixed(1)}% · {report.camera.successful_decode_jobs} symbol jobs / {report.camera.decode_jobs} completed jobs · {report.camera.empty_decode_jobs} empty</dd></div>}
          {report.camera.unique_codes_per_second !== undefined && <div><dt>Symbol yield</dt><dd>{report.camera.unique_codes_per_second.toFixed(1)} unique/s · {report.camera.duplicate_codes_per_second?.toFixed(1) ?? "—"} duplicate/s</dd></div>}
          {report.camera.grid_last_outcome && <div><dt>Grid lock</dt><dd>{report.camera.grid_last_outcome} · contrast {report.camera.grid_contrast?.toFixed(0) ?? "—"} · fill {report.camera.grid_screen_fill_percent?.toFixed(1) ?? "—"}% · registration reused {report.camera.grid_registration_reuse_percent?.toFixed(1) ?? "—"}%</dd></div>}
          {report.camera.same_frame_reacquisitions !== undefined && <div><dt>Same-frame Grid reacquisition</dt><dd>{report.camera.same_frame_reacquisition_successes ?? 0} / {report.camera.same_frame_reacquisitions} successful · p50 {report.camera.same_frame_reacquisition_p50_ms?.toFixed(1) ?? "—"} ms · p95 {report.camera.same_frame_reacquisition_p95_ms?.toFixed(1) ?? "—"} ms</dd></div>}
          {report.profile.visual_phy && <div><dt>Bound channel</dt><dd>{report.profile.visual_phy} · {report.profile.target_symbol_rate ?? "—"} symbols/s target</dd></div>}
          <div><dt>Pressure</dt><dd>{report.camera.busy_drops} busy drops · {report.camera.rate_limited_exposures ?? 0} rate-limited exposures · {report.camera.submitted_exposures ?? "—"} submitted exposures · {report.camera.workers} workers · copy p95 {report.camera.capture_copy_p95_ms?.toFixed(1) ?? "—"} ms · worker round trip p95 {report.camera.worker_round_trip_p95_ms?.toFixed(1) ?? "—"} ms</dd></div>
        </dl>
      </details>
      <div className="capacity-actions">
        <button type="button" onClick={onCopy}>Copy benchmark JSON</button>
        <button type="button" onClick={onShare}>Save / share benchmark JSON</button>
      </div>
      <p className="capacity-history-note">
        {historySaved
          ? `Saved privately in this browser · last ${CAPACITY_HISTORY_LIMIT} successful runs retained · comparisons match browser user-agent + visual PHY + target rate + exact payload; this is not unique hardware identity`
          : "Device history is unavailable in this browser session. Export the JSON to preserve this run."}
      </p>
      {status && <p className="measurement-status" role="status">{status}</p>}
    </section>
  );
}

function releaseEvidenceFiles(
  transfer: VerifiedTransfer,
  receipt: BrowserReleaseReceipt,
): [File, File, File] {
  return [
    new File([receipt.cose.slice().buffer], `${transfer.envelopeId}.release.receipt.cose`, { type: "application/cbor" }),
    new File([receipt.json], `${transfer.envelopeId}.release.receipt.json`, { type: "application/json" }),
    new File([receipt.publicKey.slice().buffer], `${receipt.receiverKeyId}.receiver-public.ed25519`, { type: "application/octet-stream" }),
  ];
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function openCameraStream(): Promise<MediaStream> {
  const baseConstraints: MediaTrackConstraints = {
    facingMode: { ideal: "environment" },
    width: { ideal: 1_280 },
    height: { ideal: 720 },
    aspectRatio: { ideal: 16 / 9 },
  };
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...baseConstraints, frameRate: { exact: 60 } },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "NotAllowedError") throw error;
    return navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...baseConstraints, frameRate: { ideal: 60 } },
    });
  }
}

function percentile(sorted: number[], value: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * value))];
}

function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1_024) return `${Math.round(bytesPerSecond)} B/s`;
  return `${(bytesPerSecond / 1_024).toFixed(1)} KiB/s`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_024 * 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
  return `${(bytes / (1_024 * 1_024)).toFixed(1)} MiB`;
}

function formatDelta(value: number | undefined): string {
  if (value === undefined) return "—";
  const percent = value * 100;
  const prefix = percent > 0.05 ? "+" : "";
  return `${prefix}${percent.toFixed(1)}%`;
}

function formatSession(sessionId: Uint8Array): string {
  return Array.from(sessionId.slice(0, 4), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
