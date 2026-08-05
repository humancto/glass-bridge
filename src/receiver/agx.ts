import { verifyAsync } from "@noble/ed25519";
import { decode, encode } from "cborg";
import { OPTICAL_PROFILES, type OpticalProfileId } from "../protocol/optical-profile";
import { base64UrlDecode } from "./transport";

const MANIFEST_AAD = new TextEncoder().encode("GlassBridge/AGX1/manifest");
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_BYTES = 512;

export type BootstrapTrust = {
  publicKey: Uint8Array;
  boundary: string;
  sessionId?: Uint8Array;
  profileId?: OpticalProfileId;
};

export type VerifiedTransfer = {
  payload: Uint8Array;
  filename: string;
  mediaType: string;
  payloadSha256: string;
  signerKeyId: string;
  envelopeId: string;
  boundary: string;
  purpose: string;
  policyId: string;
  policyDigest: string;
  sequence: number;
  createdUnix: number;
};

type DecodedObject = {
  filename: string;
  mediaType: string;
  length: number;
  sha256: Uint8Array;
};

export function parseBootstrapHash(hash: string): BootstrapTrust {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const keys = Array.from(params.keys());
  const version = params.get("v");
  const expectedKeys = version === "2"
    ? new Set(["v", "key", "boundary", "session", "profile"])
    : new Set(["v", "key", "boundary"]);
  if (keys.length !== expectedKeys.size || new Set(keys).size !== keys.length || keys.some((key) => !expectedKeys.has(key))) {
    throw new Error("The pairing QR has unexpected or duplicate fields.");
  }
  if (version !== "1" && version !== "2") {
    throw new Error("Scan the pairing QR displayed by GlassBridge on the laptop.");
  }
  const encodedKey = params.get("key");
  const boundary = params.get("boundary");
  if (!encodedKey || !boundary) {
    throw new Error("The pairing QR is incomplete.");
  }
  const publicKey = base64UrlDecode(encodedKey);
  if (publicKey.length !== 32) {
    throw new Error("The paired Ed25519 public key must be 32 bytes.");
  }
  validateText(boundary, "boundary");
  if (version === "1") {
    return { publicKey, boundary };
  }

  const encodedSession = params.get("session");
  const profileId = params.get("profile");
  if (!encodedSession || !profileId) {
    throw new Error("The pairing QR is missing its transfer session.");
  }
  const sessionId = base64UrlDecode(encodedSession);
  if (sessionId.length !== 16) {
    throw new Error("The paired optical session must be 16 bytes.");
  }
  if (!Object.hasOwn(OPTICAL_PROFILES, profileId)) {
    throw new Error("The pairing QR names an unsupported optical profile.");
  }
  return { publicKey, boundary, sessionId, profileId: profileId as OpticalProfileId };
}

export async function trustFingerprint(trust: BootstrapTrust): Promise<string> {
  return toHex((await sha256(trust.publicKey)).slice(0, 8));
}

export async function verifyAgxEnvelope(
  envelopeBytes: Uint8Array,
  trust: BootstrapTrust,
): Promise<VerifiedTransfer> {
  if (envelopeBytes.length === 0 || envelopeBytes.length > MAX_ENVELOPE_BYTES) {
    throw new Error("AGX envelope exceeds the phone receiver limit.");
  }

  const outer = decodeStrict(envelopeBytes);
  const outerMap = requireMap(outer, [1, 2, 3], "AGX outer envelope");
  if (outerMap.get(1) !== "AGX1") {
    throw new Error("Unsupported AGX envelope magic.");
  }
  const coseBytes = requireBytes(outerMap.get(2), "COSE object");
  const payload = requireBytes(outerMap.get(3), "payload");
  requireCanonical(envelopeBytes, outerMap, "AGX outer envelope");

  const cose = decodeStrict(coseBytes);
  if (!Array.isArray(cose) || cose.length !== 4) {
    throw new Error("Invalid COSE Sign1 structure.");
  }
  requireCanonical(coseBytes, cose, "COSE Sign1 object");
  const protectedBytes = requireBytes(cose[0], "protected COSE header");
  const unprotected = requireMap(cose[1], [], "unprotected COSE header");
  if (unprotected.size !== 0) {
    throw new Error("Unprotected COSE headers are not accepted.");
  }
  const manifestBytes = requireBytes(cose[2], "signed manifest");
  const signature = requireBytes(cose[3], "Ed25519 signature");
  if (signature.length !== 64) {
    throw new Error("Ed25519 signature must be 64 bytes.");
  }

  const protectedHeader = requireMap(
    decodeStrict(protectedBytes),
    [1, 4],
    "protected COSE header",
  );
  requireCanonical(protectedBytes, protectedHeader, "protected COSE header");
  if (protectedHeader.get(1) !== -8) {
    throw new Error("Only COSE EdDSA signatures are accepted.");
  }
  const declaredKeyId = requireBytes(protectedHeader.get(4), "COSE key id");
  const expectedKeyId = (await sha256(trust.publicKey)).slice(0, 8);
  if (!equalBytes(declaredKeyId, expectedKeyId)) {
    throw new Error("The envelope signer does not match the paired sender.");
  }

  const signatureMessage = encode([
    "Signature1",
    protectedBytes,
    MANIFEST_AAD,
    manifestBytes,
  ]);
  const validSignature = await verifyAsync(
    signature,
    signatureMessage,
    trust.publicKey,
    { zip215: false },
  );
  if (!validSignature) {
    throw new Error("AGX signature verification failed.");
  }

  const manifest = requireMap(
    decodeStrict(manifestBytes),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "AGX manifest",
  );
  requireCanonical(manifestBytes, manifest, "AGX manifest");
  if (manifest.get(1) !== 1) {
    throw new Error("Unsupported AGX manifest version.");
  }
  const envelopeId = toHex(requireFixedBytes(manifest.get(2), 16, "envelope id"));
  const boundary = requireText(manifest.get(3), "boundary");
  if (boundary !== trust.boundary) {
    throw new Error(`Envelope targets ${boundary}; this receiver expects ${trust.boundary}.`);
  }
  const direction = requireSafeInteger(manifest.get(4), "direction");
  if (direction !== 1) {
    throw new Error("The phone receiver accepts inbound AGX transfers only.");
  }
  const purpose = requireText(manifest.get(5), "purpose");
  const policyId = requireText(manifest.get(6), "policy id");
  const policyDigest = requireFixedBytes(manifest.get(7), 32, "policy digest");
  const sequence = requireSafeInteger(manifest.get(8), "sequence");
  const createdUnix = requireSafeInteger(manifest.get(9), "creation time");
  const object = decodeObject(manifest.get(10));

  if (object.length !== payload.length) {
    throw new Error("Payload length does not match the signed manifest.");
  }
  const payloadDigest = await sha256(payload);
  if (!equalBytes(payloadDigest, object.sha256)) {
    throw new Error("Payload digest does not match the signed manifest.");
  }

  return {
    payload: payload.slice(),
    filename: safeFilename(object.filename),
    mediaType: object.mediaType,
    payloadSha256: toHex(payloadDigest),
    signerKeyId: toHex(expectedKeyId),
    envelopeId,
    boundary,
    purpose,
    policyId,
    policyDigest: toHex(policyDigest),
    sequence,
    createdUnix,
  };
}

