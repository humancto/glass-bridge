# AGX-OT-0001: optical transport frame snapshot

Status: experimental snapshot for GlassBridge milestone 3. This format is not
stable and is not yet suitable for independent production implementations.

## Scope

AGX-OT carries an opaque AGX envelope over a one-way, erasure-prone visual
channel. Envelope trust, policy, quarantine, and import remain outside this
transport layer. This snapshot defines one binary frame and the boundary
between transport and visual codecs.

The sender requires no acknowledgment. Receivers may begin at any point, reject
bad frames independently, and reconstruct once they collect sufficient
independent symbols.

## Binary frame

All integers are unsigned and use network byte order (big endian).

| Offset | Bytes | Field | Constraint |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII `AGF1` |
| 4 | 16 | session ID | random per optical transmission |
| 20 | 4 | symbol ID | systematic or repair-symbol index |
| 24 | 4 | source count | `1..=1024` |
| 28 | 4 | symbol size | `1..=65536` at the transport layer |
| 32 | 8 | payload length | bounded by the AGX implementation |
| 40 | symbol size | symbol bytes | zero padded before coding |
| 40 + symbol size | 4 | CRC-32 | IEEE CRC-32 over every preceding frame byte |

The implementation accepts at most 8,192 frames in one decode call. Every
frame in one reconstruction set must agree on session ID, source count, symbol
size, and payload length. Frames with malformed lengths, invalid limits, or a
bad CRC do not contribute to decoder rank.

## Repair symbols

The current code is a deterministic, fountain-style XOR repair baseline. It is
not a standards-conformant LT or RaptorQ implementation.

Symbol IDs below `source_count` are systematic: their coefficient vector has
only the corresponding source bit set. Later IDs derive a dense binary
coefficient vector from the session ID and symbol ID using the implementation's
versioned SplitMix64 procedure. A receiver performs Gaussian elimination over
GF(2), XORing symbol bytes with the same row operations.

The default emission budget is `3 * source_count + 8` frames. It is deliberately
conservative and exists to prove one-way recovery under erasure. Distribution,
overhead, CPU use, and maximum symbol count must be replaced or justified before
any throughput or production claim.

## Visual codec contract

A visual codec receives exactly one complete AGX-OT frame as opaque bytes and
must return exactly those bytes after decoding. It must not interpret the AGX
envelope, repair coefficients, policy, or receipt semantics.

The Rust `VisualCodec` interface currently exposes:

- a stable codec identifier;
- one-frame byte-to-artifact encoding; and
- one-artifact-to-frame byte decoding with typed failures.

This separation permits QR, dense color codes, recorded video, and future
screen/camera adapters without changing the signed AGX envelope.

## QR/PNG baseline

Codec identifier: `qr/png-v1`.

- QR byte-mode input with automatic normal QR version selection;
- selectable L, M, Q, or H error correction (M by default);
- four-module QR quiet zone from the encoder;
- integer module scale from 2 through 16 pixels (4 by default);
- grayscale, lossless PNG artifact;
- maximum input frame size of 2,048 bytes;
- maximum PNG size of 8 MiB;
- maximum image dimensions of 2,048 by 2,048 pixels; and
- decoder allocation ceiling of 64 MiB.

The milestone profile uses 512-byte symbols, producing 556-byte AGX-OT frames.
With medium QR error correction these currently select QR version 18 and render
to 388 by 388 pixels at four pixels per module.

`index.json` in an exported frame directory is operator/benchmark metadata. It
is not trusted reconstruction input. The receiver discovers PNG files, decodes
their embedded frame bytes, and relies on the self-describing AGX-OT headers and
CRC checks.

## Security properties and non-properties

This layer detects accidental frame corruption, bounds resource use, and
provides erasure recovery. CRC is not authentication. An attacker may inject,
replay, reorder, duplicate, replace, observe, or jam frames. Security is obtained
only after the complete recovered AGX envelope passes its cryptographic,
boundary, policy, and replay checks.

The PNG test path proves byte-exact visual encoding and decoding. It does not
yet prove screen-to-camera reliability, optical confidentiality, physical
direction enforcement, live frame synchronization, or claimed goodput.

## Compatibility rules

Any incompatible change to magic, field layout, byte order, coefficient
derivation, CRC coverage, limits, or visual artifact semantics requires a new
snapshot identifier and test vectors. Unknown magic fails closed.
