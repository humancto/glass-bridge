import { describe, expect, it } from "vitest";
import { packOpticalPayload, unpackOpticalPayload } from "../src/protocol/optical-payload";
import { createCapacitySampleBytes } from "../src/protocol/capacity-sample";

describe("adaptive optical payload packing", () => {
  it("compresses repetitive signed-envelope bytes and restores them exactly", async () => {
    const payload = new TextEncoder().encode("attribute,value,source\n".repeat(6_000));
    const packed = await packOpticalPayload(payload);
    expect(packed.encoding).toBe("gzip");
    expect(packed.transmittedBytes).toBeLessThan(payload.length / 10);

    const unpacked = await unpackOpticalPayload(packed.bytes);
    expect(unpacked.encoding).toBe("gzip");
    expect(unpacked.originalBytes).toBe(payload.length);
    expect(unpacked.bytes).toEqual(payload);
  });

  it("keeps incompressible data in the compatibility identity path", async () => {
    let state = 0x1234_5678;
    const payload = Uint8Array.from({ length: 32 * 1_024 }, () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state & 0xff;
    });
    const packed = await packOpticalPayload(payload);
    expect(packed.encoding).toBe("identity");
    expect(packed.bytes).toEqual(payload);
    expect((await unpackOpticalPayload(packed.bytes)).bytes).toEqual(payload);
  });

  it("keeps the built-in 144 KiB capacity fixture on the identity path", async () => {
    const payload = createCapacitySampleBytes();
    const packed = await packOpticalPayload(payload);
    expect(payload).toHaveLength(144 * 1_024);
    expect(packed.encoding).toBe("identity");
    expect(packed.transmittedBytes).toBe(payload.length);
  });

  it("falls back to identity for an incompressible payload at the browser size limit", async () => {
    let state = 0x9e37_79b9;
    const payload = Uint8Array.from({ length: 2 * 1_024 * 1_024 }, () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state & 0xff;
    });
    const packed = await packOpticalPayload(payload);
    expect(packed.encoding).toBe("identity");
    expect(packed.bytes).toEqual(payload);
  });

  it("rejects a compressed object whose declared output is smaller than reality", async () => {
    const payload = new TextEncoder().encode("bounded optical payload ".repeat(1_000));
    const packed = await packOpticalPayload(payload);
    expect(packed.encoding).toBe("gzip");
    const malformed = packed.bytes.slice();
    new DataView(malformed.buffer).setUint32(8, 16, false);
    await expect(unpackOpticalPayload(malformed)).rejects.toThrow(/declared limit/);
  });
});
