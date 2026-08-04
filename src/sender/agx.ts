import { getPublicKeyAsync, signAsync, utils } from "@noble/ed25519";
import { encode } from "cborg";

const MANIFEST_AAD = new TextEncoder().encode("GlassBridge/AGX1/manifest");
const MAX_TEXT_BYTES = 512;

export const MAX_BROWSER_FILE_BYTES = 256 * 1024;

export type BrowserEnvelopeOptions = {
  filename: string;
  mediaType: string;
  boundary: string;
  purpose?: string;
  policyId?: string;
  sequence?: number;
  createdUnix?: number;
  secretKey?: Uint8Array;
  envelopeId?: Uint8Array;
  policyDigest?: Uint8Array;
};

export type BrowserEnvelope = {
  bytes: Uint8Array;
  publicKey: Uint8Array;
  signerKeyId: string;
  envelopeId: string;
  filename: string;
  mediaType: string;
  payloadSha256: string;
  boundary: string;
  purpose: string;
  policyId: string;
  sequence: number;
  createdUnix: number;
};

export async function createBrowserEnvelope(
  payload: Uint8Array,
  options: BrowserEnvelopeOptions,
): Promise<BrowserEnvelope> {
  if (payload.length > MAX_BROWSER_FILE_BYTES) {
    throw new Error(`This browser milestone supports files up to ${formatBytes(MAX_BROWSER_FILE_BYTES)}.`);
  }

  const filename = safeFilename(options.filename);
  const mediaType = options.mediaType || "application/octet-stream";
  const boundary = options.boundary.trim();
  const purpose = options.purpose?.trim() || "ad-hoc-file-transfer";
  const policyId = options.policyId?.trim() || "browser-sender/v1";
  for (const [name, value] of [
    ["filename", filename],
    ["media type", mediaType],
    ["boundary", boundary],
    ["purpose", purpose],
    ["policy id", policyId],
  ] as const) {
    validateText(value, name);
  }

  const createdUnix = options.createdUnix ?? Math.floor(Date.now() / 1_000);
  const sequence = options.sequence ?? createdUnix;
  validateInteger(createdUnix, "creation time");
  validateInteger(sequence, "sequence");

  const secretKey = options.secretKey?.slice() ?? utils.randomSecretKey();
  if (secretKey.length !== 32) {
    throw new Error("The Ed25519 secret key must be 32 bytes.");
  }
  const publicKey = await getPublicKeyAsync(secretKey);
  const signerKeyIdBytes = (await sha256(publicKey)).slice(0, 8);
  const envelopeId = options.envelopeId?.slice() ?? randomBytes(16);
  if (envelopeId.length !== 16) {
    throw new Error("The AGX envelope identifier must be 16 bytes.");
  }

  const payloadDigest = await sha256(payload);
  const policyDigest = options.policyDigest?.slice() ?? await defaultPolicyDigest(
    policyId,
    boundary,
    purpose,
  );
  if (policyDigest.length !== 32) {
    throw new Error("The AGX policy digest must be 32 bytes.");
  }

  const object = new Map<number, unknown>([
    [1, 1],
    [2, filename],
    [3, mediaType],
    [4, payload.length],
    [5, payloadDigest],
  ]);
  const manifest = new Map<number, unknown>([
    [1, 1],
    [2, envelopeId],
    [3, boundary],
    [4, 1],
    [5, purpose],
    [6, policyId],
    [7, policyDigest],
    [8, sequence],
    [9, createdUnix],
    [10, [object]],
  ]);
  const manifestBytes = encode(manifest);
  const protectedBytes = encode(new Map<number, unknown>([
    [1, -8],
    [4, signerKeyIdBytes],
  ]));
  const signatureMessage = encode([
    "Signature1",
    protectedBytes,
    MANIFEST_AAD,
    manifestBytes,
  ]);
  let signature: Uint8Array;
  try {
    signature = await signAsync(signatureMessage, secretKey);
  } finally {
    secretKey.fill(0);
  }

  const coseBytes = encode([
    protectedBytes,
    new Map<number, never>(),
    manifestBytes,
    signature,
  ]);
  const envelopeBytes = encode(new Map<number, unknown>([
    [1, "AGX1"],
    [2, coseBytes],
    [3, payload],
  ]));

  return {
    bytes: envelopeBytes,
    publicKey,
    signerKeyId: toHex(signerKeyIdBytes),
    envelopeId: toHex(envelopeId),
    filename,
    mediaType,
    payloadSha256: toHex(payloadDigest),
    boundary,
    purpose,
    policyId,
    sequence,
    createdUnix,
  };
}

async function defaultPolicyDigest(
  policyId: string,
  boundary: string,
  purpose: string,
): Promise<Uint8Array> {
  return sha256(encode(new Map<number, unknown>([
    [1, 1],
    [2, policyId],
    [3, boundary],
    [4, purpose],
    [5, MAX_BROWSER_FILE_BYTES],
  ])));
}

function safeFilename(value: string): string {
  const basename = value.replaceAll("\\", "/").split("/").at(-1) ?? "";
  const sanitized = basename.replace(/[^A-Za-z0-9._ -]/gu, "_").replace(/^\.+/u, "");
  return sanitized.length > 0 ? sanitized.slice(0, 160) : "glassbridge-transfer.bin";
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

function validateInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${name} is outside the supported integer range.`);
  }
}

function randomBytes(length: number): Uint8Array {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Secure browser randomness is unavailable.");
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Cryptographic signing requires a secure browser context.");
  }
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1024)} KiB`;
}
