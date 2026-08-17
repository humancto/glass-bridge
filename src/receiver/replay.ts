import type { VerifiedTransfer } from "./agx";

const REPLAY_LEDGER_KEY = "glassbridge-browser-replay-v1";
const MAX_REPLAY_ENTRIES = 256;

export type ReplayEntry = {
  envelopeId: string;
  signerKeyId: string;
  releasedUnix: number;
};

type ReplayLedger = {
  version: 1;
  entries: ReplayEntry[];
};

export type ReplayStorage = Pick<Storage, "getItem" | "setItem">;

export function assertFreshTransfer(
  transfer: VerifiedTransfer,
  storage: ReplayStorage = window.localStorage,
): void {
  const ledger = readLedger(storage);
  if (ledger.entries.some((entry) => entry.envelopeId === transfer.envelopeId)) {
    throw new Error("GB-DENY-REPLAY: this signed envelope was already released on this receiver.");
  }
}

export async function reserveTransferRelease(
  transfer: VerifiedTransfer,
  releasedUnix: number,
  storage: ReplayStorage = window.localStorage,
  useNavigatorLock = true,
): Promise<void> {
  const commit = (): void => {
    const ledger = readLedger(storage);
    if (ledger.entries.some((entry) => entry.envelopeId === transfer.envelopeId)) {
      throw new Error("GB-DENY-REPLAY: this signed envelope was already released on this receiver.");
    }
    if (ledger.entries.length >= MAX_REPLAY_ENTRIES) {
      throw new Error("GB-DENY-STATE-FULL: the replay ledger is full; refusing to forget an older release silently.");
    }
    const entries = [
      ...ledger.entries,
      { envelopeId: transfer.envelopeId, signerKeyId: transfer.signerKeyId, releasedUnix },
    ];
    storage.setItem(REPLAY_LEDGER_KEY, JSON.stringify({ version: 1, entries } satisfies ReplayLedger));
  };

  if (useNavigatorLock && navigator.locks) {
    await navigator.locks.request(REPLAY_LEDGER_KEY, { mode: "exclusive" }, commit);
  } else {
    commit();
  }
}

export function replayLedgerSize(storage: ReplayStorage = window.localStorage): number {
  return readLedger(storage).entries.length;
}

function readLedger(storage: ReplayStorage): ReplayLedger {
  const raw = storage.getItem(REPLAY_LEDGER_KEY);
  if (raw === null) {
    return { version: 1, entries: [] };
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("GB-DENY-STATE: the local replay ledger is malformed.");
  }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw new Error("GB-DENY-STATE: the local replay ledger has an unsupported shape.");
  }
  if (Object.keys(value).some((key) => key !== "version" && key !== "entries")) {
    throw new Error("GB-DENY-STATE: the local replay ledger contains unknown fields.");
  }
  if (value.entries.length > MAX_REPLAY_ENTRIES) {
    throw new Error("GB-DENY-STATE: the local replay ledger exceeds its configured limit.");
  }
  const entries = value.entries.map(parseEntry);
  if (new Set(entries.map((entry) => entry.envelopeId)).size !== entries.length) {
    throw new Error("GB-DENY-STATE: the local replay ledger contains duplicate envelope identifiers.");
  }
  return { version: 1, entries };
}

function parseEntry(value: unknown): ReplayEntry {
  if (!isRecord(value) || Object.keys(value).length !== 3) {
    throw new Error("GB-DENY-STATE: a local replay entry is malformed.");
  }
  const { envelopeId, signerKeyId, releasedUnix } = value;
  if (
    typeof envelopeId !== "string" || !/^[0-9a-f]{32}$/u.test(envelopeId) ||
    typeof signerKeyId !== "string" || !/^[0-9a-f]{16}$/u.test(signerKeyId) ||
    typeof releasedUnix !== "number" || !Number.isSafeInteger(releasedUnix) || releasedUnix < 0
  ) {
    throw new Error("GB-DENY-STATE: a local replay entry failed validation.");
  }
  return { envelopeId, signerKeyId, releasedUnix };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
