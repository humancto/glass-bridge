# Milestone 8: arbitrary-file browser sender

Milestone 8 removes the prepared-demo-file constraint from the primary
show-and-tell. An ordinary laptop browser can now choose one local file, create
and sign an AGX/1 envelope in memory, encode Rust-compatible optical frames, and
display the pairing and animated-transfer QRs without installing an application.

## Immediate demonstration

On the laptop, open:

```text
https://humancto.github.io/glass-bridge/send.html
```

Then:

1. Choose or drag in a file no larger than 256 KiB, or use the sample.
2. Select **Prepare secure transfer**.
3. Scan the stationary pairing QR with the phone's normal Camera app.
4. Compare the 16-character sender fingerprint on both devices.
5. On the phone, select **Trust sender & open camera** and allow camera access.
6. On the laptop, select **2 · Start transfer**.
7. Keep the complete QR square visible until the phone reports **QUARANTINED**.
8. Review the verified details, approve release, and preserve the signed receipt
   before saving or sharing the file.

The normal phone Camera is used only for pairing. Animated frames must be read
by the camera inside the GlassBridge receiver page.

## Implemented path

```text
laptop browser                                      phone browser

File API
  │
  ├─ SHA-256 payload digest
  ├─ fresh Ed25519 session key
  ├─ deterministic CBOR manifest
  ├─ COSE Sign1 signature
  └─ canonical AGX/1 envelope
          │
          ├─ 512-byte source symbols
          ├─ systematic + deterministic XOR repair symbols
          ├─ AGF1 header + CRC-32
          └─ AGF1B64 browser wrapper
                         ── animated QR / light ──▶ reconstruction
                                                    │
                                                    ├─ paired-key verification
                                                    ├─ boundary verification
                                                    ├─ canonical CBOR/COSE
                                                    ├─ Ed25519 verification
                                                    ├─ length + SHA-256
                                                    └─ save/share
```

No application endpoint receives the file bytes. The hosted static sender code
is downloaded over HTTPS; after that, envelope construction and optical
rendering occur inside the laptop browser. This does not prevent browser
extensions, compromised dependencies, the operating system, or a modified
deployment from observing data.

## Trust semantics

Each prepared transfer creates a new 32-byte Ed25519 secret-key seed with browser
cryptographic randomness. The corresponding public key and boundary are placed
in the pairing URL fragment. The phone displays the first eight bytes of SHA-256
over that public key as the sender fingerprint.

That key is deliberately ephemeral. It proves that the received manifest was
signed by the same key introduced through the pairing QR and that the payload
matches the signed digest. It does **not** prove an operator, organization,
device, software release role, or durable provenance chain. Organizational
trust bundles remain a future milestone.

The sender overwrites its local secret-key byte array after signing. JavaScript
memory management may retain internal copies, so this is hygiene rather than a
hardware-backed zeroization claim.

## Browser profile and limits

| Property | Milestone 8 profile |
| --- | --- |
| Files | Exactly one |
| Maximum selected file | 256 KiB |
| Envelope | AGX/1 deterministic CBOR + COSE Sign1 |
| Signature | Ed25519 |
| Payload integrity | SHA-256 |
| Direction | Inbound to the phone receiver |
| Symbol size | 512 bytes |
| Repair schedule | Systematic symbols, then deterministic SplitMix64 XOR symbols |
| Frames per cycle | `source_count × 3 + 8` |
| Default display rate | 4 FPS, adjustable 1–10 FPS |
| Pairing | HTTPS receiver URL fragment with version, public key, and boundary |
| Persistence | File and signing key are not intentionally persisted |

The 256 KiB ceiling is a usability guardrail. It prevents a user from
accidentally starting a multi-minute dense-QR transfer before adaptive
transport, compression, resume, measured device profiles, and progress
estimates are mature.

## Interoperability gates

The browser implementation is not a parallel protocol:

- browser AGX construction reproduces the committed Rust AGX/1 golden envelope
  byte-for-byte using the same fixed key, envelope identifier, manifest, and
  payload;
- browser optical encoding reproduces five committed Rust-generated `AGF1B64`
  frames byte-for-byte for the same envelope and session identifier;
- the existing browser receiver reconstructs and verifies those frames;
- the production build includes `send.html`, `receive.html`, and the shared
  offline cache; and
- the guided sample path is exercised in a real browser through choose, pair,
  play, pause, and re-pair states with no console errors.

## User-interface safety choices

- Pairing and optical transfer are distinct numbered steps.
- The pairing QR is explicitly labeled **NORMAL CAMERA · SCAN ONCE**.
- Animated playback cannot start until a file has been signed and encoded.
- The sender fingerprint, file name, original byte count, frame count, estimated
  cycle time, FPS, and completed loops remain visible.
- Returning to **1 · Show pairing QR** stops playback and resets the stream.
- The interface says that nothing is uploaded while separately warning that the
  signer is session-only and not an organizational identity.

## Dependency and prior-art note

QR rendering uses the MIT-licensed `qrcode` package. QR rendering, animated
visual transport, fountain/repair coding, Ed25519, CBOR, COSE, and browser file
selection are prior art or standard engineering components. Milestone 8 is an
integration and usability result; it does not create a new novelty claim for
those components.

At the time of milestone 8, the repository had no selected project license;
adding an MIT dependency did not license GlassBridge source code. The project
subsequently adopted Apache-2.0 at the repository level. Third-party components
continue under their own licenses and notices.

## Deferred work

- persistent organizational trust roots and signed role delegation;
- durable native phone policy, protected replay state, crash-safe quarantine, and organizational receipt identity (the browser profile is implemented in [Milestone 9](milestone-9.md));
- compression and content-type-specific preprocessing;
- adaptive symbol size, QR density, error correction, FPS, and camera feedback;
- larger-file UX, resume, chunk commitments, and bounded persistence;
- reverse phone-to-laptop transfer;
- encryption for optical confidentiality;
- native, isolated camera/media processing; and
- published physical goodput and failure-envelope measurements across devices.

## Next benchmark

Measure verified goodput rather than nominal QR payload rate for at least text,
already-compressed binary, and image samples at 1 KiB, 16 KiB, 64 KiB, and
256 KiB. Record laptop/display, phone, browser, distance, angle, brightness,
FPS, source symbols, frames observed, rejected frames, time to full rank,
signature-verification time, quarantine-ready time, and total time through
approved release plus signed-receipt creation. Publish
failed and successful runs.
