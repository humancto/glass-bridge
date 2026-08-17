import { getPublicKeyAsync, verifyAsync } from "@noble/ed25519";
import { decode, encode } from "cborg";
import { describe, expect, it } from "vitest";
import {
  decodeGridFrame,
  renderGridFrame,
  type GridRegistration,
} from "../src/phy/grid/grid-codec";
import { OPTICAL_PROFILES } from "../src/protocol/optical-profile";
import {
  packOpticalPayload,
  unpackOpticalPayload,
} from "../src/protocol/optical-payload";
import {
  parseBootstrapHash,
  trustFingerprint,
  verifyAgxEnvelope,
} from "../src/receiver/agx";
import { evaluateBrowserPolicy } from "../src/receiver/policy";
import { createBrowserReleaseReceipt } from "../src/receiver/receipt";
import {
  assertFreshTransfer,
  replayLedgerSize,
  reserveTransferRelease,
  type ReplayStorage,
} from "../src/receiver/replay";
import { OpticalTransferDecoder, type IngestResult } from "../src/receiver/transport";
import { createBrowserEnvelope } from "../src/sender/agx";
import { OpticalTransferEncoder, pairingUrl } from "../src/sender/transport";
import { makeCameraScene } from "./fixtures/grid-camera-sim";

const NOW = 1_800_000_000;
const BOUNDARY = "demo/secure-grid-e2e";
const SESSION = Uint8Array.from({ length: 16 }, (_, index) => (index * 23 + 9) & 0xff);
const SENDER_SECRET = new Uint8Array(32).fill(0x31);
const ENVELOPE_ID = new Uint8Array(16).fill(0x42);
const RECEIPT_AAD = new TextEncoder().encode("GlassBridge/AGX1/import-receipt");

