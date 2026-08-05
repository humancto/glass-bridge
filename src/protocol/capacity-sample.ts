export function createCapacitySampleBytes(length = 144 * 1_024): Uint8Array {
  if (!Number.isSafeInteger(length) || length <= 0 || length > 2 * 1024 * 1024) {
    throw new Error("Capacity sample length is outside the browser benchmark limit.");
  }
  let state = 0x6d2b_79f5;
  return Uint8Array.from({ length }, () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state & 0xff;
  });
}
