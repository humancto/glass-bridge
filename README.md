# GlassBridge / AGX

GlassBridge is a research project exploring fast, verifiable optical data exchange across air-gapped boundaries. Its central proposal is **AGX**: a signed, policy-bound transfer envelope that remains independent of the visual codec used to carry it.

> **Project status:** runnable milestone 1 / pre-alpha. The repository now contains a signed AGX envelope, lossy frame-loopback prototype, bounded receiver, quarantine/import workflow, and signed receipts. It does **not** yet use a screen or camera and must not be used as a production security control.

## See it work

With Rust 1.91.1 installed:

```bash
cargo run --locked -p glassbridge-cli -- demo
```

The command creates fresh sender and receiver keys, signs a sample payload, drops and corrupts frames, reconstructs the envelope, verifies its signature and digest, places it in quarantine, imports it under a generated safe name, and verifies the receiver's signed receipt.

A successful run ends with output similar to:

```text
GlassBridge milestone demo: PASS
  frames dropped:      20
  frames corrupted:    5 (rejected by CRC: 5)
  decoder rank:        21/21
  signature + digest:  VERIFIED
  signed receipt:      ...receipt.cose (imported)
```

See [Milestone 1](docs/milestone-1.md) for implemented properties and explicit limitations. The protocol snapshot is documented in [AGX-0001](spec/AGX-0001.md) and [CDDL](spec/agx1.cddl).

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
file -> canonical AGX envelope -> signature -> lossy frame transport
     -> reconstruction -> verification -> quarantine -> audit receipt
```

The optical codec and camera stages are currently represented by a deterministic frame-channel simulator. Claims in the research document remain proposals or hypotheses unless specifically identified as implemented and measured.

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
  --policy firmware-in/v1

cargo run --locked -p glassbridge-cli -- verify \
  --envelope artifact.agx --public-key sender.public \
  --boundary lab/firmware-in
```

## What is not implemented yet

- QR rendering, camera capture, or physical optical transfer
- a production LT/RaptorQ implementation or adaptive transport controller
- the complete policy engine, trust-bundle rotation, or replay database
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
