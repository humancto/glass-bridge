# Milestone 16: acquisition-first Grid transport

Milestone 16 fixes the gap between a fast ideal decoder and a slow phone-camera transfer. It does not change the AGX envelope, pairing trust, AGF2 transport frame, LT solver, or one-way security model.

## Root cause

The earlier benchmark started with an already framed, integer-scaled Grid. The live path did substantially more work and gave the camera worse pixels:

- fullscreen included the sender controls instead of only the optical raster;
- CSS fractionally stretched 248×136 logical cells, adding browser and camera resampling;
- every camera exposure copied a full RGBA raster and globally rediscovered all four markers;
- marker candidates were averaged too broadly, so unrelated UI colors could bias registration;
- the receiver reported PHY detections as acquisition rate even when frames were duplicates or failed transport CRC;
- an empty run could continue without a useful diagnosis.

## Sender changes

- Fullscreen targets only the Grid raster.
- Every logical cell is displayed at an integer CSS-pixel multiple.
- Symbol zero is held for 1,000 ms after fullscreen entry and before scheduling begins, giving exposure, focus, and registration time without consuming the systematic prefix.
- Pairing QR sizing is restored when the operator leaves Grid mode.

## Receiver changes

- Colored fiducials are selected as guarded connected components instead of global color averages.
- Geometry is validated before cell sampling.
- Luma thresholds use a fixed histogram rather than allocating and sorting 25,088 samples.
- Sampling radius is derived from observed cell pitch and stays at one center pixel near three pixels per module.
- One Grid worker retains registration, refreshes it periodically, and reacquires after decode failures.
- Camera submissions are media-time aware and target-rate bounded; stale or duplicate callbacks are not decoded.
- Grid uses a full-field 960×540 decode raster instead of 1280×720, reducing RGBA readback from about 221 MB/s to 124 MB/s at 60 exposures/s.
- The receiver allows 20 seconds for initial aiming, then stops after ten seconds without a new CRC-valid unique symbol.
- An absolute 120-second Grid camera-session ceiling bounds a failed lab run without treating a legitimate LT rank plateau as corruption.
- CRC-invalid frames cannot reset the optical-progress watchdog.

## Observable results

Live and exported reports now distinguish:

- camera exposures per second;
- PHY-decoded frames per second;
- accepted unique symbols per second;
- duplicate symbols per second;
- busy drops and rate-limited exposures;
- last Grid outcome, contrast, screen fill, corrected codewords, and registration reuse;
- reconstruction rank and required rank.
- time to first valid symbol and camera-open-to-verified goodput, with transport-only goodput retained as a diagnostic.

This separation is necessary because raw detections are not file goodput.

## Deterministic acquisition gate

Run:

```bash
npm run benchmark:grid-acquisition
```

The gate projects Grid frames through fractional perspective and bilinear resampling, adds brightness loss, moiré, colored UI distractors, and a high-fill one-pixel blur probe, and inserts a rolling-shutter transition tear between stable epochs.

The development-Mac reference run for the built-in 144 KiB payload produced:

| Result | Value |
| --- | ---: |
| Source symbols | 73 |
| Expected LT frames | 102 |
| Grid30 source floor | 2.433 s |
| Grid30 expected LT window | 3.4 s |
| Stable epochs recovered byte-exact | 73 / 73 |
| Stable inner corrections | 0 |
| Decode p50 / p95 | 5.9 / 7.4 ms |
| Torn epochs rejected by transport CRC | 72 / 72 |
| Reconstructed payload | byte-exact |

These are deterministic camera-raster results, not a physical iPhone benchmark.

## Physical acceptance gate

For the current laptop/iPhone pair, the next acceptance target is:

1. built-in 144 KiB payload;
2. Grid 30, sender raster fullscreen, phone landscape;
3. three consecutive verified transfers;
4. median camera-open-to-verified completion under five seconds;
5. no silent run longer than the bounded startup/stall windows and no Grid camera session beyond the absolute lab ceiling;
6. exported success JSON for every completion and failure JSON for every stopped run.

Only physical runs can establish camera goodput. A 60-symbol/s or 1 Mbps-class claim remains blocked until Grid30 is reliable and the same device matrix passes the higher temporal rate.

## Next PHY work

1. Track the screen quadrilateral locally between global reacquisitions instead of merely reusing it.
2. Crop/rectify the registered screen before transferring pixels to the worker.
3. Add temporal pilots and recover stable row bands from rolling-shutter transition exposures.
4. Replace whole-frame Hamming with interleaved Reed–Solomon stripes and soft confidence.
5. Move luma extraction, rectification, and FEC into shared Rust/WASM or a native receiver.
