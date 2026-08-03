# Milestone 3: real QR image transport

Milestone 3 replaces the simulated visual-codec boundary with real, binary-safe
QR PNG generation and decoding. It proves the following path without weakening
the signed-envelope or default-deny receiver contracts:

```text
signed AGX envelope -> XOR repair frames -> loss/corruption/duplication
                    -> QR PNG images -> QR image decoder -> CRC/rank recovery
                    -> byte-identical signed AGX envelope
```

## See it work

First create a signed envelope with `demo`, `pack`, or the published vectors.
Then run:

```bash
cargo run --locked -p glassbridge-cli -- qr-loopback \
  --envelope artifact.agx \
  --output recovered.agx \
  --frames-dir qr-frames

cmp artifact.agx recovered.agx
```

The command deliberately drops, corrupts, duplicates, and reorders transport
frames before rendering the surviving byte sequences as QR images. Every PNG is
decoded through the independent QR scanner, frame CRC failures are discarded,
and fountain-style rank recovery reconstructs the envelope.

The milestone evidence run used a 10,429-byte signed AGX envelope and reported:

```text
QR OPTICAL LOOPBACK: PASS
  source symbols:     21
  frames emitted:     71
  frames dropped:     16
  frames corrupted:   2
  frames duplicated:  3
  QR images decoded:  58
  decoder rank:       21/21
  CRC frames rejected:3
```

The extra CRC rejection is an expected duplicate of a corrupted frame. The
recovered envelope matched the sender envelope byte-for-byte.

## Separate export and receive steps

For inspectable artifacts rather than a combined loopback:

```bash
cargo run --locked -p glassbridge-cli -- qr-export \
  --envelope artifact.agx --output-dir qr-frames

cargo run --locked -p glassbridge-cli -- qr-decode \
  --input-dir qr-frames --output recovered.agx
```

The export directory contains sequential PNG frames and a non-authoritative
`index.json` recording codec parameters, dimensions, symbol counts, and total
artifact bytes. Decode uses only PNG-embedded AGX-OT frames, not the index.

## Implemented controls

- A dedicated `agx-visual` crate separates codec work from envelope and policy
  semantics.
- `VisualCodec` is byte-preserving and codec-independent.
- QR encoding uses arbitrary byte payloads rather than text/base64 expansion.
- PNG decode is bounded by input bytes, dimensions, allocation, and file count.
- Images with zero or multiple decodable QR codes fail as individual frames.
- AGX-OT CRC and mixed-session checks remain after QR decode.
- Cross-crate tests include loss, corruption, duplication, QR render/decode,
  rank recovery, and byte equality.

The serialized frame and codec snapshot is [AGX-OT-0001](../spec/AGX-OT-0001.md).

## Remaining limitations

- PNG files stand in for display refresh and camera capture.
- There is no live animation scheduler, AVFoundation capture, exposure/focus
  control, or optical frame timing.
- The XOR repair code is a bounded research baseline, not LT or RaptorQ.
- There are no beacons, multi-session discovery, capabilities, or adaptive
  feedback yet.
- The evidence above is functional correctness, not a throughput benchmark.
- QR dependency behavior has not yet been fuzzed or independently audited.

The next milestone is a reproducible video/camera harness: emit an ordered frame
sequence, apply measured blur/skew/glare/frame-loss transformations, decode from
recorded video, and publish raw verified-goodput results before attempting live
adaptive transport.
