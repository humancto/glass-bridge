# Milestone 15: registered Grid PHY and honest acquisition telemetry

> Milestone 16 implements the first live-acquisition hardening items identified here. See [Milestone 16](milestone-16.md).

Milestone 15 begins the post-QR transport without changing the GlassBridge trust
contract. It also fixes a production/benchmark mismatch found during the channel
audit: the live dual-lane sender rendered v30 and v40 modules materially smaller
than the ideal benchmark rasters.

## What is runnable

The sender now offers **Grid 30 lab**. Pairing v4 binds `mono-grid-v0` and the
selected symbol rate. The sender displays one full-screen 224×112 payload field
with four colored orientation fiducials. The receiver selects the Grid worker
from the paired profile, registers the field from those fiducials, samples the
camera image through a projective mapping, performs interleaved Hamming inner
correction, and sends the recovered AGF2 bytes into the existing LT decoder.

The baseline channel is still available. Dual QR presentation can now use up to
640 pixels per lane and 72% of viewport height, allowing v30 scale 4 and v40
scale 3 on a suitable fullscreen laptop display—the geometry used by the ideal
1280×720 decoder benchmarks.

## Capacity model

Grid v0 carries 2,032 transport-symbol bytes per displayed epoch:

| Target | Pre-loss symbol budget | 144 KiB source lower bound |
| --- | ---: | ---: |
| 10 symbols/s | 19.8 KiB/s | 7.3 s |
| 30 symbols/s | 59.5 KiB/s | 2.4 s |
| 60 symbols/s | 119.1 KiB/s | 1.2 s |

These are not camera results. The completed-file timer, fountain overhead,
acquisition failures, duplicates, verification, and policy path decide real
goodput.

## Measurement changes

Milestone 15 introduced `glassbridge-capacity/4`, which records the bound visual
PHY and target rate, completed decode jobs, symbol-bearing jobs, empty jobs,
optical acquisition percentage, and camera-active time. Milestone 16 supersedes
that success format with `glassbridge-capacity/5`: its headline covers camera
open through verified reconstruction, while the original first-accepted-frame
metric remains available as a solved-channel diagnostic. Like-for-like device
history matches measurement window, profile, visual PHY, target rate, exact
payload, and receiver device. Failed camera runs can export a
`glassbridge-device-run/1` record containing a stable failure class, bound
channel, rank, frame counters, empty acquisition jobs, camera exposure count,
timing, and device identity. A future revision must still add a robust optical
start marker and joined sender-presentation timestamps.

## CPU reference

On the development Mac, `npm run benchmark:grid` measured:

| Operation | Mean | Throughput |
| --- | ---: | ---: |
| Render one 2,032-byte symbol | 0.413 ms | 2,424 symbols/s |
| Register and decode one ideal 1280×720 exposure | 5.07 ms | 197 exposures/s |

This is deliberately a compute reference, not physical-channel evidence. It
shows that a 30/60-exposure camera path is not compute-bound in the ideal case.

## AIRCODE influence and boundary

AIRCODE demonstrates why persistent screen registration, a full-frame cell
field, inner FEC, and channel-aware adaptation are more promising than adding
QR workers. Its 1.069 Mbps number is raw throughput; reported effective goodput
is much lower. GlassBridge therefore gates the work on verified files, not cells
or encoded bits.

GlassBridge does not use AIRCODE's inaudible audio control channel. Pairing and
control metadata remain optical so strict mode stays light-only.

## Next increments

1. Add a synchronized optical start marker and join receiver runs to sender presentation logs.
2. Add blur, perspective, resampling, frame-mixing, and rolling-shutter fixtures.
3. Persist registration across exposures instead of reacquiring four markers.
4. Replace Hamming with interleaved Reed–Solomon stripes and soft confidence.
5. Recover old/new row bands from transition exposures.
6. Move the reference sampler and FEC into shared Rust/WASM.
