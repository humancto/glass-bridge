import {
  BROWSER_POLICY_ID,
  BROWSER_PURPOSE,
  browserPolicyDigest,
  MAX_BROWSER_FILE_BYTES,
  MAX_FUTURE_CLOCK_SKEW_SECONDS,
  MAX_TRANSFER_AGE_SECONDS,
} from "../protocol/browser-profile";
import type { VerifiedTransfer } from "./agx";

export type LocalPolicyDecision = {
  allowed: boolean;
  code: string;
  reason: string;
  evaluatedUnix: number;
  expectedPolicyDigest: string;
};

export async function evaluateBrowserPolicy(
  transfer: VerifiedTransfer,
  evaluatedUnix = Math.floor(Date.now() / 1_000),
): Promise<LocalPolicyDecision> {
  if (!Number.isSafeInteger(evaluatedUnix) || evaluatedUnix < 0) {
    throw new Error("The receiver clock is outside the supported range.");
  }
  const expectedPolicyDigest = toHex(await browserPolicyDigest(
    BROWSER_POLICY_ID,
    transfer.boundary,
    BROWSER_PURPOSE,
    transfer.mediaType,
    transfer.signerKeyId,
  ));
  const decision = (code: string, reason: string, allowed = false): LocalPolicyDecision => ({
    allowed,
    code,
    reason,
    evaluatedUnix,
    expectedPolicyDigest,
  });

  if (transfer.policyId !== BROWSER_POLICY_ID) {
    return decision("GB-DENY-POLICY-ID", "The signed policy identifier is not installed on this receiver.");
  }
  if (transfer.policyDigest !== expectedPolicyDigest) {
    return decision("GB-DENY-POLICY-DIGEST", "The signed policy profile does not match the receiver's local profile.");
  }
  if (transfer.purpose !== BROWSER_PURPOSE) {
    return decision("GB-DENY-PURPOSE", "The declared transfer purpose is not allowed by the local profile.");
  }
  if (transfer.payload.length > MAX_BROWSER_FILE_BYTES) {
    return decision("GB-DENY-SIZE", "The verified payload exceeds the local browser-profile limit.");
  }
  if (transfer.sequence < 1) {
    return decision("GB-DENY-SEQUENCE-FLOOR", "The signed sequence is below the local policy floor.");
  }
  if (transfer.createdUnix > evaluatedUnix + MAX_FUTURE_CLOCK_SKEW_SECONDS) {
    return decision("GB-DENY-FUTURE", "The signed creation time is too far ahead of the receiver clock.");
  }
  if (evaluatedUnix - transfer.createdUnix > MAX_TRANSFER_AGE_SECONDS) {
    return decision("GB-DENY-STALE", "The signed transfer is older than the local 24-hour acceptance window.");
  }

  return decision(
    "GB-ALLOW",
    "Signature, boundary, policy profile, purpose, size, and freshness checks passed.",
    true,
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
