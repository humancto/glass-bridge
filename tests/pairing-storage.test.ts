import { describe, expect, it } from "vitest";
import { parseBootstrapHash } from "../src/receiver/agx";
import {
  parseStoredPairing,
  serializeStoredPairing,
} from "../src/receiver/pairing-storage";
import { base64UrlEncode } from "../src/receiver/transport";

const KEY = base64UrlEncode(new Uint8Array(32).fill(7));
const SESSION = base64UrlEncode(new Uint8Array(16).fill(9));

describe("stored receiver pairing", () => {
  it("round-trips version 4 with its exact declared fields", () => {
    const trust = parseBootstrapHash(
      `#v=4&key=${KEY}&boundary=demo&session=${SESSION}&profile=grid&packing=identity&phy=mono-grid-v0&rate=30`,
    );
    const serialized = serializeStoredPairing(trust);

    expect(Object.keys(JSON.parse(serialized))).toEqual([
      "pairingVersion", "key", "boundary", "session", "profile", "packing", "phy", "rate",
    ]);
    expect(parseStoredPairing(serialized)).toEqual(trust);
  });

  it.each([
    ["1", `#v=1&key=${KEY}&boundary=legacy`],
    ["2", `#v=2&key=${KEY}&boundary=legacy&session=${SESSION}&profile=burst`],
    ["3", `#v=3&key=${KEY}&boundary=legacy&session=${SESSION}&profile=ceiling&packing=gzip`],
  ])("round-trips supported legacy version %s without changing its version", (version, hash) => {
    const trust = parseBootstrapHash(hash);
    const restored = parseStoredPairing(serializeStoredPairing(trust));

    expect(restored).toEqual(trust);
    expect(restored.pairingVersion).toBe(version);
  });

  it("rejects missing, malformed, and extra stored fields", () => {
    const valid = JSON.parse(serializeStoredPairing(parseBootstrapHash(
      `#v=4&key=${KEY}&boundary=demo&session=${SESSION}&profile=grid&packing=identity&phy=mono-grid-v0&rate=30`,
    ))) as Record<string, unknown>;

    const missing = { ...valid };
    delete missing.session;
    expect(() => parseStoredPairing(JSON.stringify(missing))).toThrow(/missing or unexpected fields/);

    expect(() => parseStoredPairing(JSON.stringify({ ...valid, rate: "30" }))).toThrow(/safe integer/);
    expect(() => parseStoredPairing(JSON.stringify({ ...valid, debug: true }))).toThrow(/missing or unexpected fields/);
    expect(() => parseStoredPairing("[]")).toThrow(/must be an object/);
    expect(() => parseStoredPairing("not-json")).toThrow(/not valid JSON/);
  });

  it("does not infer a v1-v3 downgrade when any v4 field is deleted", () => {
    const valid = JSON.parse(serializeStoredPairing(parseBootstrapHash(
      `#v=4&key=${KEY}&boundary=demo&session=${SESSION}&profile=grid&packing=identity&phy=mono-grid-v0&rate=30`,
    ))) as Record<string, unknown>;

    for (const field of ["session", "profile", "packing", "phy", "rate"]) {
      const damaged = { ...valid };
      delete damaged[field];
      expect(() => parseStoredPairing(JSON.stringify(damaged)), field).toThrow(/version 4/);
    }
  });

  it("rejects duplicate keys, reordered fields, and non-canonical stored JSON", () => {
    const serialized = serializeStoredPairing(parseBootstrapHash(
      `#v=4&key=${KEY}&boundary=demo&session=${SESSION}&profile=grid&packing=identity&phy=mono-grid-v0&rate=30`,
    ));
    const duplicateKey = serialized.replace(
      `"key":"${KEY}"`,
      `"key":"${KEY}","key":"${KEY}"`,
    );
    expect(() => parseStoredPairing(duplicateKey)).toThrow(/canonical GlassBridge form/);

    const parsed = JSON.parse(serialized) as Record<string, unknown>;
    const reordered = JSON.stringify({ boundary: parsed.boundary, ...parsed });
    expect(() => parseStoredPairing(reordered)).toThrow(/canonical GlassBridge form/);
    expect(() => parseStoredPairing(` ${serialized}`)).toThrow(/canonical GlassBridge form/);
  });
});