describe("secure Grid optical transfer vertical integration", () => {
  it("moves a signed AGX envelope through camera pixels into verified quarantine, then releases only after authorization", async () => {
    const payload = deterministicBytes(7 * 1_024 + 37);
    const generated = await createBrowserEnvelope(payload, {
      filename: "field-update.bin",
      mediaType: "application/octet-stream",
      boundary: BOUNDARY,
      secretKey: SENDER_SECRET,
      envelopeId: ENVELOPE_ID,
      createdUnix: NOW,
      sequence: NOW,
    });
    const packed = await packOpticalPayload(generated.bytes);
    const profile = OPTICAL_PROFILES.grid;
    const encoder = new OpticalTransferEncoder(packed.bytes, {
      sessionId: SESSION,
      symbolSize: profile.symbolSize,
      codec: profile.codec,
    });
    const bootstrapUrl = pairingUrl(
      "https://receiver.example/receive.html",
      generated.publicKey,
      BOUNDARY,
      encoder.sessionId,
      "grid",
      packed.encoding,
      30,
    );
    const trust = parseBootstrapHash(new URL(bootstrapUrl).hash);

    expect(trust).toMatchObject({
      boundary: BOUNDARY,
      profileId: "grid",
      packing: packed.encoding,
      visualPhy: profile.visualPhy,
      targetSymbolRate: 30,
    });
    expect(trust.sessionId).toEqual(SESSION);
    expect(await trustFingerprint(trust)).toBe(generated.signerKeyId);

    const decoder = new OpticalTransferDecoder(trust.sessionId);
    let registration: GridRegistration | undefined;
    let progress: IngestResult | undefined;

    // Establish registration with the valid preamble/source-zero frame.
    ({ progress, registration } = deliverCameraFrame(encoder.frameBytes(0), decoder, registration));
    expect(progress.acceptedFrames).toBe(1);
    expect(progress.rejectedFrames).toBe(0);

    // A camera-readable frame whose transport bytes were corrupted must still
    // fail at AGF2 CRC and must not consume the symbol identifier.
    const corrupt = encoder.frameBytes(1);
    corrupt[64] ^= 0x80;
    const beforeCorruption = progress.acceptedFrames;
    ({ progress, registration } = deliverCameraFrame(corrupt, decoder, registration));
    expect(progress.acceptedFrames).toBe(beforeCorruption);
    expect(progress.rejectedFrames).toBe(1);
    expect(progress.envelope).toBeUndefined();

    // Deliver source frames with source 1 intentionally erased. The receiver
    // must recover it from subsequent LT repair symbols, not retransmission.
    for (let symbolId = 2; symbolId < encoder.sourceCount; symbolId += 1) {
      ({ progress, registration } = deliverCameraFrame(
        encoder.frameBytes(symbolId),
        decoder,
        registration,
      ));
    }
    expect(progress?.complete).toBe(false);

    for (
      let symbolId = encoder.sourceCount;
      !progress?.complete && symbolId < encoder.sourceCount + 64;
      symbolId += 1
    ) {
      ({ progress, registration } = deliverCameraFrame(
        encoder.frameBytes(symbolId),
        decoder,
        registration,
      ));
    }

    expect(progress?.complete).toBe(true);
    expect(progress?.envelope).toBeDefined();
    expect(progress?.acceptedFrames).toBeGreaterThanOrEqual(encoder.sourceCount);
    expect(progress?.rejectedFrames).toBe(1);

    const unpacked = await unpackOpticalPayload(progress!.envelope!, trust.packing);
    const verified = await verifyAgxEnvelope(unpacked.bytes, trust);
    expect(verified.payload).toEqual(payload);
    expect(verified.payloadSha256).toBe(generated.payloadSha256);
    expect(verified.signerKeyId).toBe(generated.signerKeyId);
    expect(verified.envelopeId).toBe(generated.envelopeId);
    expect(verified.boundary).toBe(BOUNDARY);

    const policy = await evaluateBrowserPolicy(verified, NOW);
    expect(policy).toMatchObject({ allowed: true, code: "GB-ALLOW" });

    // This is the pure-function boundary immediately before ReceiverApp sets
    // its React stage to `quarantined`: signature/digest/policy/replay checks
    // passed, but no receipt, replay reservation, File, download, or share has
    // been created. DOM stage rendering and OS file delivery require a browser
    // E2E harness and are deliberately outside this Node integration test.
    const replay = new MemoryStorage();
    assertFreshTransfer(verified, replay);
    expect(replayLedgerSize(replay)).toBe(0);

    // Model the explicit "Approve release" action with the same production
    // receipt and replay primitives used by ReceiverApp.authorizeRelease().
    const receiptKeys = await deterministicReceiptKeys(new Uint8Array(32).fill(0x52));
    const receipt = await createBrowserReleaseReceipt(verified, progress!, receiptKeys, NOW);
    await reserveTransferRelease(verified, receipt.observedUnix, replay);
    expect(replayLedgerSize(replay)).toBe(1);
    expect(() => assertFreshTransfer(verified, replay)).toThrow("GB-DENY-REPLAY");
    await expect(verifyReceipt(receipt.cose, receipt.publicKey)).resolves.toBe(true);
    expect(JSON.parse(receipt.json)).toMatchObject({
      event: "release-authorized",
      envelope_id: generated.envelopeId,
      payload_sha256: generated.payloadSha256,
      accepted_frames: progress!.acceptedFrames,
      rejected_frames: 1,
    });
  }, 60_000);

  it("rejects camera-decoded corruption and a valid frame from the wrong optical session", async () => {
    const payload = deterministicBytes(2_777);
    const expected = new OpticalTransferEncoder(payload, {
      sessionId: SESSION,
      symbolSize: OPTICAL_PROFILES.grid.symbolSize,
      codec: OPTICAL_PROFILES.grid.codec,
    });
    const decoder = new OpticalTransferDecoder(expected.sessionId);

    const corrupt = expected.frameBytes(0);
    corrupt[100] ^= 0x01;
    const corruptResult = deliverCameraFrame(corrupt, decoder).progress;
    expect(corruptResult).toMatchObject({
      acceptedFrames: 0,
      rejectedFrames: 1,
      complete: false,
      rejectionReason: "invalid-frame",
    });
    expect(corruptResult.envelope).toBeUndefined();

    const otherSession = new Uint8Array(16).fill(0xa7);
    const wrong = new OpticalTransferEncoder(payload, {
      sessionId: otherSession,
      symbolSize: OPTICAL_PROFILES.grid.symbolSize,
      codec: OPTICAL_PROFILES.grid.codec,
    });
    const wrongResult = deliverCameraFrame(wrong.frameBytes(0), decoder).progress;
    expect(wrongResult).toMatchObject({
      acceptedFrames: 0,
      rejectedFrames: 2,
      complete: false,
      rejectionReason: "wrong-session",
    });
    expect(wrongResult.envelope).toBeUndefined();
  }, 30_000);

  it("reconstructs but refuses a payload mutation and a sender-signed policy mismatch", async () => {
    const payload = new TextEncoder().encode("signed update payload\n");
    const generated = await createBrowserEnvelope(payload, {
      filename: "update.txt",
      mediaType: "text/plain",
      boundary: BOUNDARY,
      secretKey: SENDER_SECRET,
      envelopeId: new Uint8Array(16).fill(0x63),
      createdUnix: NOW,
      sequence: NOW,
    });
    const trust = {
      publicKey: generated.publicKey,
      boundary: BOUNDARY,
      sessionId: SESSION,
      profileId: "grid" as const,
      packing: "identity" as const,
      visualPhy: OPTICAL_PROFILES.grid.visualPhy,
      targetSymbolRate: 30,
    };

    const tamperedEnvelope = generated.bytes.slice();
    tamperedEnvelope[tamperedEnvelope.length - 1] ^= 0x01;
    const tamperedEncoder = new OpticalTransferEncoder(tamperedEnvelope, {
      sessionId: SESSION,
      symbolSize: OPTICAL_PROFILES.grid.symbolSize,
      codec: OPTICAL_PROFILES.grid.codec,
    });
    const tamperedDecoder = new OpticalTransferDecoder(SESSION);
    const reconstructedTamper = deliverCameraFrame(
      tamperedEncoder.frameBytes(0),
      tamperedDecoder,
    ).progress;
    expect(reconstructedTamper.complete).toBe(true);
    await expect(verifyAgxEnvelope(reconstructedTamper.envelope!, trust)).rejects.toThrow(
      "Payload digest does not match",
    );

    const mismatched = await createBrowserEnvelope(payload, {
      filename: "update.txt",
      mediaType: "text/plain",
      boundary: BOUNDARY,
      secretKey: new Uint8Array(32).fill(0x64),
      envelopeId: new Uint8Array(16).fill(0x65),
      policyDigest: new Uint8Array(32).fill(0),
      createdUnix: NOW,
      sequence: NOW,
    });
    const mismatchSession = new Uint8Array(16).fill(0x66);
    const mismatchEncoder = new OpticalTransferEncoder(mismatched.bytes, {
      sessionId: mismatchSession,
      symbolSize: OPTICAL_PROFILES.grid.symbolSize,
      codec: OPTICAL_PROFILES.grid.codec,
    });
    const mismatchProgress = deliverCameraFrame(
      mismatchEncoder.frameBytes(0),
      new OpticalTransferDecoder(mismatchSession),
    ).progress;
    expect(mismatchProgress.complete).toBe(true);
    const verifiedMismatch = await verifyAgxEnvelope(mismatchProgress.envelope!, {
      publicKey: mismatched.publicKey,
      boundary: BOUNDARY,
    });
    await expect(evaluateBrowserPolicy(verifiedMismatch, NOW)).resolves.toMatchObject({
      allowed: false,
      code: "GB-DENY-POLICY-DIGEST",
    });
    const replay = new MemoryStorage();
    expect(replayLedgerSize(replay)).toBe(0);
  }, 30_000);
});

