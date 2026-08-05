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
import { DecodeWorkerPool, type DecodeResult } from "./decode-worker-pool";
import { dualLaneCaptureRegions, fitCaptureDimensions } from "./camera-capture";
import { OPTICAL_PROFILES } from "../protocol/optical-profile";
import {
  measureTransport,
} from "./capacity-measurement";
import { unpackOpticalPayload } from "../protocol/optical-payload";
import {
  CAPACITY_HISTORY_LIMIT,
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
  base64UrlEncode,
  OpticalTransferDecoder,
  type TransferProgress,
} from "./transport";

type Stage = "unpaired" | "paired" | "scanning" | "verifying" | "quarantined" | "releasing" | "released" | "error";
type SourceMode = "camera" | "files";
type ScannerControls = { stop(): void };

type LiveMetrics = {
  cameraFps: number;
  decodeFps: number;
  medianDecodeMs: number;
  p95DecodeMs: number;
  busyDrops: number;
  workers: number;
  width: number;
  height: number;
  negotiatedFps: number;
};

const SESSION_TRUST_KEY = "glassbridge-demo-trust-v2";
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
  medianDecodeMs: 0,
  p95DecodeMs: 0,
  busyDrops: 0,
  workers: 0,
  width: 0,
  height: 0,
  negotiatedFps: 0,
};

