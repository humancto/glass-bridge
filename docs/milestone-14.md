# Milestone 14: adaptive packing and lane-parallel decoding

Milestone 14 attacks two independent contributors to transfer time without
weakening the AGX verification, policy, quarantine, or receipt path:

1. send fewer optical bytes when the signed envelope compresses; and
2. stop asking one QR acquisition pass to find two dense codes in a full frame.

The result is an increment, not a physical speed claim. The receiver's verified
goodput remains the deciding measurement.

## What changed

### Bounded adaptive optical packing

The browser now attempts gzip on the complete signed AGX envelope before LT
coding. It uses the compressed representation only when the packing header plus
gzip stream saves at least 64 bytes. Pairing version 3 binds `identity` or
`gzip`, so a stale or mismatched receiver fails before decompression and before
treating the reconstructed object as AGX.

The receiver decompresses into a declared, bounded output size before it parses
or verifies AGX. It then performs the same canonical-CBOR, COSE, Ed25519,
boundary, length, SHA-256, policy, quarantine, replay, and release checks as the
identity path. Compression changes transport work; it does not change the signed
security object.

A deterministic 144 KiB structured-CSV sample used during development packed
to 23,907 bytes, an 83.8% reduction and a 6.17× effective file/optical-byte
multiplier. That is an illustrative input, not a universal ratio. JPEG, ZIP,
video, encrypted, and already-compressed files will normally remain on the
identity path.

### Lane-parallel QR acquisition

For paired dual-lane profiles, the receiver now creates overlapping left/right
regions and submits them as independent one-symbol jobs to the WASM worker pool.
Every fifteenth camera frame still uses full-frame two-code acquisition so a
slightly off-center operator can recover.

Run:

```bash
npm run benchmark:parallel-decode
```

On the development machine, ideal 1280×720 exposures produced:

| Profile | Full-frame p50 | Modeled parallel p50 | Full-frame p95 | Modeled parallel p95 |
|---|---:|---:|---:|---:|
| dual v30-L | 6.84 ms | 3.40 ms | 8.54 ms | 4.09 ms |
| dual v40-L | 8.56 ms | 4.54 ms | 9.42 ms | 4.91 ms |

The parallel figures take the slower lane for each modeled exposure before
calculating percentiles. They model independent workers and exclude camera delivery,
pixel readback, scheduling, focus, perspective, moiré, and display transitions.
They show that lane-level parallelism has CPU headroom; they do not prove a 2×
phone-camera goodput gain.

## Where the standard-QR ceiling really is

On a 60 Hz display, two refresh-stable lanes updated alternately carry 60
combined symbols/s. That gives these pre-loss channel budgets:

| Profile | Useful bytes/code | Stable combined rate | Stable channel budget | One-refresh peak budget |
|---|---:|---:|---:|---:|
| Burst, dual v30-L | 1,688 | 60 codes/s | 98.9 KiB/s | 197.8 KiB/s at 120/s |
| Ceiling, dual v40-L | 2,900 | 60 codes/s | 169.9 KiB/s | 339.8 KiB/s at 120/s |

The 120/s modes change both codes every display refresh. A 60 fps rolling-shutter
camera must then capture nearly every transition cleanly. More nominal symbols
can therefore produce *less* verified goodput. QRFerry independently uses the
same alternating dual-lane principle and describes its dense v40 mode as a
1.40 Mbps nominal channel before camera loss.

For incompressible data, standard QR on ordinary 60 Hz/60 fps hardware is
unlikely to sustain much beyond the dual-v40 one-refresh budget, and the robust
operating point is probably closer to the stable 169.9 KiB/s channel budget.
Only a device matrix can establish the completed-file fraction of that budget.

## The path beyond QR

More browser workers cannot raise the display/camera information rate after
decode keeps up. The next codec research should proceed in measured stages:

1. register the screen once and use one rectangular payload field instead of
   repeating QR finder, timing, format, mask, and quiet-zone overhead;
2. recover rolling-shutter transition bands instead of discarding mixed frames;
3. add a calibrated monochrome grid with pilots and Reed–Solomon protection;
4. evaluate multilevel or color cells only after per-device channel estimation;
5. move registration and demodulation into SIMD WASM, WebGPU, or a native camera
   pipeline; and
6. keep optional duplex rate feedback as a separate profile from strict one-way
   operation.

Visual-MIMO and color-grid research shows that these are real alternatives, but
they replace the commodity QR decoder with a custom communication system. The
next credible target is therefore not an invented “ultra” label. It is a custom
codec prototype that beats the best QR profile in verified goodput across the
same registered device matrix.

Primary references:

- [QRFerry](https://github.com/deedy/qr-data-transfer)
- [Decimen Optical Transfer](https://github.com/bashalarmistalt/decimen-optical-transfer)
- [libcimbar](https://github.com/sz3/libcimbar)
- [AIRCODE, USENIX NSDI 2021](https://www.usenix.org/conference/nsdi21/presentation/qian)
