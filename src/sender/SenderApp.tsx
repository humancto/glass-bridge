import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  createBrowserEnvelope,
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
};

const DEFAULT_BOUNDARY = "demo/phone-laptop";

export default function SenderApp() {
  const [file, setFile] = useState<File>();
  const [boundary, setBoundary] = useState(DEFAULT_BOUNDARY);
  const [prepared, setPrepared] = useState<PreparedTransfer>();
  const [phase, setPhase] = useState<Phase>("choose");
  const [error, setError] = useState("");
  const [fps, setFps] = useState(4);
  const [frameNumber, setFrameNumber] = useState(0);
  const [loops, setLoops] = useState(0);
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  const frameRef = useRef(0);
  const loopsRef = useRef(0);

  useEffect(() => {
    if (!prepared || phase !== "pair") return;
    void drawQr(prepared.pairing).catch((renderError: unknown) => {
      fail(renderError);
    });
  }, [prepared, phase]);

  useEffect(() => {
    if (!prepared || phase !== "playing") return;
    let active = true;
    let timer = 0;

    async function tick(): Promise<void> {
      const activeTransfer = prepared;
      if (!active || !activeTransfer) return;
      const symbolId = frameRef.current;
      try {
        await drawQr(activeTransfer.encoder.frameText(symbolId));
      } catch (renderError) {
        if (active) fail(renderError);
        return;
      }
      if (!active) return;
      setFrameNumber(symbolId + 1);
      frameRef.current += 1;
      if (frameRef.current >= activeTransfer.encoder.frameCount) {
        frameRef.current = 0;
        loopsRef.current += 1;
        setLoops(loopsRef.current);
      }
      timer = window.setTimeout(() => { void tick(); }, 1_000 / fps);
    }

    void tick();
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [prepared, phase, fps]);

  async function drawQr(value: string): Promise<void> {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const displayPixels = Math.max(480, Math.min(820, Math.floor(window.innerHeight * 0.76)));
    await QRCode.toCanvas(canvas, value, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: displayPixels,
      color: { dark: "#07110d", light: "#ffffff" },
    });
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
      const encoder = new OpticalTransferEncoder(envelope.bytes);
      const receiver = new URL(`${import.meta.env.BASE_URL}receive.html`, window.location.origin);
      const pairing = pairingUrl(receiver.toString(), envelope.publicKey, envelope.boundary);
      frameRef.current = 0;
      loopsRef.current = 0;
      setFrameNumber(0);
      setLoops(0);
      setPrepared({ envelope, encoder, pairing, originalBytes: candidate.size });
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
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const activeStep = phase === "choose" || phase === "preparing" || phase === "error"
    ? 1
    : phase === "pair"
      ? 2
      : 3;
  const cycleSeconds = prepared ? prepared.encoder.frameCount / fps : 0;

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
          <p className="sender-kicker">LAPTOP → PHONE / MILESTONE 8</p>
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
              {phase === "playing" ? `FRAME ${frameNumber}/${prepared.encoder.frameCount}` : phase.toUpperCase()}
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
            <button onClick={() => { void stageRef.current?.requestFullscreen(); }}>Fullscreen</button>
            <label className="speed-control">
              <span>Speed</span>
              <input
                type="range"
                min="1"
                max="10"
                value={fps}
                onChange={(event) => setFps(Number(event.currentTarget.value))}
              />
              <b>{fps} FPS</b>
            </label>
          </div>

          <div className="transfer-facts">
            <div><span>File</span><strong>{prepared.envelope.filename}</strong><small>{formatBytes(prepared.originalBytes)}</small></div>
            <div><span>Sender fingerprint</span><strong>{prepared.envelope.signerKeyId}</strong><small>Match this on the phone</small></div>
            <div><span>Optical cycle</span><strong>{prepared.encoder.frameCount} frames</strong><small>~{formatDuration(cycleSeconds)} at {fps} FPS · {loops} completed</small></div>
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

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)} sec`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${Math.ceil(seconds % 60)} sec`;
}
