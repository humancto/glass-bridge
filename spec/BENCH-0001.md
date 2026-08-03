# BENCH-0001: benchmark record snapshot

Status: experimental snapshot for GlassBridge milestone 4. These records are
for reproducible engineering evidence, not a physical-channel performance
claim.

## Purpose

Every benchmark run should preserve the inputs needed to understand what was
measured and prevent nominal frame rate from being reported as useful transfer
speed. The current `glassbridge-benchmark/1` JSON record describes a successful
H.264 file-video loopback.

## Required identity

A record includes:

- schema and outcome status;
- channel type (`h264-file-loopback` in this snapshot);
- creation time, host OS, and host architecture;
- complete first-line FFmpeg version;
- visual codec identifier and QR error-correction level; and
- a deterministic optical session ID when supplied by the test protocol.

Repository commit, compiler version, CPU model, display, camera, lighting, and
physical geometry are not yet captured. Those fields become mandatory before a
screen/camera experiment is publishable.

## Configuration

The configuration object records symbol size, requested frame budget, session
ID, QR module scale, nominal FPS, H.264 CRF, video downscale percentage, frame
loss/corruption/duplication percentages, and channel PRNG seed. A comparison is
valid only when all non-independent variables are fixed or reported.

## Outcome counts

The record separates:

- source symbols from emitted repair frames;
- emitted, delivered, dropped, corrupted, and duplicated transport frames;
- source PNGs, H.264-extracted PNGs, decoded QR frames, and QR rejects;
- transport-accepted frames from CRC rejects; and
- decoder rank from required source symbols.

The envelope result must report byte equality. Cryptographic verification is
`verified` only when the caller supplies the expected Ed25519 public key and
boundary and normal AGX verification passes; otherwise it is `not-requested`.

## Time and goodput

All timing fields are integer milliseconds:

- QR render time;
- H.264 encode time;
- H.264 extraction time;
- QR decode plus repair-recovery time;
- total local harness processing time;
- nominal duration of all emitted channel frames; and
- duration of the delivered frames encoded into the MP4.

The metrics intentionally remain distinct:

- `harness_processing_bytes_per_second` divides recovered envelope bytes by
  local offline processing time. It measures this implementation and host, not
  channel capacity.
- `recovered_channel_goodput_bytes_per_second` divides recovered envelope bytes
  by the nominal duration of **all emitted frames**, including simulated losses.
- `verified_channel_goodput_bytes_per_second` is present only after successful
  AGX signature/digest verification.

None of these fields is physical optical goodput. A physical result requires
real-time display emission, camera timestamps, capture format, device identity,
geometry, lighting, raw failures, and end-to-end verification.

## Current limitations

The current command writes `benchmark.json` after successful reconstruction.
Failed runs retain their generated artifacts and return a non-zero error, but a
structured failure record is not yet emitted. Publication campaigns must add
failure records, immutable run IDs, environment manifests, repeated trials,
and raw aggregate datasets before making comparative claims.
