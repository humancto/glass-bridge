import { encode } from "cborg";

export const BROWSER_POLICY_ID = "browser-sender/v1";
export const BROWSER_PURPOSE = "ad-hoc-file-transfer";
export const MAX_BROWSER_FILE_BYTES = 256 * 1024;
export const MAX_TRANSFER_AGE_SECONDS = 24 * 60 * 60;
export const MAX_FUTURE_CLOCK_SKEW_SECONDS = 10 * 60;

export async function browserPolicyDigest(
  policyId: string,
  boundary: string,
  purpose: string,
  mediaType: string,
  signerKeyId: string,
): Promise<Uint8Array> {
  const profile = encode(new Map<number, unknown>([
    [1, 1],
    [2, policyId],
    [3, boundary],
    [4, [1]],
    [5, [purpose]],
    [6, [mediaType]],
    [7, [signerKeyId]],
    [8, MAX_BROWSER_FILE_BYTES],
    [9, 1],
    [10, true],
  ]));
  return sha256(profile);
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Policy verification requires a secure browser context.");
  }
  return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer));
}
