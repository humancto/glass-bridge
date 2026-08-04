# Milestone 12: dual-lane Burst and optical capacity

Milestone 12 treats a three-minute transfer of a 144 KiB file as a channel
failure, not an acceptable prototype result. It adds a dual-lane mode that
trades some per-symbol density for temporal stability and records the actual
capacity boundaries that guide the next codec.

## What the failed run means

144 KiB in 180 seconds is 819 B/s (0.8 KiB/s). The milestone 11 Turbo channel
budget is 174,000 B/s, so the observed result is about 0.47% of nominal. A
144 KiB payload requires 51 loss-free 2,900-byte source symbols; three minutes
corresponds to only about 0.28 useful source symbols per second. More than 99%
of displayed opportunities are therefore being lost before fountain recovery.

The likely mechanism is not cryptography or QR generation. The production sender
has demonstrated 60 rendered symbols/s and the ideal-raster ZXing benchmark
decodes well above that rate. A phone CMOS sensor and a laptop LCD/OLED refresh
asynchronously and usually scan by rows. A camera exposure can therefore contain
parts of two display frames. FareQR documents this rolling-shutter/inter-frame
mixing failure and explores reconstructing the mixed regions instead of simply
discarding them: [FareQR paper](https://hhannuaa.github.io/papers/sec_fareqr_2020.pdf).

## Implemented Burst path

| Property | Burst value |
|---|---:|
| Visual layout | two side-by-side lanes |
| QR per lane | fixed v30-L, mask 4 |
| AGF2 useful symbol | 1,688 bytes |
| AGF2 wire frame | 1,732 bytes |
| Combined target | 60 symbols/s |
| Per-lane update | 30 symbols/s |
| Raw useful-symbol rate | 101,280 B/s / 98.9 KiB/s |
| 144 KiB payload-only floor | 1.46 seconds |
| Receiver capture | full aspect ratio, bounded to 1280×720 |
| Codes per exposure | up to two |

The sender seeds both lanes, then alternates updates. On a 60 Hz screen, each
individual code remains unchanged for two display refreshes. The phone is held
landscape so the receiver can preserve the full camera field instead of the old
centered square crop. A worker may return both valid codes from one exposure,
and the bounded AGF2 parser ingests each independently.

This layout is informed by the publicly documented alternating-lane approach in
[QRFerry](https://github.com/deedy/qr-data-transfer). GlassBridge copies no code
or assets from that unlicensed repository; see the third-party notices.

## Capacity: ceiling versus useful target

QR v40-L carries at most 2,953 binary bytes. With GlassBridge's 44-byte AGF2
frame overhead, the exact single-symbol maximum is 2,909 useful bytes.

| Channel | Nominal useful rate | 144 KiB floor | Constraint |
|---|---:|---:|---|
| Burst: 2× v30-L, 30/lane | 98.9 KiB/s | 1.46 s | implemented, physical test pending |
| Turbo: v40-L at 60 | 169.9 KiB/s | 0.85 s | implemented, unstable in the reported setup |
| Exact v40-L maximum at 60 | 170.4 KiB/s | 0.85 s | QR-compatible hard ceiling at 60 symbols/s |
| 2× v40-L, 60/lane | 340.9 KiB/s exact maximum / 339.8 KiB/s implemented | 0.42 s | implemented as the Milestone 13 Ceiling Lab; physical test pending |
| 4× v30-L, 30/lane | 197.8 KiB/s | 0.73 s | high acquisition cost and smaller camera modules |

The ceiling for a generic screen-camera channel is not the QR ceiling. It cannot
be stated as one device-independent number without measuring optics, modulation
transfer, exposure, rolling-shutter timing, color noise, and decoder error rate.
Research systems demonstrate the broader space: AIRCODE reports a 1,069 Kbit/s
data rate at 5% BER using a custom visual channel plus an inaudible audio control
channel ([USENIX NSDI 2021](https://www.usenix.org/conference/nsdi21/presentation/qian)).
That result establishes that custom screen-camera modulation can exceed ordinary
animated QR, but its audio backchannel is outside GlassBridge's strict light-only
one-way threat model.

## Roadmap beyond Burst

1. **Physical Burst gate.** A stationary 144 KiB run must complete in under five
   seconds on the reference phone/laptop pair. Record camera FPS, valid codes/s,
   p50/p95 decode time, busy drops, accepted/duplicate/rejected frames, and
   verified goodput. Failure is evidence, not a reason to relabel nominal rate.
2. **Mixed-frame recovery.** Add a transition border and recover stable regions
   from rolling-shutter mixtures instead of asking ZXing to reject the exposure.
3. **Per-refresh dual lane.** Milestone 13 can update both lanes on each 60 Hz
   refresh for 120 combined symbols/s and reports any missed display work. A
   120 Hz display remains a future temporal-stability option.
4. **Custom monochrome codec.** Remove repeated QR finder/ECC overhead, use fixed
   screen registration plus lightweight per-frame checks, and leave erasure
   recovery to the stream fountain code.
5. **Color as an opt-in codec.** Calibrated 4/8-color cells can carry multiple
   bits per spatial cell, but require per-device color characterization and must
   fail closed under channel crossover.

Automatic receiver-to-sender rate feedback is not part of strict one-way mode:
even a small optical ACK is a reverse channel across the boundary. A future
managed bidirectional mode may expose signed, schema-limited link telemetry, but
it must be a separately declared security profile.

## Verification

```bash
npm test
npm run benchmark:burst-decode
npm run benchmark:turbo-decode
cargo test --workspace --all-targets --all-features --locked
```

The pixel integration suite places two independent v30-L AGF2 wire frames in one
1280×720 exposure and requires the production ZXing-WASM options to recover both
byte-for-byte. The synthetic benchmark is a decoder CPU regression signal only;
the phone-camera result remains the release gate.
