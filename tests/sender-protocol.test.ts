import { readFile } from "node:fs/promises";
import { decode } from "cborg";
import { describe, expect, it } from "vitest";
import {
  createBrowserEnvelope,
  MAX_BROWSER_FILE_BYTES,
} from "../src/sender/agx";
import { verifyAgxEnvelope } from "../src/receiver/agx";
import { base64UrlEncode, OpticalTransferDecoder } from "../src/receiver/transport";
import { OpticalTransferEncoder, pairingUrl } from "../src/sender/transport";
import { packOpticalPayload, unpackOpticalPayload } from "../src/protocol/optical-payload";

const ROOT = new URL("../", import.meta.url);

describe("browser sender AGX interoperability", () => {
  it("reproduces the committed Rust AGX/1 golden envelope byte-for-byte", async () => {
    const committed = await readHex("test-vectors/agx1/valid-envelope.hex");
    const payload = new Uint8Array(await readFile(new URL("test-vectors/agx1/payload.txt", ROOT)));
    const outer = decodeMap(committed);
    const cose = decodeArray(requireBytes(outer.get(2)));
    const manifest = decodeMap(requireBytes(cose[2]));
    const policyDigest = requireBytes(manifest.get(7));

    const generated = await createBrowserEnvelope(payload, {
      filename: "golden.bin",
      mediaType: "application/octet-stream",
      boundary: "golden-lab/firmware-in",
      purpose: "firmware-update",
      policyId: "golden-firmware-in/v1",
      sequence: 7,
      createdUnix: 1_786_003_200,
      secretKey: new Uint8Array(32).fill(0x11),
      envelopeId: Uint8Array.from({ length: 16 }, (_, index) => index),
      policyDigest,
    });

    expect(generated.bytes).toEqual(committed);
    expect(generated.signerKeyId).toBe("10ba682c8ad13513");
  });

  it("enforces the bounded browser-file profile", async () => {
    await expect(createBrowserEnvelope(
      new Uint8Array(MAX_BROWSER_FILE_BYTES + 1),
      {
        filename: "too-large.bin",
        mediaType: "application/octet-stream",
        boundary: "demo/phone-laptop",
      },
    )).rejects.toThrow("256 KiB");
  });

  it("creates a default-policy envelope accepted by the phone verifier", async () => {
    const payload = new TextEncoder().encode("browser default policy path\n");
    const generated = await createBrowserEnvelope(payload, {
      filename: "default.txt",
      mediaType: "text/plain",
      boundary: "demo/phone-laptop",
    });
    const verified = await verifyAgxEnvelope(generated.bytes, {
      publicKey: generated.publicKey,
      boundary: generated.boundary,
    });

    expect(verified.payload).toEqual(payload);
    expect(verified.signerKeyId).toBe(generated.signerKeyId);
    expect(verified.policyId).toBe("browser-sender/v1");
  });
});

describe("browser sender optical interoperability", () => {
  it("round-trips a compressed signed envelope through AGF2 before verification", async () => {
    const payload = new TextEncoder().encode("attribute,value,source\n".repeat(2_000));
    const generated = await createBrowserEnvelope(payload, {
      filename: "attributes.csv",
      mediaType: "text/csv",
      boundary: "demo/phone-laptop",
    });
    const packed = await packOpticalPayload(generated.bytes);
    expect(packed.encoding).toBe("gzip");
    const encoder = new OpticalTransferEncoder(packed.bytes, {
      sessionId: new Uint8Array(16).fill(4),
      symbolSize: 1_688,
      codec: "lt-v2",
    });
    const decoder = new OpticalTransferDecoder(encoder.sessionId);
    let reconstructed: Uint8Array | undefined;
    for (let symbolId = 0; symbolId < encoder.frameCount && !reconstructed; symbolId += 1) {
      reconstructed = decoder.ingestFrame(encoder.frameBytes(symbolId)).envelope;
    }
    expect(reconstructed).toBeDefined();
    const unpacked = await unpackOpticalPayload(reconstructed!);
    const verified = await verifyAgxEnvelope(unpacked.bytes, {
      publicKey: generated.publicKey,
      boundary: generated.boundary,
    });
    expect(verified.payload).toEqual(payload);
  });

  it("reproduces committed Rust-generated AGF1 frames byte-for-byte", async () => {
    const rustFrames = (await readFile(
      new URL("tests/fixtures/rust-browser-frames.txt", ROOT),
      "utf8",
    )).trim().split("\n");
    const decoder = new OpticalTransferDecoder();
    let reconstructed: Uint8Array | undefined;
    for (const frame of rustFrames) {
      reconstructed = decoder.ingestText(frame).envelope;
    }
    expect(reconstructed).toBeDefined();

    const encoder = new OpticalTransferEncoder(reconstructed!, {
      sessionId: fromHex("474c4153534252494447454d3444454d"),
      symbolSize: 512,
      frameCount: rustFrames.length,
    });
    const browserFrames = rustFrames.map((_, symbolId) => encoder.frameText(symbolId));
    expect(browserFrames).toEqual(rustFrames);
  });

  it("creates a strict receiver pairing URL", () => {
    const sessionId = new Uint8Array(16).fill(9);
    const url = new URL(pairingUrl(
      "https://humancto.github.io/glass-bridge/receive.html",
      new Uint8Array(32).fill(7),
      "demo/phone-laptop",
      sessionId,
      "burst",
      "gzip",
      60,
    ));
    expect(url.origin + url.pathname).toBe(
      "https://humancto.github.io/glass-bridge/receive.html",
    );
    expect(new URLSearchParams(url.hash.slice(1)).get("boundary"))
      .toBe("demo/phone-laptop");
    expect(new URLSearchParams(url.hash.slice(1)).get("v")).toBe("4");
    expect(new URLSearchParams(url.hash.slice(1)).get("session"))
      .toBe(base64UrlEncode(sessionId));
    expect(new URLSearchParams(url.hash.slice(1)).get("profile")).toBe("burst");
    expect(new URLSearchParams(url.hash.slice(1)).get("packing")).toBe("gzip");
    expect(new URLSearchParams(url.hash.slice(1)).get("phy")).toBe("qr-model2-v1");
    expect(new URLSearchParams(url.hash.slice(1)).get("rate")).toBe("60");
  });
});

async function readHex(path: string): Promise<Uint8Array> {
  const value = (await readFile(new URL(path, ROOT), "utf8")).trim();
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function fromHex(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function decodeMap(bytes: Uint8Array): Map<unknown, unknown> {
  const value = decode(bytes, { useMaps: true });
  if (!(value instanceof Map)) throw new Error("fixture is not a CBOR map");
  return value;
}

function decodeArray(bytes: Uint8Array): unknown[] {
  const value = decode(bytes, { useMaps: true });
  if (!Array.isArray(value)) throw new Error("fixture is not a CBOR array");
  return value;
}

function requireBytes(value: unknown): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error("fixture value is not bytes");
  return value;
}
