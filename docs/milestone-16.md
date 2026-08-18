# Milestone 16: acquisition-path changes for Grid transport

**Updated:** 2026-08-17

**Canonical test status:** this is the current pre-alpha acquisition report and
physical Grid smoke protocol. Milestone 13 remains a historical QR-ladder
snapshot.

Milestone 16 addresses acquisition paths that could explain the gap between a fast ideal decoder and a slow phone-camera transfer. Deterministic raster results validate those paths in simulation; they do not establish physical causality or phone-camera goodput. The milestone does not change the AGX envelope, pairing trust, AGF2 transport frame, LT solver, or one-way security model.

## Acquisition hypotheses

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

- Colored fiducials use the original strict classifier first, followed only when needed by one bounded chroma-dominance pass with tighter square-component geometry.
- Geometry is validated before cell sampling.
- Luma thresholds use a fixed histogram rather than allocating and sorting 25,088 samples.
- Sampling radius is derived from observed cell pitch and stays at one center pixel near three pixels per module.
- One Grid worker reuses its last transport-valid registration, treats a periodic global refresh as a candidate, retains the verified registration when that refresh fails, and can perform a bounded same-exposure fresh reacquisition after a transport-invalid decode. This is reuse plus reacquisition, not local quadrilateral tracking.
- Camera submissions use `presentedFrames` when available and are target-rate bounded; stale or duplicate callbacks are not decoded.
- Grid decodes the same centered 16:9 cover crop shown in the phone preview at 960×540. This avoids squeezing Safari's portrait-shaped camera source into a 540×960 worker raster and makes the operator guide describe the pixels actually decoded.
- Grid requests 1080p-class source resolution at 30 fps rather than forcing 60 fps at 720p; the 248-column PHY needs spatial samples more than duplicate temporal observations.
- The receiver allows 20 seconds for initial aiming, then stops after ten seconds without a new CRC-valid unique symbol.
- An absolute 120-second Grid camera-session ceiling bounds a failed lab run without treating a legitimate LT rank plateau as corruption.
- CRC-invalid frames cannot reset the optical-progress watchdog.

## Observable results

Live and exported reports now distinguish:

- camera exposures per second;
- completed, successful transport-valid, and empty decode jobs;
- accepted unique symbols per second;
- duplicate symbols per second;
- busy drops and rate-limited exposures;
- last Grid attempt, furthest PHY stage, and a per-outcome Grid histogram;
- last Grid outcome, contrast, screen fill, corrected codewords, and registration reuse;
- reconstruction rank and required rank.
- time to first valid symbol, camera-open-to-verified diagnostic goodput, and the legacy first-accepted-to-verified diagnostic window.

This separation is necessary because raw detections are not file goodput.

The one-second preamble is a valid repeated symbol-zero frame. The receiver may
accept its first unique symbol during that hold, so the
first-accepted-to-last-accepted optical frame window can include some or all of
the preamble and therefore understate steady-state channel rate. That field is
a same-setup diagnostic. It is not a synchronized optical-start measurement or
a publication-grade goodput window.

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

The physical gate begins with one exact, named laptop/phone pair. Record the full sender and receiver models, OS/browser versions, reviewed commit, display/camera settings, mounting, distance, angle, lighting, and brightness before the first attempt.

1. Use the built-in 144 KiB payload with **Grid 30 lab**, sender raster fullscreen, and phone landscape.
2. Predeclare a three-attempt smoke set and run all three consecutively under one unchanged condition.
3. Retain and publish every attempt—including warm-ups, failures, aborts, and timeouts. Do not restart the set to discard an unfavorable run.
4. Pass the smoke gate only when all three attempts verify and no run exceeds the bounded startup, stall, or absolute session windows.
5. Export `glassbridge-capacity/5` JSON for every completion and `glassbridge-device-run/1` JSON for every stopped run.
6. Record camera-open-to-verified as a receiver diagnostic, not the headline timing window.
7. Require a synchronized optical start marker before publishing completion-time or goodput comparisons; measure from sender optical start to receiver verification.

Only physical runs can establish camera goodput, and physical proof is still pending. A 60-symbol/s or 1 Mbps-class claim remains blocked until Grid 30 lab passes the undiscarded named-pair smoke gate and that named pair passes the higher temporal rate with synchronized-start timing. Broader claims require a declared multi-device matrix; browser user-agent matching is not a hardware-identity guarantee.

## Next PHY work

1. Track the screen quadrilateral locally between global reacquisitions instead of merely reusing it.
2. Crop/rectify the registered screen before transferring pixels to the worker.
3. Add temporal pilots and recover stable row bands from rolling-shutter transition exposures.
4. Replace whole-frame Hamming with interleaved Reed–Solomon stripes and soft confidence.
5. Move luma extraction, rectification, and FEC into shared Rust/WASM or a native receiver.