function deliverCameraFrame(
  frame: Uint8Array,
  decoder: OpticalTransferDecoder,
  registration?: GridRegistration,
): { progress: IngestResult; registration?: GridRegistration } {
  const scene = makeCameraScene(renderGridFrame(frame), {
    brightness: 0.9,
    moireAmplitude: 3,
    distractors: true,
  });
  const attempt = decodeGridFrame(scene, registration);
  expect(attempt.outcome, JSON.stringify(attempt)).toBe("decoded");
  if (attempt.outcome !== "decoded" || !attempt.frame) {
    throw new Error(`Expected a decoded Grid frame, got ${attempt.outcome}.`);
  }
  return {
    progress: decoder.ingestFrame(attempt.frame),
    registration: attempt.registration ?? registration,
  };
}

function deterministicBytes(length: number): Uint8Array {
  let state = 0x6d2b_79f5;
  return Uint8Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  });
}

async function deterministicReceiptKeys(seed: Uint8Array): Promise<CryptoKeyPair> {
  const publicBytes = await getPublicKeyAsync(seed);
  const pkcs8 = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
    0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
    ...seed,
  ]);
  const spki = Uint8Array.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
    0x70, 0x03, 0x21, 0x00, ...publicBytes,
  ]);
  return {
    privateKey: await crypto.subtle.importKey("pkcs8", pkcs8, "Ed25519", false, ["sign"]),
    publicKey: await crypto.subtle.importKey("spki", spki, "Ed25519", true, ["verify"]),
  };
}

async function verifyReceipt(coseBytes: Uint8Array, publicKey: Uint8Array): Promise<boolean> {
  const cose = decode(coseBytes, { strict: true, useMaps: true });
  if (!Array.isArray(cose) || cose.length !== 4) return false;
  const [protectedBytes, , payload, signature] = cose;
  if (
    !(protectedBytes instanceof Uint8Array) ||
    !(payload instanceof Uint8Array) ||
    !(signature instanceof Uint8Array)
  ) return false;
  return verifyAsync(
    signature,
    encode(["Signature1", protectedBytes, RECEIPT_AAD, payload]),
    publicKey,
    { zip215: false },
  );
}

class MemoryStorage implements ReplayStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}