function readTrust(): { trust?: BootstrapTrust; error?: string } {
  try {
    if (window.location.hash.length > 1) {
      const trust = parseBootstrapHash(window.location.hash);
      window.sessionStorage.setItem(
        SESSION_TRUST_KEY,
        JSON.stringify({
          key: base64UrlEncode(trust.publicKey),
          boundary: trust.boundary,
          session: trust.sessionId ? base64UrlEncode(trust.sessionId) : undefined,
          profile: trust.profileId,
          packing: trust.packing,
        }),
      );
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      return { trust };
    }
    const stored = window.sessionStorage.getItem(SESSION_TRUST_KEY);
    if (!stored) {
      return {};
    }
    const value = JSON.parse(stored) as {
      key?: unknown;
      boundary?: unknown;
      session?: unknown;
      profile?: unknown;
      packing?: unknown;
    };
    if (typeof value.key !== "string" || typeof value.boundary !== "string") {
      throw new Error("Stored pairing is invalid.");
    }
    const hasSession = typeof value.session === "string" && typeof value.profile === "string";
    const hasPacking = value.packing === "identity" || value.packing === "gzip";
    const params = new URLSearchParams({
      v: hasPacking ? "3" : hasSession ? "2" : "1",
      key: value.key,
      boundary: value.boundary,
    });
    if (hasSession) {
      params.set("session", value.session as string);
      params.set("profile", value.profile as string);
    }
    if (hasPacking) params.set("packing", value.packing as string);
    return {
      trust: parseBootstrapHash(`#${params.toString()}`),
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Pairing failed." };
  }
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
  const decoderRef = useRef(new OpticalTransferDecoder(initial.trust?.sessionId));
  const verifyingRef = useRef(false);
  const releasingRef = useRef(false);
  const lastProgressPaintRef = useRef(0);
  const transferStartedAtRef = useRef<number | undefined>(undefined);
  const liveMetricsRef = useRef<LiveMetrics>(EMPTY_METRICS);

  useEffect(() => {
    if (!trust) {
      return;
    }
    void trustFingerprint(trust)
      .then(setFingerprint)
      .catch(() => setFingerprint("unavailable"));
  }, [trust]);

  useEffect(() => () => controlsRef.current?.stop(), []);

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
  ): Promise<void> {
    if (!trust || verifyingRef.current) {
      return;
    }
    verifyingRef.current = true;
    callbackControls?.stop();
    setStage("verifying");
    try {
      const opticalPayload = await unpackOpticalPayload(envelope, trust.packing ?? "identity");
      const transfer = await verifyAgxEnvelope(opticalPayload.bytes, trust);
      const decision = await evaluateBrowserPolicy(transfer);
      if (!decision.allowed) {
        throw new Error(`${decision.code}: ${decision.reason}`);
      }
      assertFreshTransfer(transfer);
      const verifiedAtMs = performance.now();
      setVerified(transfer);
      setPolicyDecision(decision);
      const startedAt = transferStartedAtRef.current;
      if (startedAt !== undefined && completion && completion.acceptedFrames > 0) {
        const seconds = Math.max(0.001, (verifiedAtMs - startedAt) / 1_000);
        const nextMeasurement = measureTransport(transfer.payload.length, seconds, completion);
        const nextReport = createCapacityReport({
          profileId: trust.profileId,
          transferSession: trust.sessionId ? formatSession(trust.sessionId) : undefined,
          fileBytes: transfer.payload.length,
          payloadSha256: transfer.payloadSha256,
          measurement: nextMeasurement,
          opticalPayload,
          camera: liveMetricsRef.current,
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
      }
      setStage("quarantined");
    } catch (verificationError) {
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

    controlsRef.current?.stop();
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
    setSourceMode("camera");
    setStage("scanning");

    let stream: MediaStream | undefined;
    try {
      stream = await openCameraStream();
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();

      const trackSettings = stream.getVideoTracks()[0]?.getSettings();
      const sourceWidth = video.videoWidth || trackSettings?.width || 1_280;
      const sourceHeight = video.videoHeight || trackSettings?.height || 720;
      const { width: captureWidth, height: captureHeight } = fitCaptureDimensions(sourceWidth, sourceHeight);
      const captureCanvas = document.createElement("canvas");
      captureCanvas.width = captureWidth;
      captureCanvas.height = captureHeight;
      const captureContext = captureCanvas.getContext("2d", { willReadFrequently: true });
      if (!captureContext) throw new Error("The camera capture surface is unavailable.");

      const opticalLanes = trust.profileId ? OPTICAL_PROFILES[trust.profileId].lanes : 1;
      const laneRegions = opticalLanes === 2
        ? dualLaneCaptureRegions(captureWidth, captureHeight)
        : undefined;
      const workerCount = Math.min(4, Math.max(2, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
      let active = true;
      let callbackId = 0;
      let cameraFrames = 0;
      let decodedFrames = 0;
      let busyDrops = 0;
      const cameraStartedAt = performance.now();
      let lastMetricsPaint = cameraStartedAt;
      const decodeTimes: number[] = [];

      const updateMetrics = (force = false) => {
        const now = performance.now();
        if (!force && now - lastMetricsPaint < 500) return;
        const seconds = Math.max(0.001, (now - cameraStartedAt) / 1_000);
        const sorted = [...decodeTimes].sort((left, right) => left - right);
        const nextMetrics: LiveMetrics = {
          cameraFps: cameraFrames / seconds,
          decodeFps: decodedFrames / seconds,
          medianDecodeMs: percentile(sorted, 0.5),
          p95DecodeMs: percentile(sorted, 0.95),
          busyDrops,
          workers: workerCount,
          width: sourceWidth,
          height: sourceHeight,
          negotiatedFps: trackSettings?.frameRate ?? 0,
        };
        liveMetricsRef.current = nextMetrics;
        setLiveMetrics(nextMetrics);
        lastMetricsPaint = now;
      };

      let controls: ScannerControls;
      const pool = new DecodeWorkerPool(workerCount, (result: DecodeResult) => {
        if (!active || verifyingRef.current) return;
        decodeTimes.push(result.decodeMs);
        if (decodeTimes.length > 240) decodeTimes.splice(0, decodeTimes.length - 240);
        if (result.error) {
          controls.stop();
          controlsRef.current = undefined;
          setError(`Optical decoder unavailable: ${result.error}`);
          setStage("error");
          return;
        }
        const codes = result.codes ?? [];
        if (codes.length === 0) {
          updateMetrics();
          return;
        }
        decodedFrames += codes.length;
        for (const code of codes) {
          const decoder = decoderRef.current;
          const before = decoder.snapshot().acceptedFrames;
          const next = code.bytes && isOpticalFrame(code.bytes)
            ? decoder.ingestFrame(code.bytes)
            : decoder.ingestText(code.text ?? "");
          if (next.rejectionReason === "wrong-session") {
            controls.stop();
            controlsRef.current = undefined;
            setMustRepair(true);
            setError("This phone is paired to a different transfer session. Scan the stationary pairing QR currently shown on the laptop, then try again.");
            setStage("error");
            return;
          }
          if (next.acceptedFrames > before && transferStartedAtRef.current === undefined) {
            transferStartedAtRef.current = performance.now();
          }
          publishProgress(next, next.complete);
          if (next.acceptedFrames === 0 && next.rejectedFrames >= INVALID_FRAME_LIMIT) {
            controls.stop();
            controlsRef.current = undefined;
            setError("The camera can see QR shapes, but no intact GlassBridge frame survived. Keep both codes fully inside the guide, move closer until each code is sharp, and restart at 30/s before increasing speed.");
            setStage("error");
            return;
          }
          if (next.envelope) {
            updateMetrics(true);
            void finishEnvelope(next.envelope, controls, next);
            break;
          }
        }
        if (!verifyingRef.current) updateMetrics();
      });

      const stop = () => {
        if (!active) return;
        active = false;
        if ("cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(callbackId);
        else window.cancelAnimationFrame(callbackId);
        pool.stop();
        for (const track of stream?.getTracks() ?? []) track.stop();
        video.srcObject = null;
      };
      controls = { stop };
      controlsRef.current = controls;

      const captureFrame = () => {
        if (!active || verifyingRef.current) return;
        cameraFrames += 1;
        if (pool.busyCount === pool.size) {
          busyDrops += 1;
          updateMetrics();
          return;
        }
        captureContext.drawImage(
          video,
          0,
          0,
          sourceWidth,
          sourceHeight,
          0,
          0,
          captureWidth,
          captureHeight,
        );
        if (laneRegions && cameraFrames % 15 !== 0) {
          // Alternate submission priority so a saturated worker pool cannot
          // repeatedly favor the left lane and starve the right lane.
          const orderedRegions = cameraFrames % 2 === 0
            ? laneRegions
            : [laneRegions[1], laneRegions[0]];
          for (const region of orderedRegions) {
            const image = captureContext.getImageData(region.x, region.y, region.width, region.height);
            if (!pool.submit(image, 1)) busyDrops += 1;
          }
        } else {
          // Periodic full-frame acquisition lets the operator recover when the
          // display is not perfectly centered across the two lane regions.
          const image = captureContext.getImageData(0, 0, captureWidth, captureHeight);
          if (!pool.submit(image, opticalLanes)) busyDrops += 1;
        }
        updateMetrics();
      };

      if ("requestVideoFrameCallback" in video) {
        const onVideoFrame: VideoFrameRequestCallback = () => {
          captureFrame();
          if (active) callbackId = video.requestVideoFrameCallback(onVideoFrame);
        };
        callbackId = video.requestVideoFrameCallback(onVideoFrame);
      } else {
        const onAnimationFrame = () => {
          captureFrame();
          if (active) callbackId = window.requestAnimationFrame(onAnimationFrame);
        };
        callbackId = window.requestAnimationFrame(onAnimationFrame);
      }
    } catch (cameraError) {
      controlsRef.current?.stop();
      controlsRef.current = undefined;
      for (const track of stream?.getTracks() ?? []) track.stop();
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
    if (files.length > 600) {
      setError("Select no more than 600 QR images in one diagnostic run.");
      setStage("error");
      return;
    }
    controlsRef.current?.stop();
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
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader();
      for (const file of Array.from(files)) {
        const url = URL.createObjectURL(file);
        try {
          const result = await reader.decodeFromImageUrl(url);
          const next = ingestDecodedQr(result, decoderRef.current);
          publishProgress(next, next.complete);
          if (next.envelope) {
            await finishEnvelope(next.envelope);
            return;
          }
        } catch {
          publishProgress(decoderRef.current.ingestText("invalid-frame"));
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const finalProgress = decoderRef.current.snapshot();
      setError(`Not enough independent frames: rank ${finalProgress.rank} of ${finalProgress.required || "unknown"}.`);
      setStage("error");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  function stopCamera(): void {
    controlsRef.current?.stop();
    controlsRef.current = undefined;
    setStage("paired");
  }

  function resetToPaired(): void {
    controlsRef.current?.stop();
    controlsRef.current = undefined;
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
    setSourceMode("camera");
    setStage("paired");
  }

  function clearPairing(): void {
    controlsRef.current?.stop();
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
    const file = new File(
      [JSON.stringify(capacityReport, null, 2)],
      `glassbridge-benchmark-${capacityReport.measured_at.replaceAll(":", "-")}.json`,
      { type: "application/json" },
    );
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
        await navigator.share({
          title: "GlassBridge transfer benchmark",
          text: `${formatRate(capacityReport.verified_payload_bytes_per_second)} verified goodput`,
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
              <div><span>CAMERA</span><strong>{liveMetrics.cameraFps.toFixed(1)} FPS</strong><small>{liveMetrics.width}×{liveMetrics.height} @ {liveMetrics.negotiatedFps.toFixed(0) || "—"}</small></div>
              <div><span>VALID CODES</span><strong>{liveMetrics.decodeFps.toFixed(1)} / SEC</strong><small>{liveMetrics.workers} WASM workers · p50 {liveMetrics.medianDecodeMs.toFixed(0)} ms</small></div>
              <div><span>PRESSURE</span><strong>{liveMetrics.busyDrops} dropped</strong><small>p95 decode {liveMetrics.p95DecodeMs.toFixed(0)} ms</small></div>
            </div>
          )}

          {stage === "paired" ? (
            <>
              <button className="receiver-button primary" type="button" onClick={() => void startCamera()}>
                Trust sender &amp; open camera
              </button>
              <p className="security-note">Landscape is recommended for dual-lane capacity modes, but it is never a blocker. Start the camera and keep both QR codes fully inside the guide.</p>
              <button className="receiver-button secondary" type="button" onClick={() => fileInputRef.current?.click()}>
                Diagnostic: decode saved QR frames
              </button>
              <input
                ref={fileInputRef}
                className="hidden-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
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
  const previousDelta = comparison.changeFromPrevious;
  const deltaClass = previousDelta === undefined || Math.abs(previousDelta) < 0.005
    ? "neutral"
    : previousDelta > 0 ? "positive" : "negative";
  return (
    <section className="capacity-scorecard" aria-label="Post-receive transfer analytics">
      <div className="capacity-scorecard-heading">
        <div>
          <span>POST-RECEIVE ANALYTICS</span>
          <strong>Verified goodput</strong>
        </div>
        <b className={comparison.isNewBest ? "new-best" : "run-number"}>
          {comparison.isNewBest && comparison.runNumber > 1 ? "NEW BEST" : `RUN ${comparison.runNumber}`}
        </b>
      </div>
      <div className="capacity-hero">
        <strong>{formatRate(report.verified_payload_bytes_per_second)}</strong>
        <span>{formatBytes(report.file_bytes)} cryptographically verified in {report.transfer_seconds.toFixed(2)} sec</span>
      </div>
      <div className="capacity-comparison">
        {comparison.previousGoodput === undefined ? (
          <div className="capacity-baseline">
            <span>DEVICE BASELINE</span>
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
        <div><span>ELAPSED</span><strong>{report.transfer_seconds.toFixed(2)} s</strong><small>first accepted code → verified</small></div>
        <div><span>CODE RATE</span><strong>{report.accepted_codes_per_second.toFixed(1)}/s</strong><small>{report.accepted_codes} accepted codes</small></div>
        <div><span>ACCEPTANCE</span><strong>{report.decoded_acceptance_percent.toFixed(1)}%</strong><small>accepted ÷ all decoded codes</small></div>
        <div><span>PAYLOAD EFFICIENCY</span><strong>{report.payload_efficiency_percent.toFixed(1)}%</strong><small>file bytes ÷ accepted symbol bytes</small></div>
      </div>
      <details className="capacity-diagnostics">
        <summary>Pipeline diagnostics</summary>
        <dl>
          <div><dt>Profile</dt><dd>{report.profile.label} · {report.profile.lanes || "—"} lane{report.profile.lanes === 1 ? "" : "s"}{report.profile.qr_version ? ` · QR v${report.profile.qr_version}` : ""}</dd></div>
          <div><dt>Accepted / required</dt><dd>{report.accepted_codes} / {report.required_codes} codes</dd></div>
          <div><dt>Rejected / duplicate</dt><dd>{report.rejected_codes} / {report.duplicate_codes} codes</dd></div>
          <div><dt>Accepted optical rate</dt><dd>{formatRate(report.accepted_symbol_bytes_per_second)}</dd></div>
          <div><dt>Fountain overhead</dt><dd>{report.fountain_overhead_percent.toFixed(1)}%</dd></div>
          {report.transport && <div><dt>Optical packing</dt><dd>{report.transport.encoding} · {formatBytes(report.transport.optical_object_bytes)} transmitted · {report.transport.optical_reduction_percent.toFixed(1)}% reduction</dd></div>}
          <div><dt>Camera</dt><dd>{report.camera.width}×{report.camera.height} · {report.camera.observed_fps.toFixed(1)} observed / {report.camera.negotiated_fps.toFixed(0)} negotiated FPS</dd></div>
          <div><dt>Decoder</dt><dd>{report.camera.valid_codes_per_second.toFixed(1)} valid codes/s · p50 {report.camera.decode_p50_ms.toFixed(1)} ms · p95 {report.camera.decode_p95_ms.toFixed(1)} ms</dd></div>
          <div><dt>Pressure</dt><dd>{report.camera.busy_drops} busy drops · {report.camera.workers} workers</dd></div>
        </dl>
      </details>
      <div className="capacity-actions">
        <button type="button" onClick={onCopy}>Copy benchmark JSON</button>
        <button type="button" onClick={onShare}>Save / share benchmark JSON</button>
      </div>
      <p className="capacity-history-note">
        {historySaved
          ? `Saved privately on this device · last ${CAPACITY_HISTORY_LIMIT} runs retained · comparisons match profile + exact payload`
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

function isOpticalFrame(bytes: Uint8Array): boolean {
  return bytes.length >= 44 &&
    bytes[0] === 0x41 &&
    bytes[1] === 0x47 &&
    bytes[2] === 0x46 &&
    (bytes[3] === 0x31 || bytes[3] === 0x32);
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
