# What If a File Crossing an Air Gap Carried Its Trust Contract?

*Draft launch article for GlassBridge / AGX — 2026-08-17*

The obvious demo is almost too simple: choose a file on a laptop, point a phone camera at two moving QR codes, and save the reconstructed file.

But file transfer is not the interesting part.

The interesting part is what happens before the phone is allowed to expose those bytes.

GlassBridge reconstructs a signed envelope from light, verifies that it targets the paired boundary, checks its length and SHA-256, applies a receiver-local default-deny policy, holds the payload in memory quarantine, measures the verified transfer rate, asks a human to approve release, reserves the envelope against replay, and creates receiver-signed evidence stating exactly what happened.

Only then does the Save / Share button become meaningful.

That is the project: not another QR file-transfer app, but an experiment in making a manual security-boundary crossing explicit, constrained, and auditable.

## The USB drive is not just a cable

Air-gapped and isolated environments still need firmware, configurations, certificates, datasets, and logs. The gap cannot mean “nothing ever crosses.” It means every crossing needs to be deliberate.

Portable media solves the physical movement problem, but it brings a writable filesystem, residual data, device firmware, mount behavior, and a procedure that often lives outside the transferred object. NIST’s 2025 guidance says portable storage remains useful in operational technology while also posing cybersecurity risk that requires procedural, physical, and technical controls.

Optical transfer changes that shape. A display emits a time-bounded stream. A camera receives it. No removable filesystem is attached to both hosts, and the application needs no network path between them.

That is useful—but light is not magically trusted.

An observer can record it. Another light source can inject or jam it. A compromised sender can sign malicious content. A normal phone still has radios, an operating system, a browser, and a supply chain. Loading code from a website is not how a production air-gapped receiver should be provisioned.

So GlassBridge treats every optical frame like a hostile packet and treats “air-gapped” as a deployment property, not a marketing adjective.

## We did not invent animated QR transfer

This project exists because prior work moved the baseline.

