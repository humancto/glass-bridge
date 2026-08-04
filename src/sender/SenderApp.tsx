import { useEffect, useRef, useState } from "react";
import QRCode, { type QRCodeSegment } from "qrcode";
import {
  DEFAULT_OPTICAL_PROFILE_ID,
  nominalGoodputBytes,
  OPTICAL_PROFILE_ORDER,
  OPTICAL_PROFILES,
  type OpticalProfile,
  type OpticalProfileId,
} from "../protocol/optical-profile";
import {
  createBrowserEnvelope,
  formatBytes,
  MAX_BROWSER_FILE_BYTES,
  type BrowserEnvelope,
} from "./agx";
import { OpticalTransferEncoder, pairingUrl } from "./transport";
import "./sender.css";

type Phase = "choose" | "preparing" | "pair" | "playing" | "paused" | "error";

type PreparedTransfer = {
  envelope: BrowserEnvelope;
  encoder: OpticalTransferEncoder;
  pairing: string;
  originalBytes: number;
  profile: OpticalProfile;
  qrVersion: number;
};

const DEFAULT_BOUNDARY = "demo/phone-laptop";

export default function SenderApp() {
  const [file, setFile] = useState<File>();
  const [boundary, setBoundary] = useState(DEFAULT_BOUNDARY);
  const [prepared, setPrepared] = useState<PreparedTransfer>();
  const [phase, setPhase] = useState<Phase>("choose");
  const [error, setError] = useState("");
  const [profileId, setProfileId] = useState<OpticalProfileId>(DEFAULT_OPTICAL_PROFILE_ID);
  const [fps, setFps] = useState(OPTICAL_PROFILES[DEFAULT_OPTICAL_PROFILE_ID].defaultFps);
  const [frameNumber, setFrameNumber] = useState(0);
  const [loops, setLoops] = useState(0);
  const [measuredFps, setMeasuredFps] = useState(0);
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const frameRef = useRef(0);
  const loopsRef = useRef(0);
  const fpsRef = useRef(fps);
  fpsRef.current = fps;

  useEffect(() => {
    if (!prepared || phase !== "pair") return;
    let active = true;
    void drawQr(prepared.pairing, "M", () => active).catch((renderError: unknown) => {
      if (active) fail(renderError);
    });
    return () => { active = false; };
  }, [prepared, phase]);

  useEffect(() => {
    if (!prepared || phase !== "playing") return;
    let active = true;
    let animationFrame = 0;
    let rendering = false;
    let deadlineMs = performance.now();
    let measurementStartedMs = deadlineMs;
    let measuredFrames = 0;
    let lastUiPaintMs = deadlineMs;
    setMeasuredFps(0);

    async function renderFrame(nowMs: number): Promise<void> {
      const activeTransfer = prepared;
      if (!active || !activeTransfer || rendering) return;
      const intervalMs = 1_000 / fpsRef.current;
      if (nowMs + 0.5 < deadlineMs) return;
      rendering = true;
      const symbolId = frameRef.current;
      try {
        await drawQr(
          opticalQrPayload(activeTransfer, symbolId),
          activeTransfer.profile.errorCorrectionLevel,
          () => active,
          activeTransfer.profile,
        );
      } catch (renderError) {
        if (active) fail(renderError);
        rendering = false;
        return;
      }
      if (!active) {
        rendering = false;
        return;
      }
      const renderedAtMs = performance.now();
      measuredFrames += 1;
      const measurementElapsedMs = renderedAtMs - measurementStartedMs;
      if (measurementElapsedMs >= 1_000) {
        setMeasuredFps(measuredFrames * 1_000 / measurementElapsedMs);
        measurementStartedMs = renderedAtMs;
        measuredFrames = 0;
      }
      frameRef.current += 1;
      if (!activeTransfer.profile.continuousRepair && frameRef.current >= activeTransfer.encoder.frameCount) {
        frameRef.current = 0;
        loopsRef.current += 1;
        setLoops(loopsRef.current);
      }
      if (renderedAtMs - lastUiPaintMs >= 200) {
        setFrameNumber(frameRef.current);
        lastUiPaintMs = renderedAtMs;
      }
      const nextDeadline = deadlineMs + intervalMs;
      deadlineMs = nextDeadline < renderedAtMs - intervalMs
        ? renderedAtMs + intervalMs
        : nextDeadline;
      rendering = false;
    }

    const pump = (nowMs: number) => {
      if (!active) return;
      void renderFrame(nowMs);
      animationFrame = window.requestAnimationFrame(pump);
    };
    animationFrame = window.requestAnimationFrame(pump);
    return () => {
      active = false;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [prepared, phase]);

  async function drawQr(
    value: string | QRCodeSegment[],
    errorCorrectionLevel: "L" | "M",
    shouldCommit = () => true,
    profile?: OpticalProfile,
  ): Promise<void> {
    const displayPixels = Math.max(
      320,
      Math.min(820, Math.floor(window.innerHeight * 0.76), Math.floor(window.innerWidth * 0.76)),
    );
    const rendered = renderCanvasRef.current ?? document.createElement("canvas");
    renderCanvasRef.current = rendered;
    await renderQrCanvas(
      rendered,
      value,
      errorCorrectionLevel,
      displayPixels,
      { dark: "#07110d", light: "#ffffff" },
      profile?.qrVersion,
      profile?.maskPattern,
    );
    if (!shouldCommit()) return;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    context.drawImage(rendered, 0, 0);
  }

  function fail(value: unknown): void {
    setError(value instanceof Error ? value.message : "The sender could not prepare this transfer.");
    setPhase("error");
  }

  function selectFile(nextFile: File): void {
    setFile(nextFile);
    setPrepared(undefined);
    setError("");
    setPhase("choose");
  }

  async function prepareTransfer(candidate = file): Promise<void> {
    if (!candidate) {
      setError("Choose a file first.");
      return;
    }
    if (candidate.size > MAX_BROWSER_FILE_BYTES) {
      setError(`Choose a file no larger than ${formatBytes(MAX_BROWSER_FILE_BYTES)} for this milestone.`);
      return;
    }
    setFile(candidate);
    setError("");
    setPhase("preparing");
    try {
      const payload = new Uint8Array(await candidate.arrayBuffer());
      const envelope = await createBrowserEnvelope(payload, {
        filename: candidate.name,
        mediaType: candidate.type || "application/octet-stream",
        boundary,
      });
      const profile = OPTICAL_PROFILES[profileId];
      const encoder = new OpticalTransferEncoder(envelope.bytes, {
        symbolSize: profile.symbolSize,
        codec: profile.codec,
      });
      const qrVersion = QRCode.create(opticalQrPayload({ encoder, profile }, 0), {
        errorCorrectionLevel: profile.errorCorrectionLevel,
        version: profile.qrVersion,
        maskPattern: profile.maskPattern,
      }).version;
      const receiver = new URL(`${import.meta.env.BASE_URL}receive.html`, window.location.origin);
      const pairing = pairingUrl(receiver.toString(), envelope.publicKey, envelope.boundary);
      frameRef.current = 0;
      loopsRef.current = 0;
      setFrameNumber(0);
      setLoops(0);
      setPrepared({ envelope, encoder, pairing, originalBytes: candidate.size, profile, qrVersion });
      setPhase("pair");
    } catch (prepareError) {
      fail(prepareError);
    }
  }

  async function useSample(): Promise<void> {
    const sample = new File(
      [
        "GlassBridge arbitrary-file browser sender\n",
        `prepared=${new Date().toISOString()}\n`,
        "This file was signed, fountain-coded, carried by light, and verified on the phone.\n",
      ],
      "glassbridge-browser-sample.txt",
      { type: "text/plain" },
    );
    selectFile(sample);
    await prepareTransfer(sample);
  }

  function showPairing(): void {
    frameRef.current = 0;
    loopsRef.current = 0;
    setFrameNumber(0);
    setLoops(0);
    setPhase("pair");
  }

  function reset(): void {
    setFile(undefined);
    setPrepared(undefined);
    setError("");
    setPhase("choose");
    frameRef.current = 0;
    loopsRef.current = 0;
    setMeasuredFps(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const activeStep = phase === "choose" || phase === "preparing" || phase === "error"
    ? 1
    : phase === "pair"
      ? 2
      : 3;
  const cycleSeconds = prepared ? prepared.encoder.frameCount / fps : 0;
  const idealSeconds = prepared ? prepared.encoder.sourceCount / fps : 0;
  const selectedProfile = OPTICAL_PROFILES[profileId];

  return (
    <main className="sender-app">
      <header className="sender-header">
        <a className="sender-brand" href={import.meta.env.BASE_URL}>
          <span>GB</span>
          <div><b>GlassBridge</b><small>OPTICAL FILE SENDER</small></div>
        </a>
        <div className="sender-header-actions">
          <a href={`${import.meta.env.BASE_URL}receive.html`}>Phone receiver</a>
          <span className={`sender-phase phase-${phase}`}>{phase.toUpperCase()}</span>
        </div>
      </header>

      <section className="sender-intro">
        <div>
          <p className="sender-kicker">LAPTOP → PHONE / MILESTONE 11 TURBO</p>
          <h1>Choose a file.<br /><em>Send it through light.</em></h1>
        </div>
        <p>
          Nothing is uploaded. Your browser signs the file in memory, turns the signed AGX
          envelope into repairable QR frames, and displays them for the phone camera.
        </p>
      </section>

      <ol className="sender-steps" aria-label="Transfer steps">
        <li className={activeStep === 1 ? "active" : activeStep > 1 ? "done" : ""}>
          <span>01</span><div><b>Choose</b><small>Select the laptop file</small></div>
        </li>
        <li className={activeStep === 2 ? "active" : activeStep > 2 ? "done" : ""}>
          <span>02</span><div><b>Pair</b><small>Scan once with Camera</small></div>
        </li>
        <li className={activeStep === 3 ? "active" : ""}>
          <span>03</span><div><b>Transfer</b><small>Use the GlassBridge camera</small></div>
        </li>
      </ol>

      {(phase === "choose" || phase === "preparing" || phase === "error") && (
        <section className="sender-panel choose-panel">
          <div
            className={`drop-zone ${dragging ? "dragging" : ""}`}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const dropped = event.dataTransfer.files.item(0);
              if (dropped) selectFile(dropped);
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === " ") event.preventDefault();
              if (event.key === "Enter" || event.key === " ") fileInputRef.current?.click();
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              onChange={(event) => {
                const selected = event.currentTarget.files?.item(0);
                if (selected) selectFile(selected);
              }}
            />
            <span className="drop-icon">↥</span>
            {file ? (
              <div><strong>{file.name}</strong><small>{formatBytes(file.size)} · {file.type || "binary file"}</small></div>
            ) : (
              <div><strong>Drop a file here</strong><small>or click to browse · up to 256 KiB</small></div>
            )}
          </div>

          <fieldset className="profile-field" disabled={phase === "preparing"}>
            <legend>Optical profile</legend>
            <div className="profile-options">
              {OPTICAL_PROFILE_ORDER.map((candidateId) => {
                const candidate = OPTICAL_PROFILES[candidateId];
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={candidate.id === profileId ? "selected" : ""}
                    aria-pressed={candidate.id === profileId}
                    onClick={() => {
                      setProfileId(candidate.id);
                      setFps(candidate.defaultFps);
                    }}
                  >
                    <b>{candidate.label}</b>
                    <small>{candidate.summary}</small>
                  </button>
                );
              })}
            </div>
            <small>
              {formatRate(nominalGoodputBytes(selectedProfile, selectedProfile.defaultFps))} nominal.
              Turbo is the experimental high-throughput path. Use Steady if the camera struggles to focus.
            </small>
          </fieldset>

          <label className="boundary-field">
            <span>Receiving boundary</span>
            <input
              value={boundary}
              maxLength={120}
              onChange={(event) => setBoundary(event.currentTarget.value)}
              disabled={phase === "preparing"}
            />
            <small>The signed envelope and pairing QR must agree on this value.</small>
          </label>

          {error && <p className="sender-error" role="alert">{error}</p>}

          <div className="choose-actions">
            <button
              className="primary-action"
              disabled={!file || phase === "preparing"}
              onClick={() => { void prepareTransfer(); }}
            >
              {phase === "preparing" ? "Signing and encoding…" : "Prepare secure transfer"}
            </button>
            <button disabled={phase === "preparing"} onClick={() => { void useSample(); }}>
              Try the sample file
            </button>
          </div>
          <p className="security-note">
            The generated signer is ephemeral and trusted only through this pairing QR. It proves
            this session’s integrity—not an organizational identity.
          </p>
        </section>
      )}

      {prepared && phase !== "choose" && phase !== "preparing" && phase !== "error" && (
        <section className="sender-panel transfer-panel" ref={stageRef}>
          <div className="transfer-heading">
            <div>
              <p className="sender-kicker">{phase === "pair" ? "STEP 2 / PAIR PHONE" : "STEP 3 / OPTICAL TRANSFER"}</p>
              <h2>{phase === "pair" ? "Scan this once with the phone Camera." : "Aim the GlassBridge camera at this code."}</h2>
            </div>
            <div className="live-status">
              <span className={phase === "playing" ? "pulse" : ""}></span>
              {phase === "playing"
                ? frameNumber <= prepared.encoder.sourceCount
                  ? `SOURCE ${frameNumber}/${prepared.encoder.sourceCount}`
                  : `REPAIR ${frameNumber - prepared.encoder.sourceCount}`
                : phase.toUpperCase()}
            </div>
          </div>

          <div className="sender-qr-shell">
            <canvas ref={canvasRef} aria-label={phase === "pair" ? "Phone pairing QR" : "Animated optical transfer QR"}></canvas>
            {phase === "pair" && <div className="pair-label">NORMAL CAMERA · SCAN ONCE</div>}
          </div>

          <div className="transfer-controls">
            <button onClick={showPairing}>1 · Show pairing QR</button>
            <button
              className="primary-action"
              onClick={() => setPhase(phase === "playing" ? "paused" : "playing")}
            >
              {phase === "playing" ? "Pause transfer" : "2 · Start transfer"}
            </button>
            <button onClick={() => {
              const stage = stageRef.current;
              if (stage) void stage.requestFullscreen().catch((fullscreenError: unknown) => fail(fullscreenError));
            }}>Fullscreen</button>
            <label className="speed-control">
              <span>Speed</span>
              <input
                type="range"
                min={prepared.profile.minFps}
                max={prepared.profile.maxFps}
                value={fps}
                onChange={(event) => setFps(Number(event.currentTarget.value))}
              />
              <b>{fps} FPS{measuredFps > 0 ? ` · ${measuredFps.toFixed(1)} actual` : ""}</b>
            </label>
          </div>

          <div className="transfer-facts">
            <div><span>File</span><strong>{prepared.envelope.filename}</strong><small>{formatBytes(prepared.originalBytes)}</small></div>
            <div><span>Sender fingerprint</span><strong>{prepared.envelope.signerKeyId}</strong><small>Match this on the phone</small></div>
            <div>
              <span>Source lower bound</span>
              <strong>~{formatDuration(idealSeconds)} at selected FPS</strong>
              <small>{prepared.encoder.sourceCount} source frames · excludes camera loss and fountain overhead</small>
            </div>
            <div>
              <span>Optical profile</span>
              <strong>{prepared.profile.label} · {formatRate(nominalGoodputBytes(prepared.profile, fps))}</strong>
              <small>
                {prepared.profile.symbolSize.toLocaleString()} B/frame · QR v{prepared.qrVersion}-{prepared.profile.errorCorrectionLevel} · {prepared.profile.continuousRepair
                  ? `${formatDuration(cycleSeconds)} expected solve window · endless unique repair`
                  : `${formatDuration(cycleSeconds)} repair loop · ${loops} loops`}
              </small>
            </div>
            <div><span>Security</span><strong>Ed25519 + SHA-256</strong><small>AGX/1 signed envelope</small></div>
          </div>

          <div className="transfer-footer">
            <p>
              Pair with the normal Camera. After the receiver says <b>PAIRED</b>, tap
              <b> Trust sender &amp; open camera</b> there. Only then start these animated frames.
            </p>
            <button onClick={reset}>Choose another file</button>
          </div>
        </section>
      )}
    </main>
  );
}

function opticalQrPayload(
  transfer: Pick<PreparedTransfer, "encoder" | "profile">,
  symbolId: number,
): string | QRCodeSegment[] {
  if (transfer.profile.payloadMode === "binary") {
    return [{ data: transfer.encoder.frameBytes(symbolId), mode: "byte" }];
  }
  return transfer.encoder.frameText(symbolId);
}

async function renderQrCanvas(
  canvas: HTMLCanvasElement,
  value: string | QRCodeSegment[],
  errorCorrectionLevel: "L" | "M",
  targetPixels: number,
  color?: { dark: string; light: string },
  version?: number,
  maskPattern?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7,
): Promise<number> {
  // Preserve the QR specification's four-module quiet zone at every density.
  const margin = 4;
  // Fixed version/mask options avoid a second full QR analysis on every Turbo frame.
  const qrVersion = version ?? QRCode.create(value, { errorCorrectionLevel, maskPattern }).version;
  const moduleCount = 21 + (qrVersion - 1) * 4;
  const totalModules = moduleCount + margin * 2;
  const scale = Math.max(2, Math.floor(targetPixels / totalModules));
  await QRCode.toCanvas(canvas, value, {
    errorCorrectionLevel,
    version: qrVersion,
    maskPattern,
    margin,
    scale,
    color,
  });
  return qrVersion;
}

function formatDuration(seconds: number): string {
  if (seconds < 10) return `${(Math.ceil(seconds * 10) / 10).toFixed(1)} sec`;
  const totalSeconds = Math.ceil(seconds);
  if (totalSeconds < 60) return `${totalSeconds} sec`;
  const minutes = Math.floor(totalSeconds / 60);
  return `${minutes} min ${totalSeconds % 60} sec`;
}

function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1_024) return `${Math.round(bytesPerSecond)} B/s`;
  const kibibytes = bytesPerSecond / 1_024;
  return `${Number.isInteger(kibibytes) ? kibibytes : kibibytes.toFixed(1)} KiB/s`;
}
