/**
 * Sparse LT fountain primitives for the AGF2 optical wire format.
 *
 * The robust-soliton construction and deterministic logarithm are adapted from
 * Decimen Optical Transfer's MIT-licensed fountain implementation. GlassBridge
 * adds a systematic prefix and derives the seed from its 128-bit session ID.
 * See THIRD_PARTY_NOTICES.md.
 */

const LN2 = 0.6931471805599453;
const SOLITON_C = 0.1;
const SOLITON_DELTA = 0.5;
const MAX_LT_DEGREE = 128;
const cdfCache = new Map<number, Float64Array>();

export function deterministicLog(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Deterministic logarithm requires a positive finite value.");
  }
  let exponent = 0;
  let mantissa = value;
  while (mantissa >= 1.5) {
    mantissa /= 2;
    exponent += 1;
  }
  while (mantissa < 0.75) {
    mantissa *= 2;
    exponent -= 1;
  }
  const z = (mantissa - 1) / (mantissa + 1);
  const zSquared = z * z;
  let term = z;
  let sum = 0;
  for (let denominator = 1; denominator <= 21; denominator += 2) {
    sum += term / denominator;
    term *= zSquared;
  }
  return exponent * LN2 + 2 * sum;
}

export function robustSolitonCdf(sourceCount: number): Float64Array {
  if (!Number.isSafeInteger(sourceCount) || sourceCount <= 0) {
    throw new Error("LT source count must be a positive safe integer.");
  }
  const cached = cdfCache.get(sourceCount);
  if (cached) return cached;
  const cdf = new Float64Array(sourceCount);
  if (sourceCount === 1) {
    cdf[0] = 1;
    cdfCache.set(sourceCount, cdf);
    return cdf;
  }
  const radius = Math.max(
    1,
    SOLITON_C * deterministicLog(sourceCount / SOLITON_DELTA) * Math.sqrt(sourceCount),
  );
  const spike = Math.min(sourceCount, Math.ceil(sourceCount / radius));
  let total = 0;
  for (let degree = 1; degree <= sourceCount; degree += 1) {
    const ideal = degree === 1 ? 1 / sourceCount : 1 / (degree * (degree - 1));
    let robust = 0;
    if (degree < spike) robust = radius / (degree * sourceCount);
    if (degree === spike) {
      robust = radius * Math.max(0, deterministicLog(radius / SOLITON_DELTA)) / sourceCount;
    }
    total += ideal + robust;
    cdf[degree - 1] = total;
  }
  for (let index = 0; index < sourceCount; index += 1) {
    cdf[index] /= total;
  }
  cdf[sourceCount - 1] = 1;
  cdfCache.set(sourceCount, cdf);
  return cdf;
}

export function expectedLtOverhead(sourceCount: number): number {
  const count = Math.max(1, sourceCount);
  return Math.min(1.6, Math.max(1.15, 1.1 + 2.45 / Math.sqrt(count)));
}

export function expectedLtFrames(sourceCount: number): number {
  return Math.max(sourceCount + 1, Math.ceil(sourceCount * expectedLtOverhead(sourceCount)));
}

export function ltFrameIndices(
  sessionId: Uint8Array,
  symbolId: number,
  sourceCount: number,
): number[] {
  if (sessionId.length !== 16) {
    throw new Error("LT sessions require a 128-bit identifier.");
  }
  if (!Number.isSafeInteger(symbolId) || symbolId < 0 || symbolId > 0xffff_ffff) {
    throw new Error("LT symbol identifier is outside the supported range.");
  }
  if (!Number.isSafeInteger(sourceCount) || sourceCount <= 0) {
    throw new Error("LT source count must be a positive safe integer.");
  }
  if (symbolId < sourceCount) return [symbolId];

  const cdf = robustSolitonCdf(sourceCount);
  const random = splitmix32(frameSeed(sessionSeed(sessionId), symbolId - sourceCount));
  const sample = random() * 2 ** -32;
  let low = 0;
  let high = sourceCount - 1;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (cdf[middle] >= sample) high = middle;
    else low = middle + 1;
  }
  // Bound graph fan-out even when an attacker chooses a session/sequence pair
  // that samples the soliton tail. This keeps hostile-frame memory predictable.
  const degree = Math.min(sourceCount, MAX_LT_DEGREE, low + 1);
  if (degree > sourceCount >> 3) {
    const scratch = new Uint32Array(sourceCount);
    for (let index = 0; index < sourceCount; index += 1) scratch[index] = index;
    const selected = new Array<number>(degree);
    for (let index = 0; index < degree; index += 1) {
      const swapIndex = index + (random() % (sourceCount - index));
      const value = scratch[index];
      scratch[index] = scratch[swapIndex];
      scratch[swapIndex] = value;
      selected[index] = scratch[index];
    }
    return selected;
  }
  const selected = new Set<number>();
  while (selected.size < degree) selected.add(random() % sourceCount);
  return [...selected];
}

function sessionSeed(sessionId: Uint8Array): number {
  let hash = 0x811c_9dc5;
  for (const byte of sessionId) {
    hash ^= byte;
    hash = Math.imul(hash, 0x0100_0193);
  }
  return hash >>> 0;
}

function frameSeed(session: number, sequence: number): number {
  let hash = (Math.imul(session + 1, 0x9e37_79b1) ^ (sequence + 0x85eb_ca6b)) | 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2_ae35);
  return (hash ^ (hash >>> 16)) | 0;
}

function splitmix32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x9e37_79b9) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 16), 0x21f0_aaad);
    value = Math.imul(value ^ (value >>> 15), 0x735a_2d97);
    return (value ^ (value >>> 15)) >>> 0;
  };
}
