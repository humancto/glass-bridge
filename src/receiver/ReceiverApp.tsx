import type { IScannerControls } from "@zxing/browser";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  parseBootstrapHash,
  trustFingerprint,
  verifyAgxEnvelope,
  type BootstrapTrust,
  type VerifiedTransfer,
} from "./agx";
import { evaluateBrowserPolicy, type LocalPolicyDecision } from "./policy";
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
  const [policyDecision, setPolicyDecision] = useState<LocalPolicyDecision>();
  const [receipt, setReceipt] = useState<BrowserReleaseReceipt>();
  const [saveStatus, setSaveStatus] = useState("");
  const [sourceMode, setSourceMode] = useState<SourceMode>("camera");
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<IScannerControls | undefined>(undefined);
  const decoderRef = useRef(new OpticalTransferDecoder());
  const verifyingRef = useRef(false);
  const releasingRef = useRef(false);

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
      const decision = await evaluateBrowserPolicy(transfer);
      if (!decision.allowed) {
        throw new Error(`${decision.code}: ${decision.reason}`);
      }
      assertFreshTransfer(transfer);
      setVerified(transfer);
      setPolicyDecision(decision);
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
    setPolicyDecision(undefined);
    setReceipt(undefined);
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
    setSourceMode("camera");
    setStage("paired");
  }

  function clearPairing(): void {
    controlsRef.current?.stop();
    window.sessionStorage.removeItem(SESSION_TRUST_KEY);
    window.location.reload();
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
            <progress
              className="progress-track"
              max="100"
              value={stage === "verifying" ? 100 : percent}
              aria-label="Optical reconstruction progress"
            />
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

      {(stage === "quarantined" || stage === "releasing") && verified && policyDecision && (
        <section className="receiver-panel verified-panel">
          <div className="verified-mark">✓</div>
          <p className="receiver-kicker">VERIFIED QUARANTINE / POLICY {policyDecision.code}</p>
          <h1>Verified. Held for approval.</h1>
          <p>The payload remains in memory and is not exposed as a file until you explicitly authorize release.</p>
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
          {trust ? (
            <button className="receiver-button primary" type="button" onClick={resetToPaired}>Return to paired receiver</button>
          ) : (
            <button className="receiver-button secondary" type="button" onClick={clearPairing}>Scan a new pairing QR</button>
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
