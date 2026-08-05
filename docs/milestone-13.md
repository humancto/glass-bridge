# Milestone 13: measurable capacity ladder

Milestone 13 replaces a single speed claim with a repeatable search for the
stable capacity of one laptop/phone pair. It changes rate and density separately,
reports sender misses, and exports the receiver result as structured JSON.

## Two meanings of capacity

**Implemented QR channel ceiling.** Ceiling Lab displays two version 40-L QR
codes and can replace both on every 60 Hz refresh. Each AGF2 code contains 2,900
useful bytes plus 44 bytes of framing. At 120 combined codes/s, the nominal
useful-symbol budget is 348,000 B/s (339.8 KiB/s). A 144 KiB payload therefore
has a 0.42-second payload-only floor before envelope and fountain overhead.

**Stable device capacity.** The real capacity is the highest tested step that
reconstructs and verifies repeatedly while still improving median verified
payload goodput. It depends on camera frame rate, exposure, rolling shutter,
focus, display refresh, code size, decoder pressure, and physical alignment.
There is no honest device-independent phone result.

QR Model 2 ends at version 40 (177×177 modules), and version 40-L stores about
3 KB of binary data. GlassBridge leaves four quiet-zone modules around each
code and reserves 44 bytes inside the QR payload for AGF2 framing. See DENSO
WAVE's [version and capacity reference](https://www.qrcode.com/en/about/version.html)
and [QR FAQ](https://www.qrcode.com/en/faq.html/about/howto/cell.html).

## Implemented experimental axes

### Rate ladder: hold density constant

Use Burst (two v30-L codes, 1,688 useful bytes/code) and test these rates in
order:

| Step | Combined codes/s | Per-lane behavior on 60 Hz | Nominal useful rate | 144 KiB floor |
|---|---:|---|---:|---:|
| Calibrate | 30 | one code/lane every four refreshes | 49.5 KiB/s | 2.91 s |
| Stable | 60 | one code/lane every two refreshes | 98.9 KiB/s | 1.46 s |
| Sprint | 90 | alternates one and two refreshes | 148.4 KiB/s | 0.97 s |
| Peak | 120 | both lanes change every refresh | 197.8 KiB/s | 0.73 s |

The sender uses display-refresh credit rather than a timer loop. It renders at
most one new symbol per visible lane per refresh and counts work that missed its
display opportunity. It does not emit an invisible catch-up burst.

### Density ladder: hold rate constant

Compare Burst and Ceiling Lab at the same combined code rate:

| Profile | QR layout | Useful bytes/code | 60 codes/s | 120 codes/s |
|---|---|---:|---:|---:|
| Burst | 2× v30-L | 1,688 | 98.9 KiB/s | 197.8 KiB/s |
| Ceiling Lab | 2× v40-L | 2,900 | 169.9 KiB/s | 339.8 KiB/s |

If Ceiling improves goodput at the same rate, the camera has enough spatial
resolution for the denser modules. If valid codes collapse, v40 acquisition—not
JavaScript QR generation—is the constraint.

## Exact phone test protocol

1. Use the built-in **144 KiB capacity test**. Keep display brightness fixed,
   disable auto-lock, prop the laptop, and hold or mount the phone landscape at
   a repeatable distance.
2. Start with Burst / 30. Run it three times with a fresh generated envelope
   each time. A replayed successful envelope is intentionally rejected.
3. Review the phone's post-receive analytics after every verified run. It
   compares the current verified goodput with the previous and best run using
   the same profile and payload size, and retains the last 20 runs locally.
   Export the benchmark JSON before changing devices. It includes transfer
   seconds, verified payload B/s, accepted/rejected/duplicate codes, accepted
   codes/s, symbol rate, decoded acceptance, fountain overhead, payload
   efficiency, negotiated and observed camera FPS, valid codes/s, decode
   latency, worker count, and busy drops.
4. Repeat Burst at 60, 90, and 120. Stop increasing rate after any step fails
   verification or its median verified goodput improves by less than 10%.
5. Return to 60 and compare Ceiling Lab against Burst. Only then try Ceiling at
   90 and 120.
6. The stable result is the fastest step with 3/3 verified runs, zero sender
   display misses during the solve window, and a meaningful median-goodput gain.

For the practical demonstration, 144 KiB must complete in less than five
seconds. A longer run can still be useful diagnostic evidence, but it does not
pass the product gate.

## Repeatable non-camera benchmark

Run:

```bash
npm run benchmark:capacity
```

The benchmark generates exact wire-sized codes and passes ideal 1280×720 pixel
exposures through the production ZXing-C++ WASM reader. On the development
machine used for this milestone, all 150 expected code decodes matched exactly:

| Ideal raster | p95 decode | Ideal exposures/s | Nominal at 60 camera FPS |
|---|---:|---:|---:|
| one v30-L | 8.35 ms | 173.8 | 98.9 KiB/s |
| two v30-L | 8.36 ms | 140.4 | 197.8 KiB/s |
| two v40-L | 9.69 ms | 110.0 | 339.8 KiB/s |

These numbers isolate decoder CPU and deterministic pixels. They exclude camera,
display, worker scheduling, fountain overhead, and verification. They show that
the ideal decoder is not the present 60-exposure/s ceiling; they do not prove a
phone will deliver those exposures.

## What comes after the QR ceiling

Further gains require changing the optical code rather than adding another QR
speed label:

1. recover rolling-shutter mixtures instead of treating the entire exposure as
   an erasure;
2. register the screen once and remove repeated QR finder/mask overhead;
3. use a fixed monochrome cell grid with lightweight per-frame checks while the
   stream fountain code handles erasures;
4. evaluate calibrated multilevel or color cells as an opt-in device profile;
5. keep any reverse adaptation channel out of strict one-way mode.

`requestAnimationFrame()` generally follows the display refresh rate, while
`requestVideoFrameCallback()` runs at the lower of video and browser paint rates.
That timing relationship is why the sender reports displayed codes/s and the
receiver independently reports observed camera frames and valid codes/s. See
MDN's references for [display animation timing](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)
and [video-frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).
