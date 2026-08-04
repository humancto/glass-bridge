import type { IScannerControls } from "@zxing/browser";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseBootstrapHash,
  trustFingerprint,
  verifyAgxEnvelope,
  type BootstrapTrust,
  type VerifiedTransfer,
} from "./agx";
import {
  base64UrlDecode,
  base64UrlEncode,
  OpticalTransferDecoder,
  type TransferProgress,
} from "./transport";

type Stage = "unpaired" | "paired" | "scanning" | "verifying" | "verified" | "error";
type SourceMode = "camera" | "files";

const SESSION_TRUST_KEY = "glassbridge-demo-trust-v1";
const EMPTY_PROGRESS: TransferProgress = {
  rank: 0,
  required: 0,
  acceptedFrames: 0,
  duplicateFrames: 0,
  rejectedFrames: 0,
  complete: false,
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
        }),
      );
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      return { trust };
    }
    const stored = window.sessionStorage.getItem(SESSION_TRUST_KEY);
    if (!stored) {
      return {};
    }
    const value = JSON.parse(stored) as { key?: unknown; boundary?: unknown };
    if (typeof value.key !== "string" || typeof value.boundary !== "string") {
      throw new Error("Stored pairing is invalid.");
    }
    return {
      trust: parseBootstrapHash(
        `#v=1&key=${encodeURIComponent(value.key)}&boundary=${encodeURIComponent(value.boundary)}`,
      ),
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
  const [saveStatus, setSaveStatus] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<IScannerControls | undefined>(undefined);
  const decoderRef = useRef(new OpticalTransferDecoder());
  const verifyingRef = useRef(false);

  useEffect(() => {
    if (!trust) {
      return;
    }
    void trustFingerprint(trust)
      .then(setFingerprint)
      .catch(() => setFingerprint("unavailable"));
  }, [trust]);

  useEffect(() => () => controlsRef.current?.stop(), []);

  async function finishEnvelope(
    envelope: Uint8Array,
    callbackControls?: IScannerControls,
  ): Promise<void> {
    if (!trust || verifyingRef.current) {
      return;
    }
    verifyingRef.current = true;
    callbackControls?.stop();
    setStage("verifying");
    try {
      const transfer = await verifyAgxEnvelope(envelope, trust);
      setVerified(transfer);
      setStage("verified");
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
    setVerified(undefined);
    setProgress(EMPTY_PROGRESS);
    setError("");
    setSaveStatus("");
    setSourceMode("camera");
    setStage("scanning");

    try {
      const { BrowserQRCodeReader } = await import("@zxing/browser");
      const reader = new BrowserQRCodeReader(undefined, {
        delayBetweenScanAttempts: 45,
        delayBetweenScanSuccess: 20,
        tryPlayVideoTimeout: 5_000,
      });
      const controls = await reader.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1_280 },
            height: { ideal: 720 },
          },
        },
        videoRef.current,
        (result, _scanError, callbackControls) => {
          if (!result || verifyingRef.current) {
            return;
          }
          const next = decoderRef.current.ingestText(result.getText());
          setProgress(next);
          if (!next.envelope) {
            return;
          }
          void finishEnvelope(next.envelope, callbackControls);
        },
      );
      controlsRef.current = controls;
    } catch (cameraError) {
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
    setProgress(EMPTY_PROGRESS);
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
          const next = decoderRef.current.ingestText(result.getText());
          setProgress(next);
          if (next.envelope) {
            await finishEnvelope(next.envelope);
            return;
          }
        } catch {
          setProgress(decoderRef.current.ingestText("invalid-frame"));
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

  function clearPairing(): void {
    controlsRef.current?.stop();
    window.sessionStorage.removeItem(SESSION_TRUST_KEY);
    window.location.reload();
  }

  async function saveFile(): Promise<void> {
    if (!verified) {
      return;
    }
    const file = new File([verified.payload.slice().buffer], verified.filename, {
      type: verified.mediaType,
    });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: "Verified GlassBridge transfer",
          text: `Verified signer ${verified.signerKeyId}`,
        });
        setSaveStatus("Share sheet opened for the verified file.");
        return;
      } catch (shareError) {
        if (shareError instanceof DOMException && shareError.name === "AbortError") {
          setSaveStatus("Save cancelled; the verified file remains available.");
          return;
        }
      }
    }

    try {
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = verified.filename;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setSaveStatus("Download started.");
    } catch {
      setSaveStatus("The browser could not save the file. Try Share again.");
    }
  }

  const percent = progress.required > 0
    ? Math.min(100, Math.round((progress.rank / progress.required) * 100))
    : 0;

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
              <strong>{stage === "scanning" ? `${progress.rank} / ${progress.required || "—"} independent symbols` : stage === "verifying" ? "Envelope reconstructed" : "Key is not trusted until you continue"}</strong>
            </div>
            <div className="progress-track"><span style={{ width: `${stage === "verifying" ? 100 : percent}%` }}></span></div>
            <div className="frame-stats"><span>{progress.acceptedFrames} accepted</span><span>{progress.duplicateFrames} duplicates</span><span>{progress.rejectedFrames} rejected</span></div>
          </div>

          {stage === "paired" ? (
            <>
              <button className="receiver-button primary" type="button" onClick={() => void startCamera()}>
                Trust sender &amp; open camera
              </button>
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

      {stage === "verified" && verified && (
        <section className="receiver-panel verified-panel">
          <div className="verified-mark">✓</div>
          <p className="receiver-kicker">CRYPTOGRAPHIC VERIFICATION / PASS</p>
          <h1>Verified. Ready to save.</h1>
          <p>The file stayed quarantined in memory until the signature, boundary, length, and SHA-256 digest all passed.</p>
          <dl className="verified-details">
            <div><dt>File</dt><dd>{verified.filename}</dd></div>
            <div><dt>Size</dt><dd>{verified.payload.length.toLocaleString()} bytes</dd></div>
            <div><dt>Signer</dt><dd>{verified.signerKeyId}</dd></div>
            <div><dt>Boundary</dt><dd>{verified.boundary}</dd></div>
            <div><dt>Purpose</dt><dd>{verified.purpose}</dd></div>
            <div><dt>SHA-256</dt><dd>{verified.payloadSha256}</dd></div>
          </dl>
          <button className="receiver-button primary save-button" type="button" onClick={() => void saveFile()}>
            Save / Share verified file
          </button>
          {saveStatus && <p className="save-status" role="status">{saveStatus}</p>}
          <button className="receiver-button secondary" type="button" onClick={() => void startCamera()}>Receive again</button>
          <button className="text-button" type="button" onClick={clearPairing}>Forget this pairing</button>
        </section>
      )}

      {stage === "error" && (
        <section className="receiver-panel error-panel" role="alert">
          <div className="error-mark">!</div>
          <p className="receiver-kicker">FAIL CLOSED</p>
          <h1>Nothing was imported.</h1>
          <p>{error}</p>
          {trust ? (
            <button className="receiver-button primary" type="button" onClick={() => void startCamera()}>Try camera again</button>
          ) : (
            <button className="receiver-button secondary" type="button" onClick={clearPairing}>Scan a new pairing QR</button>
          )}
          <button className="text-button" type="button" onClick={clearPairing}>Clear pairing state</button>
        </section>
      )}

      <footer className="receiver-footer">
        <span>Payload path: screen → camera</span>
        <span>Receiver page: HTTPS + offline cache</span>
        <span>Research prototype · not a certified data diode</span>
      </footer>
    </main>
  );
}
