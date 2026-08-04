# Milestone 11: Turbo optical engine

Milestone 11 creates an experimental high-throughput browser path aimed at the
published 128 KiB/s class of single-QR optical transfer. It does **not** claim
that physical goodput target yet. It provides the channel budget, pipeline, and
on-device measurements needed to test the claim honestly.

## Why milestone 10 could not compete

The old Fast profile carried 1,536 useful bytes at 12 FPS, so its absolute raw
ceiling was 18 KiB/s. Cryptographic signing, policy, and quarantine were not the
bottleneck; the profile was nearly an order of magnitude too small before the
camera saw a frame.

Decimen demonstrates the relevant baseline: dense QR v40-L frames near 2,953
bytes, a 60 FPS display schedule, sparse LT fountain repair, video-frame-synced
capture, and parallel ZXing-WASM decoding. Its repository reports results in the
128–186 KB/s range under favorable conditions. GlassBridge now adopts that
transport class while retaining its distinct signed-envelope and controlled
release architecture. See [third-party notices](../THIRD_PARTY_NOTICES.md).

## Implemented Turbo profile

| Property | Turbo value |
|---|---:|
| Wire format | AGF2 |
| Useful symbol | 2,900 bytes |
| Frame size | 2,944 bytes |
| QR | fixed v40-L, mask 4, binary byte segment |
| Target display cadence | 60 FPS |
| Raw useful-symbol rate | 174,000 B/s / 169.9 KiB/s |
| FEC | systematic sparse LT followed by endless unique repair |
| Camera request | 1280×720, exact 60 FPS then ideal-60 fallback |
| Capture crop | centered square, at most 720×720 |
| Decoder | 2–4 `zxing-wasm` workers |

At 144 KiB, the payload-only lower bound is 51 source frames, or 0.85 seconds at
60 FPS. The robust-soliton estimate is larger, and the signed envelope adds
bytes. The actual result depends on display cadence, camera exposure, decoded
unique-frame rate, loss, and fountain solve overhead.

## Sender pipeline

- The sender fixes QR version and mask, avoiding a second capacity/mask search.
- A `requestAnimationFrame` pump is synchronized to monotonic frame deadlines.
- An offscreen canvas is reused, and only the finished frame reaches the visible
  canvas.
- React telemetry is limited to five updates per second so UI rendering does not
  compete with optical rendering.
- Turbo does not loop a finite repair set. Every post-source symbol identifier
  produces another deterministic sparse equation.
- The page reports selected and measured render FPS separately.

`npm run benchmark:turbo-qr` measures QR matrix generation in isolation.
`npm run benchmark:turbo-decode` independently pushes a 2,944-byte frame as a
720×720 pixel raster through ZXing-C++ WASM using the phone worker's production
reader settings and requires an exact byte match. These are CPU regression
signals, not camera-goodput results.

In a local production-build browser run, the sender reported 60.0 rendered FPS
for the observed interval. That validates display scheduling only; it says
nothing about how many frames a phone can decode.

## Receiver pipeline

- `requestVideoFrameCallback` captures once per delivered camera frame; animation
  frame is only a compatibility fallback.
- A bounded worker pool owns separate ZXing-C++ WASM decoders. When every worker
  is busy, the newest camera frame is discarded instead of building latency.
- Binary AGF1 and AGF2 data enter the same bounded CRC/session parser. Legacy text
  remains supported.
- The UI exposes camera FPS, valid QR decode FPS, worker count, p50/p95 decode
  latency, and busy-frame drops.
- Transfer timing starts at the first accepted unique frame and ends only after
  AGX signature, digest, boundary, and local policy verification. The quarantine
  view reports payload **verified goodput**, not nominal rate.

## Sparse LT recovery

AGF2 keeps AGF1's bounded 40-byte header and 4-byte CRC but changes the magic and
equation generator. Source symbols are systematic. Repair symbols use a seeded
robust-soliton degree distribution and sparse source indices. The decoder uses a
peeling graph rather than AGF1's dense Gaussian basis, reducing equation work and
memory pressure for the browser hot path.

AGF1 remains wire-compatible with milestones 9 and 10. AGF2 is experimental and
may change before a stable protocol release.

## Security invariants

Turbo does not weaken canonical AGX/COSE Ed25519 verification, SHA-256 integrity,
paired sender/boundary checks, bounded parsing, CRC rejection, mixed-session
rejection, default-deny policy, memory quarantine, replay reservation, explicit
release, or receiver-signed evidence. Workers return untrusted bytes; only the
bounded transport parser can accept them.

## Verification and benchmark gate

```bash
npm test
npm run benchmark:turbo-qr
npm run benchmark:turbo-decode
cargo test --workspace --all-targets --all-features --locked
```

The automated suite covers QR capacity, the raw-rate budget, deterministic sparse
equations, recovery after systematic-frame erasures, compatibility paths, and
worker backpressure. It also renders v40-L QR pixels at the receiver's 720×720
capture size, decodes them with the exact production ZXing-WASM settings, checks
all 2,944 bytes, repeats the proof after a 90-degree rotation, and reconstructs a
multi-frame AGF2 transfer using only bytes recovered from those QR pixels.

The physical gate requires raw run records across the device matrix. For each run
record phone, OS/browser, camera-reported resolution/FPS, laptop/display refresh,
brightness, distance/angle, file and envelope sizes, sender achieved FPS, valid
decode FPS, p50/p95 decode latency, busy drops, accepted/duplicate/rejected frames,
time to verified quarantine, verified payload goodput, retry count, and thermals.

- **Challenge gate:** median verified goodput at least 128 KiB/s for 144 KiB and
  256 KiB payloads in the supported stationary setup.
- **Stretch gate:** at least 200 KiB/s requires multiple visual lanes, a 120 Hz
  path, or a non-QR codec; a single 2,900-byte QR at 60 FPS cannot supply that raw
  budget.
- Publish failed runs and device exclusions with successful results.

Until those phone runs exist, Turbo is a testable candidate, not a performance
claim and not a certified data diode.