function decodeObject(value: unknown): DecodedObject {
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error("The phone demo accepts exactly one AGX object.");
  }
  const object = requireMap(value[0], [1, 2, 3, 4, 5], "AGX object");
  if (object.get(1) !== 1) {
    throw new Error("The phone demo accepts object id 1 only.");
  }
  return {
    filename: requireText(object.get(2), "display name"),
    mediaType: requireText(object.get(3), "media type"),
    length: requireSafeInteger(object.get(4), "object length"),
    sha256: requireFixedBytes(object.get(5), 32, "object digest"),
  };
}

function decodeStrict(bytes: Uint8Array): unknown {
  try {
    return decode(bytes, {
      strict: true,
      useMaps: true,
      rejectDuplicateMapKeys: true,
      allowIndefinite: false,
      allowUndefined: false,
      allowInfinity: false,
      allowNaN: false,
      allowBigInt: true,
    });
  } catch {
    throw new Error("Malformed or non-deterministic CBOR was rejected.");
  }
}

function requireMap(value: unknown, keys: number[], name: string): Map<unknown, unknown> {
  if (!(value instanceof Map) || value.size !== keys.length) {
    throw new Error(`${name} has an invalid shape.`);
  }
  const actual = Array.from(value.keys());
  if (actual.some((key, index) => key !== keys[index])) {
    throw new Error(`${name} is not in the required deterministic key order.`);
  }
  return value;
}

function requireCanonical(original: Uint8Array, value: unknown, name: string): void {
  if (!equalBytes(original, encode(value))) {
    throw new Error(`${name} is not deterministically encoded.`);
  }
}

function requireBytes(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new Error(`${name} must be a byte string.`);
  }
  return value;
}

function requireFixedBytes(value: unknown, length: number, name: string): Uint8Array {
  const bytes = requireBytes(value, name);
  if (bytes.length !== length) {
    throw new Error(`${name} must be ${length} bytes.`);
  }
  return bytes;
}

function requireText(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} must be text.`);
  }
  validateText(value, name);
  return value;
}

function validateText(value: string, name: string): void {
  if (
    value.length === 0 ||
    new TextEncoder().encode(value).length > MAX_TEXT_BYTES ||
    Array.from(value).some((character) => /\p{Cc}/u.test(character))
  ) {
    throw new Error(`${name} is empty, too long, or contains control characters.`);
  }
}

function requireSafeInteger(value: unknown, name: string): number {
  const numberValue = typeof value === "bigint" ? Number(value) : value;
  if (
    typeof numberValue !== "number" ||
    !Number.isSafeInteger(numberValue) ||
    numberValue < 0
  ) {
    throw new Error(`${name} is outside the supported integer range.`);
  }
  return numberValue;
}

function safeFilename(value: string): string {
  const basename = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const sanitized = basename.replace(/[^A-Za-z0-9._ -]/gu, "_").replace(/^\.+/u, "");
  return sanitized.length > 0 ? sanitized.slice(0, 160) : "glassbridge-download.bin";
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Cryptographic verification requires a secure browser context.");
  }
  const input = bytes.slice().buffer;
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", input));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
