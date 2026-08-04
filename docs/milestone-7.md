# Milestone 7: live browser receiver

> Historical milestone. The receiver is now paired with the arbitrary-file
> browser sender described in [Milestone 8](milestone-8.md).

Milestone 7 turns the phone from a passive recorder into the endpoint. An
ordinary phone camera now receives the animated QR stream, reconstructs the
signed AGX envelope, verifies it, and saves or shares the recovered file. The
existing recorded-video path remains available for diagnostics and for the
full desktop policy, quarantine, replay, and receipt workflow.

## Show-and-tell

```bash
cargo run --locked -p glassbridge-cli -- screen-demo
open work/phone-demo/player.html
```

1. Scan the displayed pairing QR with the phone's normal camera.
2. Confirm that the 16-character sender fingerprint on the phone matches the
   laptop player, then select **Trust sender & open camera**.
3. Aim the phone at the QR square and select **2 · Start transfer**.
4. Keep the complete white border visible until the phone reports **VERIFIED**.
5. Save or share `phone-camera-demo.txt` from the phone.

The default receiver is
<https://humancto.github.io/glass-bridge/receive.html>. Override it for a
development or independently hosted deployment with `screen-demo
--receiver-url`. Production camera access requires HTTPS; localhost HTTP is
accepted only for development.

## End-to-end architecture

```text
laptop                                     phone
------                                     -----
sample file
  -> canonical AGX/1 + COSE EdDSA
  -> bounded repair symbols
  -> AGF1 binary transport frames
  -> base64url QR text wrapper
  -> animated QR PNGs  ~~ photons ~~>  live camera + ZXing
                                          -> wrapper + CRC validation
                                          -> incremental GF(2) reconstruction
                                          -> strict CBOR/COSE validation
                                          -> Ed25519 verification
                                          -> boundary/length/SHA-256 checks
                                          -> explicit save/share
```

The QR wrapper is `AGF1B64:<unpadded-base64url>`. It lets browser QR decoders
return an exact text value while preserving the existing binary `AGF1`
transport frame. The Rust decoder recognizes both the original binary frames
and wrapped browser frames, so the recorded-video fallback remains compatible.

## Pairing and trust

The bootstrap QR contains only:

- receiver protocol version;
- the sender's 32-byte Ed25519 public key; and
- the expected AGX boundary.

The receiver derives the displayed fingerprint as the first eight bytes of
SHA-256 over the public key, matching the AGX key identifier used by the Rust
core. Fragment data is copied into session storage and removed from the visible
URL after parsing. The user must explicitly trust the sender before camera
access begins.

This is deliberate trust-on-first-use for a physical demonstration. It does
not prove organizational identity. A real deployment must provision and rotate
an offline trust bundle, authenticate bootstrap material through an independent
channel, or use a native managed receiver.

## Receiver verification gates

The phone does not expose a recovered file until every gate succeeds:

1. pairing version, key length, and boundary syntax are valid;
2. every optical frame is bounded, has the expected magic/version, and passes
   CRC-32;
3. session ID, envelope length, source count, and symbol size remain identical
   across the stream;
4. duplicate and rank growth are bounded and reconstruction reaches full rank;
5. outer AGX, COSE protected headers, and manifest use the strict supported
   CBOR profile and round-trip to the same canonical bytes;
6. COSE algorithm is EdDSA, key ID matches the paired key, the unprotected map
   is empty, and Ed25519 verification uses strict non-ZIP-215 semantics;
7. the manifest has the supported version, inbound direction, and exactly one
   bounded object;
8. the signed boundary equals the paired boundary; and
9. payload length and SHA-256 match the signed manifest.

Filename output is reduced to a safe basename. Verification errors fail closed
and do not produce a download.

## Resource limits

The browser transport currently limits an envelope to 2 MiB, symbol size to
2,048 bytes, source symbols to 1,024, and QR frame bytes to the Rust transport
maximum. It rejects mixed streams and bounds remembered duplicates. The demo
profile uses a 2 KiB text payload, 512-byte symbols, 24 repeating frames, QR
error correction level M, four pixels per module, and four frames per second.

These values are conservative proof defaults, not speed results. The next
benchmark gate will vary FPS, symbol size, QR density, display refresh, distance,
angle, glare, focus behavior, phone/browser, and device thermals, then report
verified payload goodput and failure rates rather than nominal QR capacity.

## Offline behavior and one-way claim

The hosted receiver uses HTTPS because mobile browsers expose camera capture
only in secure contexts. Its production service worker caches the built
receiver assets after a successful visit, allowing subsequent offline use on
supporting browsers.

The payload path is one way: laptop display to phone camera. Loading or updating
the web receiver is a separate provisioning path and is not counted as part of
the optical transfer. This software does not disable phone radios, prevent
browser telemetry, enforce hardware directionality, or constitute a certified
data diode.

## Tests and diagnostics

The repository includes:

- a Rust-to-TypeScript AGX golden vector that verifies the same Ed25519 key,
  boundary, manifest, and payload in the browser implementation;
- tamper, wrong-boundary, and malformed-pairing negative cases;
- out-of-order systematic and repair-frame reconstruction;
- duplicate, mixed-session, and CRC-corruption rejection;
- Rust decoding of the browser-safe QR wrapper; and
- a receiver control for decoding saved QR PNGs when live camera behavior needs
  to be separated from protocol behavior.

CI creates a fresh `screen-demo` bundle, decodes every exported QR frame with
the Rust QR path, and byte-compares the reconstructed envelope with the signed
source artifact.

## Explicitly deferred

- full phone-side default-deny policy evaluation, replay persistence,
  quarantine review, approval roles, and signed import receipts;
- enterprise trust provisioning, revocation, multi-role authorization, and key
  rotation;
- encrypted envelopes and metadata-hiding modes;
- isolated native camera/media parsing and browser supply-chain hardening;
- adaptive send profiles or a return control channel;
- malware scanning or content disarm and reconstruction; and
- measured device-matrix results and any production security certification.

## Next device matrix

At minimum, record phone model, OS/browser version, laptop/display model,
resolution, refresh rate, brightness, distance, camera angle, ambient light,
FPS, QR version, symbol size, transfer size, accepted/rejected/duplicate frames,
time to full rank, time to verified file, and final digest result. Publish raw
runs, including failures, before making a speed or reliability claim.