[Decimen Optical Transfer v0.4.0](https://github.com/bashalarmistalt/decimen-optical-transfer/tree/v0.4.0) already provides a polished browser experience for one-way fountain-coded QR transfer, works offline after the first visit, and verifies SHA-256. Its README reports 418.5 KB/s sustained and 601.5 KB/s peak for desktop-to-phone, plus 199.2 KB/s sustained and 340.8 KB/s peak for phone-to-phone. These are Decimen's published numbers, not GlassBridge measurements, and a fair comparison still requires aligned payloads, devices, conditions, and timing windows. Decimen v0.4.0 and later are AGPL-3.0-or-later; GlassBridge's adapted fountain code is pinned to the MIT-licensed v0.3.0 commit identified in the [third-party notices](../THIRD_PARTY_NOTICES.md), and no post-v0.3.0 Decimen source is incorporated.

[QRFerry](https://github.com/deedy/qr-data-transfer) pushes browser transport with raw QR bytes, RaptorQ, refresh-stable dual lanes, dense laboratory profiles, and detailed decoder telemetry. [TXQR](https://github.com/divan/txqr), [qram](https://github.com/digitalbazaar/qram), and [libcimbar](https://github.com/sz3/libcimbar) establish even more of the animated-fountain and custom-code landscape.

Animated QR is prior art. Fountain coding is prior art. Dual lanes are prior art. No-network browser transfer is prior art. A high nominal optical bitrate is not a novelty claim.

GlassBridge is built on that honest starting point.

## The layer above transport

The core proposal is AGX: a codec-independent signed transfer envelope.

An AGX manifest binds the exact payload bytes to an intended boundary, direction, purpose, policy identity, sequence, creation time, object metadata, length, and digest. The transport may be QR today and a denser code tomorrow; the authorization contract does not change with the barcode.

The current public flow is:

```text
choose
  -> sign
  -> pair a key + boundary + optical session
  -> emit repair-coded optical frames
  -> reconstruct in bounded memory
  -> verify signature + boundary + length + digest
  -> apply receiver-local policy
  -> quarantine
  -> measure verified goodput
  -> approve release
  -> reserve replay state
  -> sign a release-authorized receipt
  -> save/share
```

Each arrow is a state transition with a failure meaning. Nothing to send produces no transfer UI. A wrong optical session is rejected. A valid signature does not bypass local policy. A quarantined payload is not a released file. A release receipt does not pretend that another application later opened or persisted the file.

This semantic discipline is the interesting part.

## What is actually special today

We do not know of a compared general-purpose optical-transfer project that combines all of these properties in one runnable browser/Rust research artifact:

1. **Session-bound signed envelopes.** The key, receiving boundary, optical profile, and random transfer session are paired before the animated stream is accepted.
2. **Receiver-controlled policy.** Authorization is recomputed on the receiving side; sender intent is not sufficient.
3. **Quarantine before exposure.** Verified bytes remain in memory until explicit operator release.
4. **Honest evidence.** The receiver signs a typed `release-authorized` event and states what it does not prove.
5. **Security-aware performance.** The headline metric is verified payload goodput after reconstruction and cryptographic checks, accompanied by accepted-code rate, erasures, fountain overhead, camera rate, and decoder latency.
6. **Cross-implementation fixtures.** Rust and browser code share exact protocol frames and deterministic vectors.
7. **A codec boundary.** Faster visual transports can be evaluated without rewriting provenance, policy, quarantine, and audit semantics.

This is a defensible systems contribution, not yet a claim of being the first system in the world. That claim would require a formal literature and patent review plus independent evaluation.

## The live result—and the honest speed story

The public pre-alpha currently supports one file up to 256 KiB. Its default Burst mode shows two QR lanes and uses sparse LT repair. Milestones 13 and 14 added controlled 30/60/90/120 combined-code steps, a dense Ceiling Lab profile, bounded adaptive gzip, and lane-parallel decoding. Milestone 15 added a registered binary Grid v0. Milestone 16 addresses several acquisition hypotheses—sender controls sharing the raster, fractional cell scaling, cold-start exposure and registration, repeated full-frame work, and ambiguous stalled runs—with Grid-only fullscreen, integer cell scaling, an acquisition preamble, registration reuse with transport-valid reacquisition, bounded latest-frame scheduling, explicit session limits, and exported lock-quality diagnostics. It does not yet track the screen quadrilateral locally between global registration attempts. Only undiscarded physical runs can show whether these paths were the real bottlenecks.

The implemented Ceiling Lab channel budget reaches 348,000 useful symbol bytes per second, or 339.8 KiB/s, before camera loss and protocol overhead. That is a capacity bound, not physical goodput.

For structured files, effective file goodput can rise without increasing the optical symbol rate. A deterministic 144 KiB structured-CSV development sample required 23,907 optical bytes after packing, a 6.17× reduction. Already-compressed and encrypted inputs do not receive that benefit. On ideal 1280×720 rasters, lane-level acquisition approximately halved QR decode latency; only the phone-camera tests can show whether that CPU headroom becomes completed-file goodput.

After a successful run, the phone reports diagnostic verified payload bytes per second and exports a versioned JSON record. It retains the last 20 comparable records in resettable browser storage, matched by browser user agent, visual PHY, target rate, and exact payload. That history helps same-setup iteration but does not identify physical hardware and cannot prevent an operator from clearing storage, restarting a series, or selectively publishing results. Publication discipline therefore comes from a preregistered run set and the release of every raw success, failure, abort, and timeout.

We have ideal-raster tests and a deterministic camera-raster simulator with perspective, fractional resampling, moiré, brightness loss, colored distractors, blur, and rolling-shutter transition tears. Its 144 KiB Grid30 gate recovers 73/73 stable source epochs byte-for-byte at about 7.4 ms p95 decode on the development Mac, while transport CRC rejects every mixed transition epoch in the run. The modeled source floor is 2.43 seconds and the expected LT window is 3.4 seconds. These numbers still do not measure a phone camera. The next public result must predeclare one exact sender/receiver pair and build, run three consecutive smoke attempts without discarding warm-ups, failures, or aborts, and publish every result with the visual PHY, target rate, payload size, setup, and raw JSON. The Grid first-accepted-to-last-accepted diagnostic may include the one-second symbol-zero acquisition preamble. Camera-open and first-accepted windows are useful diagnosis, not speed headlines; publication comparisons require a synchronized optical start marker.

Grid v0 carries 2,032 useful bytes per symbol, so its one-lane ceiling is 59.5 KiB/s at 30 symbols/s and 119.1 KiB/s at 60 symbols/s before any loss or fountain overhead. It cannot match Decimen's current 199.2 KB/s phone-to-phone or 418.5 KB/s desktop-to-phone sustained figures on incompressible data by scheduling alone. Reaching that class requires more independently recoverable visual capacity—a multi-lane or denser PHY, temporal/rolling-shutter recovery, suitable compression, or a combination—plus physical evidence. The diagnostic pipeline should tell us whether each failed gain is limited by display scheduling, rolling shutter, camera delivery, acquisition, worker pressure, erasures, or fountain overhead.

## Why one-way can work

A normal reliable protocol asks the receiver what it missed. A strict one-way optical channel cannot.

Fountain-style repair changes the problem. The sender emits an effectively open-ended sequence of repair symbols. The receiver does not need frame 17 specifically; it needs enough independent information to reconstruct the source. Frames may be lost, duplicated, or received out of order without a retransmission request.

That makes a screen-to-camera path practical without an acknowledgment channel. It does not prove a physical one-way guarantee. NIST defines a one-way transfer mechanism as allowing data in one direction and not the reverse. Achieving that assurance on real equipment requires control of all other interfaces, not merely a unidirectional application protocol.

GlassBridge therefore separates direction profiles:

- a public browser demonstration;
- a controlled offline profile with pinned code, disabled radios, and provisioned trust; and
- a future receive-only appliance profile whose physical I/O can be inspected and evaluated.

## Why this could be bigger than the demo

The demo is a useful wedge because anyone can understand it. The larger idea is an open contract for controlled exchange across disconnected security domains.

If AGX remains independent of QR, one envelope can move through a browser, a native workstation, an offline signing ceremony, a factory update station, or a dedicated optical appliance. Organizations can define who may authorize a crossing, which purposes and artifact types are accepted, which content transformations are required, and what evidence is produced.

The receiver remains the enforcement point.

That could turn a class of manual copy procedures into interoperable, testable security workflows. It could also create a common research platform for optical transport, policy languages, operator error, content disarm and reconstruction, signed evidence, and high-assurance one-way hardware.

The hard problems are not hidden: trust provisioning, protected replay state, malicious-content handling, reproducible builds, device variance, physical side channels, and evaluation. Those are exactly the problems worth opening to researchers and builders.

## Try it, measure it, break it

Open [GlassBridge Send](https://humancto.github.io/glass-bridge/send.html) on a laptop, select the 144 KiB capacity file and Grid 30 lab, and prepare the transfer. Scan the stationary pairing QR with a phone, confirm the fingerprint, open the phone camera, and turn the phone landscape. Only then press **Fullscreen & start** once on the laptop and keep all four colored Grid corners visible. Name the exact sender/receiver pair and build before starting a three-attempt smoke set. A rate change forces re-pairing because the receiver must bind the exact channel being measured.

Save the success or failure JSON after every attempt, including the first attempt, warm-ups, aborts, and timeouts; do not restart the set to remove an unfavorable run. Pass the smoke gate only if all three consecutive Grid 30 attempts verify. Treat camera-open-to-verified as a diagnostic. Do not publish a comparative speed result until sender optical start and receiver timing share a synchronized marker. Synthetic test data only: this is pre-alpha research, not a production security control.

The source, protocol snapshots, tests, milestone reports, and limitations are in [humancto/glass-bridge](https://github.com/humancto/glass-bridge). The most useful contributions right now are:

- raw `glassbridge-capacity/5` successes and `glassbridge-device-run/1` failures from named device pairs;
- optical and protocol failure cases;
- adversarial review of AGX, pairing, policy, quarantine, replay, and receipt semantics;
- independently written decoders for the published fixtures; and
- critique of the threat model and novelty framing.

The project is available under the Apache License 2.0. The license permits commercial use and includes an explicit patent grant while preserving required notices; it does not turn this pre-alpha research prototype into a production security product.

## Suggested launch package

### Headline

**Show HN: GlassBridge — a signed, policy-gated optical crossing experiment**

### Short explanatory demo sequence

This edited sequence explains the workflow; it is not benchmark evidence. Pair
it with an uncut, synchronized-start run and raw JSON when physical results are
ready.

1. Show Wi-Fi disabled on the receiving device only if it really is disabled.
2. Choose the 144 KiB test file on the laptop.
3. Scan the stationary pairing QR and match the fingerprint.
4. Turn the phone landscape and start the fullscreen Grid stream.
5. Cut directly to “Verified. Held for approval.”
6. Show verified goodput and accepted-code rate.
7. Approve release and show the signed receipt beside the file.
8. End on: “The QR transfer is prior art. The controlled crossing is the experiment.”

### Distribution order

1. Tag a reproducible pre-alpha release after the physical dataset, checksums, SBOM, and provenance are ready.
2. Publish this article and a full-resolution, uncut benchmark run.
3. Post the live demo and source to Hacker News, Lobsters, relevant security/systems communities, and professional networks.
4. Ask one concrete question: “What would you require before trusting this boundary?”
5. Publish a device-matrix update one week later, including failures and lessons.

The path to attention is not a superlative. It is a demo people can reproduce, a limitation section experts respect, and a result they can challenge.

## Sources

- [NIST SP 1334: Reducing the Cybersecurity Risks of Portable Storage Media in OT Environments](https://csrc.nist.gov/pubs/sp/1334/final)
- [NIST SP 800-82 Rev. 3: Guide to Operational Technology Security](https://csrc.nist.gov/pubs/sp/800/82/r3/final)
- [NIST glossary: one-way transfer device](https://csrc.nist.gov/glossary/term/one_way_transfer_device)
- [QRFerry](https://github.com/deedy/qr-data-transfer)
- [Decimen Optical Transfer](https://github.com/bashalarmistalt/decimen-optical-transfer)
- [TXQR](https://github.com/divan/txqr)
- [qram](https://github.com/digitalbazaar/qram)
- [libcimbar](https://github.com/sz3/libcimbar)
