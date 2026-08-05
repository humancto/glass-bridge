# GlassBridge / AGX

GlassBridge is a research project exploring fast, verifiable optical data exchange across air-gapped boundaries. Its central proposal is **AGX**: a signed, policy-bound transfer envelope that remains independent of the visual codec used to carry it.

> **Project status:** runnable milestone 14 / pre-alpha. The repository now contains a no-install browser sender for arbitrary files up to 256 KiB, bounded adaptive gzip optical packing, a measurable 30/60/90/120-code capacity ladder, dual-v30 Burst and dual-v40 Ceiling Lab paths, lane-parallel WASM phone decoding with full-frame reacquisition, exportable pipeline telemetry, sparse LT repair, a live browser receiver with local default-deny policy, memory quarantine, replay detection, explicit release, receiver-signed evidence, canonical signed AGX envelopes, an H.264 benchmark harness, and deterministic Rust/browser interoperability vectors. Physical goodput still requires device-matrix validation. This must not be used as a production security control.

> **Open-source status:** the source is public for review, but no project-wide license has been selected. Until a license is committed, normal copyright restrictions apply. See the [open-source readiness review](docs/open-source-readiness.md) before describing or launching the project as open source.

## Start here

- [Product, threat model, prior art, and research plan](https://humancto.github.io/glass-bridge/)
- [Live laptop sender](https://humancto.github.io/glass-bridge/send.html)
- [Live phone receiver](https://humancto.github.io/glass-bridge/receive.html)
- [Draft launch article: *A File Crossed an Air Gap. The Trust Boundary Came With It.*](docs/launch-article.md)
- [Open-source readiness and flow audit](docs/open-source-readiness.md)
- [Browser security audit](docs/open-source-security-audit.md)

## See it work

With Rust 1.91.1 installed:

### Choose a laptop file and send it to a phone

Open the hosted [GlassBridge file sender](https://humancto.github.io/glass-bridge/send.html)
on the laptop. No installation or command line is required.

1. Choose or drag in one file, select **Try the sample file**, or select **Use 144 KiB capacity test**.
2. Leave **Burst** and **60/s Stable** selected for the first run, keep the default demonstration boundary in place, and select **Prepare secure transfer**. Increase only one capacity step per run.
3. Scan the stationary pairing QR with the phone's normal Camera app.
4. Confirm the sender fingerprint on both devices, then select **Trust sender & open camera** on the phone.
5. Turn the phone landscape. Back on the laptop, select **2 · Start transfer** and keep both QR codes in the GlassBridge camera guide.
6. When the phone reports **QUARANTINED**, review the sender, boundary, policy, and digest.
7. Select **Approve release & create signed receipt**. Only then can the phone save or share the file.
8. Preserve the signed COSE receipt, receipt JSON, and receiver public key with the file.

After reconstruction and cryptographic verification, the phone shows a
**Post-receive analytics** scorecard. It reports verified goodput, elapsed time,
accepted code rate, decoded acceptance, payload efficiency, fountain overhead,
camera/decode diagnostics, and the previous/best like-for-like result. The last
20 runs remain private in that browser for comparison; **Copy benchmark JSON**
and **Save / share benchmark JSON** export a versioned record. Repeat each step
three times. Compare Burst 30/60/90/120 to isolate timing, then compare Burst and
Ceiling Lab at the same rate to isolate QR density. The highest setting is not
automatically the fastest: the device's stable capacity is the last step that
verifies reliably and still improves median goodput.

The laptop browser creates a fresh Ed25519 key for that transfer, builds and signs
a canonical AGX/1 envelope in memory, uses bounded gzip packing only when it
reduces the signed envelope, fountain-encodes the resulting optical object into Rust-compatible
AGF1 or AGF2 frames, and renders the QR stream locally. The file is not uploaded by the
application. The ephemeral key proves integrity for the paired session; it is not
an organizational identity or durable provenance credential.

The current browser profile accepts one file up to 256 KiB. Default Burst emits
1,688-byte AGF2 symbols across two v30-L lanes at 60 combined symbols/s. Each
lane updates at 30/s and stays stable across two refreshes of a 60 Hz display.
Its raw useful-symbol capacity is 101,280 B/s (98.9 KiB/s), giving a 1.46-second
loss-free payload-only lower bound for 144 KiB before the signed envelope and
fountain overhead. Dense Turbo remains available at a nominal 169.9 KiB/s, but
changes its single v40-L code every refresh and is therefore more vulnerable to
rolling-shutter and mixed-frame loss. Both figures are channel budgets, **not
measured physical goodput**.

Milestone 13 extends Burst to a controlled 30/60/90/120 combined-code ladder and
adds **Ceiling Lab**: two v40-L lanes carrying 2,900 useful bytes per code. Its
implemented standards-compatible upper setting is 348,000 B/s (339.8 KiB/s),
with a 0.42-second loss-free payload-only floor for 144 KiB. That is a channel
budget, not a promise. Run `npm run benchmark:capacity` for the ideal-raster
decoder matrix and see [Milestone 13](docs/milestone-13.md) for the experimental
method and stop rules.

Milestone 14 adds two independent optimizations. Adaptive packing can remove
most optical bytes from structured text while preserving the exact signed AGX
object after bounded decompression. Dual-lane camera frames are normally split
into overlapping one-code regions and decoded by independent workers, with a
periodic full-frame pass for off-center recovery. On ideal development rasters,
lane splitting approximately halved v30/v40 acquisition latency. Run
`npm run benchmark:parallel-decode` and see [Milestone 14](docs/milestone-14.md).

The test suite now exercises the dense Turbo path end to end below the physical
camera boundary: it renders 2,944-byte AGF2 frames as v40-L pixels, decodes them
with the same ZXing-C++ WASM settings used by the phone worker (including a
rotated capture), checks exact bytes, and reconstructs a multi-frame payload.
Run `npm run benchmark:turbo-decode` for the repeatable ideal-raster decoder
measurement. It deliberately does not claim phone-camera goodput.

Burst has an additional end-to-end pixel gate: two 1,732-byte wire frames are
rendered side-by-side in one 1280×720 exposure and both must decode byte-for-byte.
Run `npm run benchmark:burst-decode` for its ideal two-code decoder measurement.
See [Milestone 12](docs/milestone-12.md) for the capacity analysis, the reason a
three-minute 144 KiB run indicates greater than 99% optical loss, and the path
beyond standard QR.

### Reproducible CLI-generated phone demo

Build a complete, offline test bundle with one command:

```bash
cargo run --locked -p glassbridge-cli -- screen-demo
open work/phone-demo/player.html
```

The player starts on a standard pairing QR. Then:

1. Scan the pairing QR with the phone's normal camera. It opens the [hosted GlassBridge receiver](https://humancto.github.io/glass-bridge/receive.html) over HTTPS.
2. Confirm that the sender fingerprint shown on the phone matches the fingerprint printed by the laptop player, then select **Trust sender & open camera**.
3. Aim the phone at the whole white QR square and select **2 · Start transfer** on the laptop.
4. When the phone reports **QUARANTINED**, review the verified details, then select **Approve release & create signed receipt** before saving or sharing `phone-camera-demo.txt`.

The receiver reconstructs the fountain-coded stream in memory, rejects malformed
or mixed-session frames, verifies canonical AGX/CBOR and COSE structure, checks the
Ed25519 signature, enforces the paired boundary, and verifies the declared length
and SHA-256. It then recomputes and applies a local policy, denies replayed envelope
identifiers, keeps the payload quarantined in memory until explicit approval, and
creates receiver-signed release evidence before it exposes the file. No app-store
installation is required.

The receiver page itself must be loaded over HTTPS so the phone browser may use the
camera. The signed payload bytes travel only in the animated optical frames. After
the first successful load, the production service worker caches the receiver for
offline reuse. This is a protocol prototype—not a claim that the phone, browser,
or display is a certified one-way device.

If a phone/browser combination cannot scan the stream live, record at least 15
seconds of the QR square, move the `.mov` or `.mp4` back to the laptop, and run the
prepared command in `work/phone-demo/NEXT-STEPS.txt`. That fallback produces the
full desktop policy decision, quarantine/import result, replay state, reception
evidence, and receiver-signed receipt. Its generated receipt key is demo-only and
belongs inside the ignored `work/` directory.

Browser release evidence uses the same receipt signature profile as the Rust
receiver. Verify a downloaded receipt independently with:

```bash
cargo run --locked -p glassbridge-cli -- receipt-verify \
  --receipt glassbridge.receipt.cose \
  --receiver-public-key glassbridge.receiver.public
```

### Deterministic trust-path demo

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

This writes `channel.mp4`, the extracted frames, `recovered.agx`, and a raw `benchmark.json`. A prerecorded camera/video file can then enter the complete receiver workflow:

```bash
cargo run --locked -p glassbridge-cli -- video-receive \
  --video capture.mp4 \
  --output-dir reception-evidence \
  --sender-public-key sender.public \
  --receiver-secret-key receiver.secret \
  --policy-file policy.json \
  --workspace receiver-workspace \
  --boundary lab/firmware-in \
  --approve
```

That path extracts bounded video frames, recovers and verifies the signed AGX envelope, enforces local policy/replay state, imports or quarantines it, emits the receiver's signed receipt, and writes `reception.json`. See [Milestone 1](docs/milestone-1.md), [Milestone 2](docs/milestone-2.md), [Milestone 3](docs/milestone-3.md), [Milestone 4](docs/milestone-4.md), [Milestone 5](docs/milestone-5.md), [Milestone 6](docs/milestone-6.md), [Milestone 7](docs/milestone-7.md), [Milestone 8](docs/milestone-8.md), [Milestone 9](docs/milestone-9.md), [Milestone 10](docs/milestone-10.md), [Milestone 11](docs/milestone-11.md), and [Milestone 12](docs/milestone-12.md) for implemented properties and explicit limitations. Protocol snapshots are documented in [AGX-0001](spec/AGX-0001.md), [POLICY-0001](spec/POLICY-0001.md), [AGX-OT-0001](spec/AGX-OT-0001.md), [BENCH-0001](spec/BENCH-0001.md), [RECEPTION-0001](spec/RECEPTION-0001.md), [BROWSER-RECEIPT-0001](spec/BROWSER-RECEIPT-0001.md), and [CDDL](spec/agx1.cddl).

## Why GlassBridge

Animated QR transfer, fountain coding, and high-density visual channels already have substantial prior art. GlassBridge focuses on the layer above transport:

- cryptographic provenance and authorization;
- default-deny boundary policy;
- bounded quarantine and explicit import;
- honest one-way operating modes;
- typed audit receipts; and
- verified goodput rather than nominal optical throughput.

The current runnable differentiator is the complete crossing state machine:

```text
session-bound signed envelope -> bounded optical reconstruction
  -> signature + boundary + digest verification -> receiver-local policy
  -> memory quarantine -> verified-goodput analytics -> explicit approval
  -> replay reservation -> receiver-signed release evidence -> save/share
```

QRFerry and Decimen establish that optical transport itself can be sophisticated
and fast. GlassBridge asks a different question: can the receiving boundary make
the crossing authenticated, constrained, observable, and auditable without
coupling that security contract to one visual codec? This is a systems research
claim, not yet proof of global novelty.

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
chosen browser file -> canonical AGX envelope -> ephemeral Ed25519 signature
     -> optional bounded gzip optical packing
     -> one-way repair frames generated in the laptop browser
     -> QR PNG codec -> fullscreen display -> live phone camera
     -> browser reconstruction -> bounded unpacking -> signature + boundary + digest verification
     -> local policy -> memory quarantine -> approval -> replay reservation
     -> receiver-signed release receipt -> save/share on phone

fallback: recorded camera video -> desktop verification -> local policy
        -> quarantine/import -> replay state -> signed audit receipt
```

The browser sender renders QR frames directly into a canvas, the Rust CLI can render the same protocol as inspectable PNGs, and the browser receiver scans either stream from a live phone camera without a native application. The phone path now has an explicit policy/quarantine/release boundary and produces a signed `release-authorized` receipt. The file-video harness still provides a reproducible H.264 boundary and a stronger native import workflow. Claims in the research document remain proposals or hypotheses unless specifically identified as implemented and measured.

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

- a native phone application, protected monotonic phone replay state, organizational trust provisioning, or published physical-goodput results
- practical large-file transfer, Brotli/zstd packing, feedback-driven adaptation, or live receiver feedback
- production-grade FEC/RaptorQ or an adaptive transport controller (AGF2 sparse LT is experimental)
- multi-role trust-bundle rotation, threshold authorization, or universally available concurrent policy-state locking
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

The project is being prepared for open-source implementation. A project-wide code and documentation license has not yet been selected; until one is added, normal copyright restrictions apply. Adapted and bundled components retain their licenses and attributions in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The prior-art and IPR discussion in the design is not legal advice or a freedom-to-operate opinion.

See [SECURITY.md](SECURITY.md) before evaluating or building security-sensitive functionality, and [CONTRIBUTING.md](CONTRIBUTING.md) before proposing changes.
