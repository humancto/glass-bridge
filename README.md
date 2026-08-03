# GlassBridge / AGX

GlassBridge is a research project exploring fast, verifiable optical data exchange across air-gapped boundaries. Its central proposal is **AGX**: a signed, policy-bound transfer envelope that remains independent of the visual codec used to carry it.

> **Project status:** runnable milestone 4 / pre-alpha. The repository now contains a signed AGX envelope, local default-deny policy and replay state, bounded one-way repair transport, real binary QR PNG encoding/decoding, an H.264 file-video harness with raw benchmark records, quarantine/import workflow, signed receipts, and deterministic golden vectors. It does **not** yet capture a display through a physical camera and must not be used as a production security control.

## See it work

With Rust 1.91.1 installed:

```bash
cargo run --locked -p glassbridge-cli -- demo
```

The command creates fresh sender and receiver keys, binds a local policy into the manifest, signs a sample payload, drops and corrupts frames, reconstructs the envelope, verifies its signature and digest, produces a default-deny policy decision, places it in quarantine, imports it under a generated safe name, records replay state, and verifies the receiver's signed receipt.

A successful run ends with output similar to:

```text
GlassBridge milestone demo: PASS
  frames dropped:      20
  frames corrupted:    5 (rejected by CRC: 5)
  decoder rank:        21/21
  signature + digest:  VERIFIED
  policy decision:     GB-ALLOW
  signed receipt:      ...receipt.cose (imported)
```

To see actual QR images carry a signed envelope through loss and corruption:

```bash
cargo run --locked -p glassbridge-cli -- qr-loopback \
  --envelope artifact.agx \
  --output recovered.agx \
  --frames-dir qr-frames
```

The resulting directory contains real, individually decodable PNG frames. With FFmpeg installed, the same frames can cross an actual H.264 encode/decode boundary:

```bash
cargo run --locked -p glassbridge-cli -- video-loopback \
  --envelope artifact.agx \
  --public-key sender.public \
  --boundary lab/firmware-in \
  --output-dir video-run \
  --frames 40 --fps 30 --crf 32 --scale-percent 75 \
  --session-id 474c4153534252494447454d3444454d
```

This writes `channel.mp4`, the extracted frames, `recovered.agx`, and a raw `benchmark.json`. See [Milestone 1](docs/milestone-1.md), [Milestone 2](docs/milestone-2.md), [Milestone 3](docs/milestone-3.md), and [Milestone 4](docs/milestone-4.md) for implemented properties and explicit limitations. Protocol snapshots are documented in [AGX-0001](spec/AGX-0001.md), [POLICY-0001](spec/POLICY-0001.md), [AGX-OT-0001](spec/AGX-OT-0001.md), [BENCH-0001](spec/BENCH-0001.md), and [CDDL](spec/agx1.cddl).

## Why GlassBridge

Animated QR transfer, fountain coding, and high-density visual channels already have substantial prior art. GlassBridge focuses on the layer above transport:

- cryptographic provenance and authorization;
- default-deny boundary policy;
- bounded quarantine and explicit import;
- honest one-way operating modes;
- typed audit receipts; and
- verified goodput rather than nominal optical throughput.

## Review the research design

The repository currently ships a polished, source-backed design review covering the product vision, threat model, security architecture, AGX envelope, transport roadmap, benchmarks, research hypotheses, prior art, risks, and implementation backlog.

[Open the self-contained research document](research/GlassBridge_AGX_PRD.html). It can be downloaded and reviewed locally without installing dependencies or running a server.

Run it locally:

```bash
npm install
npm run dev
```

Then open the local URL printed by the development server.

Validate the production build and document checks:

```bash
npm test
```

## Current vertical slice

The current Rust prototype demonstrates:

```text
file -> canonical AGX envelope -> signature -> one-way repair frames
     -> QR PNG codec -> H.264 file video -> reconstruction -> verification
     -> policy -> quarantine -> import -> replay state -> audit receipt
```

The QR codec now renders and decodes real binary PNG images, and the file-video harness measures a reproducible H.264 boundary. Display animation and physical camera capture remain future work. Claims in the research document remain proposals or hypotheses unless specifically identified as implemented and measured.

Useful commands:

```bash
# Generate sender keys
cargo run --locked -p glassbridge-cli -- keygen \
  --secret sender.secret --public sender.public

# Create and verify an AGX envelope
cargo run --locked -p glassbridge-cli -- pack \
  --input artifact.bin --output artifact.agx \
  --secret-key sender.secret \
  --boundary lab/firmware-in \
  --purpose firmware-update \
  --policy-file policy.json

cargo run --locked -p glassbridge-cli -- verify \
  --envelope artifact.agx --public-key sender.public \
  --boundary lab/firmware-in

# Export inspectable QR images, then decode them independently
cargo run --locked -p glassbridge-cli -- qr-export \
  --envelope artifact.agx --output-dir qr-frames

cargo run --locked -p glassbridge-cli -- qr-decode \
  --input-dir qr-frames --output recovered.agx
```

`policy.json` is bounded, rejects unknown fields, and must allow the key identifier printed by `keygen`. A complete example is available at [test-vectors/agx1/policy.json](test-vectors/agx1/policy.json).

## What is not implemented yet

- display animation, camera capture, or measured physical optical transfer
- a production LT/RaptorQ implementation or adaptive transport controller
- multi-role trust-bundle rotation, threshold authorization, or concurrent policy-state locking
- malware scanning or content disarm and reconstruction
- encryption, macOS GUI, hardware direction enforcement, or certification
- stable wire-format/API compatibility guarantees

## Project principles

1. Treat optical frames as hostile input.
2. Authenticate intent early and expose payload bytes late.
3. Keep transport, trust, policy, and import semantics separate.
4. Bound parsing, storage, time, and decompression resources.
5. Never claim that emission proves reception or import.
6. Publish raw benchmark data and failure cases alongside results.

## Repository status and licensing

The project is being prepared for open-source implementation. A code and documentation license has not yet been selected; until one is added, normal copyright restrictions apply. The prior-art and IPR discussion in the design is not legal advice or a freedom-to-operate opinion.

See [SECURITY.md](SECURITY.md) before evaluating or building security-sensitive functionality, and [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes.
