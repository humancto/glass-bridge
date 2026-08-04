import { getPublicKeyAsync, verifyAsync } from "@noble/ed25519";
import { decode, encode } from "cborg";
import { describe, expect, it } from "vitest";
import { evaluateBrowserPolicy } from "../src/receiver/policy";
import { createBrowserReleaseReceipt } from "../src/receiver/receipt";
import {
  assertFreshTransfer,
  reserveTransferRelease,
  replayLedgerSize,
  type ReplayStorage,
} from "../src/receiver/replay";
import { createBrowserEnvelope } from "../src/sender/agx";
import { verifyAgxEnvelope, type VerifiedTransfer } from "../src/receiver/agx";

const NOW = 1_800_000_000;
const RECEIPT_AAD = new TextEncoder().encode("GlassBridge/AGX1/import-receipt");

describe("phone-side default-deny policy", () => {
  it("matches the Rust browser-profile policy digest vector", async () => {
    const generated = await createBrowserEnvelope(
      new TextEncoder().encode("policy digest vector\n"),
      {
        filename: "policy.txt",
        mediaType: "text/plain",
        boundary: "demo/phone-laptop",
        secretKey: new Uint8Array(32).fill(0x11),
        createdUnix: NOW,
        sequence: NOW,
      },
    );
    const transfer = await verifyAgxEnvelope(generated.bytes, {
      publicKey: generated.publicKey,
      boundary: generated.boundary,
    });
    expect(transfer.signerKeyId).toBe("10ba682c8ad13513");
    expect(transfer.policyDigest)
      .toBe("19d2277fe2724554d6dd9debddc2156d9300060bd8454a35cf4dbafd02540602");
  });

  it("allows the pinned browser profile and denies digest and freshness mismatches", async () => {
    const transfer = await makeTransfer();
    const allowed = await evaluateBrowserPolicy(transfer, NOW);
    expect(allowed).toMatchObject({ allowed: true, code: "GB-ALLOW" });

    await expect(evaluateBrowserPolicy({
      ...transfer,
      policyDigest: "00".repeat(32),
    }, NOW)).resolves.toMatchObject({
      allowed: false,
      code: "GB-DENY-POLICY-DIGEST",
    });
    await expect(evaluateBrowserPolicy({
      ...transfer,
      createdUnix: NOW - 24 * 60 * 60 - 1,
    }, NOW)).resolves.toMatchObject({
      allowed: false,
      code: "GB-DENY-STALE",
    });
  });
});

describe("phone-side replay state", () => {
  it("persists a bounded release reservation and rejects the same envelope", async () => {
    const transfer = await makeTransfer();
    const storage = new MemoryStorage();
    assertFreshTransfer(transfer, storage);
    await reserveTransferRelease(transfer, NOW, storage);
    expect(replayLedgerSize(storage)).toBe(1);
    expect(() => assertFreshTransfer(transfer, storage)).toThrow("GB-DENY-REPLAY");
    await expect(reserveTransferRelease(transfer, NOW, storage)).rejects.toThrow("GB-DENY-REPLAY");
  });

  it("treats persisted state as hostile and fails closed for malformed data", async () => {
    const transfer = await makeTransfer();
    const storage = new MemoryStorage();
    storage.setItem("glassbridge-browser-replay-v1", "{not-json");
    expect(() => assertFreshTransfer(transfer, storage)).toThrow("GB-DENY-STATE");
  });
});

describe("phone-side signed release receipt", () => {
  it("creates a COSE Sign1 receipt whose Ed25519 signature verifies", async () => {
    const transfer = await makeTransfer(new Uint8Array(16).fill(0x33));
    const keys = await deterministicReceiptKeys(new Uint8Array(32).fill(0x22));
    expect(keys.privateKey.extractable).toBe(false);
    const receipt = await createBrowserReleaseReceipt(transfer, {
      rank: 7,
      required: 7,
      acceptedFrames: 9,
      duplicateFrames: 1,
      rejectedFrames: 2,
      complete: true,
    }, keys, NOW);

    const cose = decode(receipt.cose, { strict: true, useMaps: true });
    expect(Array.isArray(cose)).toBe(true);
    const [protectedBytes, unprotected, payload, signature] = cose as unknown[];
    expect(unprotected).toBeInstanceOf(Map);
    expect((unprotected as Map<unknown, unknown>).size).toBe(0);
    const protectedHeaders = decode(protectedBytes as Uint8Array, { useMaps: true }) as Map<number, unknown>;
    expect(protectedHeaders.get(1)).toBe(-8);
    expect(protectedHeaders.get(4)).toEqual((await sha256(receipt.publicKey)).slice(0, 8));

    const signatureMessage = encode([
      "Signature1",
      protectedBytes,
      RECEIPT_AAD,
      payload,
    ]);
    await expect(verifyAsync(
      signature as Uint8Array,
      signatureMessage,
      receipt.publicKey,
      { zip215: false },
    )).resolves.toBe(true);

    const receiptMap = decode(payload as Uint8Array, { useMaps: true }) as Map<number, unknown>;
    expect(receiptMap.get(2)).toBe("release-authorized");
    expect(receiptMap.get(3)).toEqual(fromHex(transfer.envelopeId));
    expect(receiptMap.get(10)).toBe(9);
    expect(receiptMap.get(11)).toBe(2);
    expect(JSON.parse(receipt.json)).toMatchObject({
      schema: "glassbridge/browser-release-receipt/1",
      event: "release-authorized",
      receiver_key_id: receipt.receiverKeyId,
    });
    expect(Buffer.from(receipt.cose).toString("hex")).toBe(
      "844da2012704481325b850c2871916a05894ab0101027272656c656173652d617574686f72697a65640350333333333333333333333333333333330458203f478231750d0eb1cc0fd9185338b23f003ca49c125f876d8d250d3fa4b067fe057164656d6f2f70686f6e652d6c6170746f70067162726f777365722d73656e6465722f7631076c626f756e646172792e747874081a6b49d20009481325b850c28719160a090b0258405f94b5ea03d8f944f2cfb58b38242fc488fadc6dafe35fc6b06672926d823ae4482bb42d6529ef8fcf1891e007d50116f611d2d2eb5629cb0583713e16737106",
    );
    expect(Buffer.from(receipt.publicKey).toString("hex")).toBe(
      "a09aa5f47a6759802ff955f8dc2d2a14a5c99d23be97f864127ff9383455a4f0",
    );
  });
});

async function makeTransfer(envelopeId?: Uint8Array): Promise<VerifiedTransfer> {
  const generated = await createBrowserEnvelope(
    new TextEncoder().encode("phone boundary workflow\n"),
    {
      filename: "boundary.txt",
      mediaType: "text/plain",
      boundary: "demo/phone-laptop",
      secretKey: envelopeId ? new Uint8Array(32).fill(0x11) : undefined,
      envelopeId,
      createdUnix: NOW,
      sequence: NOW,
    },
  );
  return verifyAgxEnvelope(generated.bytes, {
    publicKey: generated.publicKey,
    boundary: generated.boundary,
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

class MemoryStorage implements ReplayStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer));
}

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}
