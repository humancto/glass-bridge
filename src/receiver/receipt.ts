import { encode } from "cborg";
import type { VerifiedTransfer } from "./agx";
import type { TransferProgress } from "./transport";

const RECEIPT_AAD = new TextEncoder().encode("GlassBridge/AGX1/import-receipt");
const DATABASE_NAME = "glassbridge-receiver-v1";
const STORE_NAME = "device-keys";
const RECEIPT_KEY_NAME = "receipt-signing-key-v1";

type StoredReceiptKey = {
  version: 1;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

export type ReceiptSigningMaterial = {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
};

export type BrowserReleaseReceipt = {
  cose: Uint8Array;
  json: string;
  publicKey: Uint8Array;
  receiverKeyId: string;
  observedUnix: number;
};

export async function createBrowserReleaseReceipt(
  transfer: VerifiedTransfer,
  progress: TransferProgress,
  signingMaterial?: ReceiptSigningMaterial,
  observedUnix = Math.floor(Date.now() / 1_000),
): Promise<BrowserReleaseReceipt> {
  const keys = signingMaterial ?? await getOrCreateReceiptKey();
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  if (publicKey.length !== 32) {
    throw new Error("The receiver receipt public key is not a raw Ed25519 key.");
  }
  const receiverKeyIdBytes = (await sha256(publicKey)).slice(0, 8);
  const receiptPayload = encode(new Map<number, unknown>([
    [1, 1],
    [2, "release-authorized"],
    [3, fromHex(transfer.envelopeId, 16, "envelope id")],
    [4, fromHex(transfer.payloadSha256, 32, "payload digest")],
    [5, transfer.boundary],
    [6, transfer.policyId],
    [7, transfer.filename],
    [8, observedUnix],
    [9, receiverKeyIdBytes],
    [10, progress.acceptedFrames],
    [11, progress.rejectedFrames],
  ]));
  const protectedBytes = encode(new Map<number, unknown>([
    [1, -8],
    [4, receiverKeyIdBytes],
  ]));
  const signatureMessage = encode([
    "Signature1",
    protectedBytes,
    RECEIPT_AAD,
    receiptPayload,
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "Ed25519" },
    keys.privateKey,
    signatureMessage,
  ));
  if (signature.length !== 64) {
    throw new Error("The receiver produced an invalid Ed25519 receipt signature.");
  }
  const signatureValid = await crypto.subtle.verify(
    { name: "Ed25519" },
    keys.publicKey,
    signature,
    signatureMessage,
  );
  if (!signatureValid) {
    throw new Error("The stored receiver receipt keys do not form a valid Ed25519 pair.");
  }
  const cose = encode([
    protectedBytes,
    new Map<number, never>(),
    receiptPayload,
    signature,
  ]);
  const receiverKeyId = toHex(receiverKeyIdBytes);
  const json = JSON.stringify({
    schema: "glassbridge/browser-release-receipt/1",
    version: 1,
    event: "release-authorized",
    envelope_id: transfer.envelopeId,
    payload_sha256: transfer.payloadSha256,
    boundary: transfer.boundary,
    policy_id: transfer.policyId,
    released_name: transfer.filename,
    observed_unix: observedUnix,
    receiver_key_id: receiverKeyId,
    accepted_frames: progress.acceptedFrames,
    rejected_frames: progress.rejectedFrames,
    semantics: "Receiver policy authorized browser exposure; this is not proof that another application opened or accepted the file.",
  }, null, 2);

  return { cose, json, publicKey, receiverKeyId, observedUnix };
}

async function getOrCreateReceiptKey(): Promise<ReceiptSigningMaterial> {
  if (!globalThis.indexedDB || !globalThis.crypto?.subtle) {
    throw new Error("Persistent signed receipts require IndexedDB and WebCrypto Ed25519.");
  }
  const database = await openDatabase();
  try {
    const stored = await readStoredKey(database);
    if (stored !== undefined) {
      if (!isStoredReceiptKey(stored)) {
        throw new Error("The stored receiver receipt identity is malformed; refusing to replace it silently.");
      }
      return { privateKey: stored.privateKey, publicKey: stored.publicKey };
    }

    const pair = await crypto.subtle.generateKey(
      { name: "Ed25519" },
      false,
      ["sign", "verify"],
    ) as CryptoKeyPair;
    const value: StoredReceiptKey = {
      version: 1,
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    };
    try {
      await writeStoredKey(database, value);
    } catch (writeError) {
      const existing = await readStoredKey(database);
      if (isStoredReceiptKey(existing)) {
        return { privateKey: existing.privateKey, publicKey: existing.publicKey };
      }
      throw writeError;
    }
    return pair;
  } finally {
    database.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("The receiver identity database could not be opened."));
    request.onblocked = () => reject(new Error("The receiver identity database upgrade is blocked by another tab."));
  });
}

function readStoredKey(database: IDBDatabase): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(RECEIPT_KEY_NAME);
    request.onsuccess = () => resolve(request.result as unknown);
    request.onerror = () => reject(new Error("The receiver receipt identity could not be read."));
  });
}

function writeStoredKey(database: IDBDatabase, value: StoredReceiptKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).add(value, RECEIPT_KEY_NAME);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error("The receiver receipt identity could not be persisted."));
    transaction.onabort = () => reject(new Error("The receiver receipt identity transaction was aborted."));
  });
}

function isStoredReceiptKey(value: unknown): value is StoredReceiptKey {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StoredReceiptKey>;
  return candidate.version === 1 &&
    isEd25519Key(candidate.privateKey, "private", "sign") &&
    isEd25519Key(candidate.publicKey, "public", "verify");
}

function isEd25519Key(
  value: unknown,
  type: KeyType,
  usage: KeyUsage,
): value is CryptoKey {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<CryptoKey>;
  return candidate.type === type &&
    candidate.extractable === (type === "public") &&
    candidate.algorithm?.name === "Ed25519" &&
    Array.isArray(candidate.usages) && candidate.usages.length === 1 && candidate.usages[0] === usage;
}

function fromHex(value: string, length: number, name: string): Uint8Array {
  if (value.length !== length * 2 || !/^[0-9a-f]+$/u.test(value)) {
    throw new Error(`The verified ${name} is invalid.`);
  }
  return Uint8Array.from({ length }, (_, index) => Number.parseInt(value.slice(index * 2, index * 2 + 2), 16));
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer));
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
