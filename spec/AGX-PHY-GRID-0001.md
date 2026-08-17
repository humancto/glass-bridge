# AGX-PHY-GRID-0001: registered monochrome grid experimental snapshot

Status: experimental, incompatible changes allowed before stabilization.

## Purpose

`mono-grid-v0` is the first post-QR visual PHY for GlassBridge. It carries one
opaque AGF2 transport frame per displayed grid. AGX envelope, bounded packing,
LT reconstruction, signature verification, receiver-local policy, quarantine,
human release, and receipts are unchanged.

This snapshot is intended to answer one question with device evidence: can a
registered full-screen field deliver more verified payload bytes than repeated
QR acquisition on the same laptop/phone pair?

## Pairing

Pairing version 4 binds the transfer session, optical profile, packing mode,
visual PHY identifier, and target symbol rate. Changing the rate invalidates
the displayed pairing state and requires the operator to scan the regenerated
pairing QR. A receiver rejects a PHY/profile or rate/profile mismatch.

## Raster

- visual PHY: `mono-grid-v0`
- full raster: 248×136 cells
- payload field: 224×112 binary cells
- transport symbol: 2,032 bytes
- complete AGF2 frame: 2,076 bytes including its 40-byte header and 4-byte CRC
- four orientation-distinct color fiducials outside the payload field
- data whitening before inner coding
- Hamming(12,8) inner code, interleaved by bit plane
- unused payload cells contain a deterministic checker calibration pattern

The reference sender displays the cell raster through a nearest-neighbor scaled
canvas. The reference receiver locates the four fiducials, estimates a projective
mapping, samples cell centers, derives a black/white threshold from observed
dark and light percentiles, applies inner correction, and returns only a frame
with structural AGF1/AGF2 magic. The existing transport parser still performs
bounded length checks and CRC verification.

## Security and limitations

Every camera frame and decoded bit remains hostile input. Inner correction does
not authenticate content and does not replace the AGF CRC or AGX signature.
Hamming(12,8) can miscorrect multiple errors; the outer CRC must reject those
frames. The colored fiducials are acquisition metadata, not trust anchors.

The implementation does not yet provide persistent tracking, soft decisions,
Reed–Solomon stripes, transition-band recovery, controlled exposure/focus, or a
native luma path. It is not an AIRCODE reproduction and uses no audio channel.
The strict GlassBridge profile remains light-only.

## Evidence gate

Grid v0 does not graduate from `lab` based on nominal bitrate or an ideal raster
benchmark. On an incompressible 144 KiB payload, it must complete and verify at
least 19 of 20 same-condition runs and beat the best QR profile's median verified
goodput by at least 25% on the same device pair. Failures must be retained.
