# Milestone 4: H.264 file-video harness

Milestone 4 proves that the QR transport survives a lossy video codec and
records the result in machine-readable form. It is the controlled step between
static PNG correctness and live screen/camera measurement.

## See it work

Install FFmpeg, create a signed AGX envelope, then run:

```bash
cargo run --locked -p glassbridge-cli -- video-loopback \
  --envelope artifact.agx \
  --public-key sender.public \
  --boundary lab/firmware-in \
  --output-dir video-run \
  --symbol-size 512 \
  --frames 40 \
  --session-id 474c4153534252494447454d3444454d \
  --fps 30 \
  --crf 32 \
  --scale-percent 75 \
  --loss 15
```

The command creates:

- `source-frames/`: actual binary QR PNGs after deterministic frame loss;
- `channel.mp4`: H.264 video encoded by the reported FFmpeg version;
- `extracted-frames/`: PNGs decoded from the compressed video;
- `recovered.agx`: byte-identical reconstructed envelope; and
- `benchmark.json`: raw configuration, counts, timing, goodput, and verification
  status.

No shell is used to invoke FFmpeg. Arguments are passed directly, standard
input is disabled, output files may not pre-exist, the video output is capped at
512 MiB, and extraction is capped to the expected frame count.

## Evidence run

A fixed session and channel seed carried a fresh 10,429-byte signed envelope
through 75% downscaling and H.264 CRF 32:

```text
H.264 VIDEO LOOPBACK: PASS
  frames emitted:     40
  frames dropped:     7
  extracted/decoded:  33/23
  decoder rank:       21/21
  signature + digest: VERIFIED
  channel goodput:    7823 bytes/s at 30 fps (file-video only)
```

Ten of 33 extracted frames were not decodable as QR, yet the one-way repair
stream still reached full rank. The goodput denominator includes all 40 emitted
frame intervals, not only the 33 frames delivered to the MP4.

This is functional and reproducibility evidence. It is not a claim of 7,823
bytes/s through a monitor and camera.

## Test coverage

- CLI configuration bounds for FPS, CRF, scaling, and verification inputs;
- deterministic channel-duration and integer-goodput calculations;
- the existing arbitrary-binary QR, malformed-image, resource-limit, and
  loss/corruption/rank test suites; and
- a small FFmpeg video loopback in GitHub Actions in addition to local runs.

The record semantics are defined in [BENCH-0001](../spec/BENCH-0001.md).

## Next gate

Milestone 5 should ingest a prerecorded camera file rather than a video created
inside the same command. It should add structured failure records, a frozen
device/environment manifest, repeated-trial aggregation, and the first macOS
AVFoundation capture probe before any live-goodput optimization.
