import { parseBootstrapHash, type BootstrapTrust } from "./agx";
import { base64UrlEncode } from "./transport";

type PairingVersion = BootstrapTrust["pairingVersion"];

const STORED_FIELDS: Record<PairingVersion, readonly string[]> = {
  "1": ["pairingVersion", "key", "boundary"],
  "2": ["pairingVersion", "key", "boundary", "session", "profile"],
  "3": ["pairingVersion", "key", "boundary", "session", "profile", "packing"],
  "4": ["pairingVersion", "key", "boundary", "session", "profile", "packing", "phy", "rate"],
};

export function serializeStoredPairing(trust: BootstrapTrust): string {
  const common = {
    pairingVersion: trust.pairingVersion,
    key: base64UrlEncode(trust.publicKey),
    boundary: trust.boundary,
  };
  switch (trust.pairingVersion) {
    case "1":
      return JSON.stringify(common);
    case "2":
      return JSON.stringify({
        ...common,
        session: base64UrlEncode(requireTrustField(trust.sessionId, "session")),
        profile: requireTrustField(trust.profileId, "profile"),
      });
    case "3":
      return JSON.stringify({
        ...common,
        session: base64UrlEncode(requireTrustField(trust.sessionId, "session")),
        profile: requireTrustField(trust.profileId, "profile"),
        packing: requireTrustField(trust.packing, "packing"),
      });
    case "4":
      return JSON.stringify({
        ...common,
        session: base64UrlEncode(requireTrustField(trust.sessionId, "session")),
        profile: requireTrustField(trust.profileId, "profile"),
        packing: requireTrustField(trust.packing, "packing"),
        phy: requireTrustField(trust.visualPhy, "phy"),
        rate: requireTrustField(trust.targetSymbolRate, "rate"),
      });
  }
}

export function parseStoredPairing(serialized: string): BootstrapTrust {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw invalidStoredPairing("the saved data is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw invalidStoredPairing("the saved data must be an object");
  }

  const pairingVersion = parsed.pairingVersion;
  if (!isPairingVersion(pairingVersion)) {
    throw invalidStoredPairing("the pairing version is missing or unsupported");
  }
  const expectedFields = STORED_FIELDS[pairingVersion];
  const actualFields = Object.keys(parsed);
  if (
    actualFields.length !== expectedFields.length ||
    actualFields.some((field) => !expectedFields.includes(field))
  ) {
    throw invalidStoredPairing(`version ${pairingVersion} has missing or unexpected fields`);
  }

  const params = new URLSearchParams({
    v: pairingVersion,
    key: requireStoredString(parsed, "key"),
    boundary: requireStoredString(parsed, "boundary"),
  });
  if (pairingVersion !== "1") {
    params.set("session", requireStoredString(parsed, "session"));
    params.set("profile", requireStoredString(parsed, "profile"));
  }
  if (pairingVersion === "3" || pairingVersion === "4") {
    params.set("packing", requireStoredString(parsed, "packing"));
  }
  if (pairingVersion === "4") {
    params.set("phy", requireStoredString(parsed, "phy"));
    params.set("rate", String(requireStoredInteger(parsed, "rate")));
  }

  let trust: BootstrapTrust;
  try {
    trust = parseBootstrapHash(`#${params.toString()}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "the saved fields are invalid";
    throw invalidStoredPairing(reason);
  }
  if (serializeStoredPairing(trust) !== serialized) {
    throw invalidStoredPairing("the saved data is not in the canonical GlassBridge form");
  }
  return trust;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPairingVersion(value: unknown): value is PairingVersion {
  return value === "1" || value === "2" || value === "3" || value === "4";
}

function requireStoredString(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== "string") {
    throw invalidStoredPairing(`${field} must be a string`);
  }
  return candidate;
}

function requireStoredInteger(value: Record<string, unknown>, field: string): number {
  const candidate = value[field];
  if (!Number.isSafeInteger(candidate)) {
    throw invalidStoredPairing(`${field} must be a safe integer`);
  }
  return candidate as number;
}

function requireTrustField<T>(value: T | undefined, field: string): T {
  if (value === undefined) {
    throw new Error(`Pairing version requires ${field}.`);
  }
  return value;
}

function invalidStoredPairing(reason: string): Error {
  return new Error(`Stored pairing is invalid: ${reason}. Scan the pairing QR again.`);
}
