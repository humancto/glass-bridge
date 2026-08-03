# GlassBridge / AGX

GlassBridge is a research project exploring fast, verifiable optical data exchange across air-gapped boundaries. Its central proposal is **AGX**: a signed, policy-bound transfer envelope that remains independent of the visual codec used to carry it.

> **Project status:** public design baseline / pre-alpha. This repository currently contains the product and research definition site. It does **not** yet contain a working optical transfer implementation and must not be used as a security control.

## Why GlassBridge

Animated QR transfer, fountain coding, and high-density visual channels already have substantial prior art. GlassBridge focuses on the layer above transport:

- cryptographic provenance and authorization;
- default-deny boundary policy;
- bounded quarantine and explicit import;
- honest one-way operating modes;
- typed audit receipts; and
- verified goodput rather than nominal optical throughput.

## Review the design

The repository currently ships a polished, source-backed design review covering the product vision, threat model, security architecture, AGX envelope, transport roadmap, benchmarks, research hypotheses, prior art, risks, and implementation backlog.

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

## Intended implementation

The first working release will be a Rust-first vertical slice that demonstrates:

```text
file -> canonical AGX envelope -> signature -> lossy frame transport
     -> reconstruction -> verification -> quarantine -> audit receipt
```

Claims in the design are proposals or research hypotheses until backed by code, test vectors, and reproducible measurements.

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
