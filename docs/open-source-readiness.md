# GlassBridge open-source readiness review

**Review date:** 2026-08-06  
**Reviewed baseline:** milestone 15 browser research path, extending the `41c240a` trust-path audit  
**Decision:** publish as an Apache-2.0 open-source research preview while keeping production and performance claims gated on physical evidence and security hardening.

## Executive answer

GlassBridge is ready for a public **research preview**. It has a real laptop-to-phone demonstration, a tested Rust and browser implementation, written protocol snapshots, deterministic vectors, security limitations, third-party notices, and reproducible benchmark tooling. It is not ready to be described as a production cross-domain solution, certified data diode, malware control, or proven fastest optical-transfer system.

The repository now includes the canonical Apache License 2.0 and matching package, Cargo, and citation metadata. Users and contributors have explicit permission to use, modify, distribute, and commercially use the work subject to the license terms. This resolves the legal-permission blocker; it does not resolve the physical-performance, organizational-trust, or production-assurance gates.

### Public front-door audit

| Surface | Status | Evidence |
| --- | --- | --- |
| Visitor-first README | Ready | Live demo, differentiator, trust flow, honest performance table, local setup, contribution routes, and limitations are visible before implementation detail. |
| Share artwork | Ready | A repository-owned 1280×640 social preview and accessible SVG source are in `docs/assets/`. |
| Repository metadata | Ready | The concise About description, live-demo homepage, focused discovery topics, Discussions, labels, and issue routes are configured; the unused Wiki is disabled. |
| Community package | Ready | Code of conduct, governance, support, citation, CODEOWNERS, guided issue forms, contribution policy, security policy, and pull-request checklist are present. |
| Dependency and disclosure posture | Ready for preview | Dependabot, secret scanning, push protection, and private vulnerability reporting are enabled; third-party notices are committed. |
| Legal permission | Ready | The canonical Apache-2.0 text, SPDX package metadata, citation metadata, contribution terms, and third-party notices are committed. |
| Performance headline | Blocked | Physical device-matrix data is still required before claiming a phone-camera speed record. |

### Launch blockers

| Priority | Blocker | Why it matters | Recommended action |
| --- | --- | --- | --- |
| P0 | No physical device-matrix result set | The implemented channel budgets and ideal-raster tests are not phone-camera goodput. A speed headline without raw physical results would overclaim. | Run at least three repetitions for each announced profile on five sender/receiver pairs; publish every success as `glassbridge-capacity/4` and every failure as `glassbridge-device-run/1`. |
| P0 | Demo trust is session TOFU | The current pairing proves that the recovered envelope came from the ephemeral key shown during pairing. It does not prove a company, release role, managed device, or software publisher. | Keep the demo language explicit. Before a security-product claim, add provisioned organizational trust roots, signed role delegation, rotation, and revocation. |
| P1 | Future exclusive relicensing is undefined | Apache-2.0 supports commercial use and acquisition, but outside contributors retain copyright and existing public grants are irrevocable. | Keep inbound and outbound terms aligned now. If an exclusive dual-license model becomes important, review a contributor agreement with qualified counsel before accepting substantial outside code. |

### Important before a production claim

- Host reviewed, version-pinned receiver assets at a managed origin that can set security response headers. GitHub Pages is appropriate for the public demo, not for a high-assurance receiver.
- Move replay and rollback state from browser storage to protected monotonic storage in the native or appliance profile.
- Add continuous parser/transport fuzzing, advisory scanning as a CI gate, release SBOMs, signed provenance, and reproducible release experiments. Dependabot version and security updates are already enabled.
- Add content inspection hooks and narrow content-disarm/reconstruction profiles before claiming that a verified file is safe to open.
- Define a receive-only reference appliance and document every radio, display, camera, storage, debug, and peripheral path before using “data diode” language.
- Maintain the newly enabled GitHub private vulnerability reporting path and document a monitored security-response owner before a production release.

## What works now

The public demonstration implements this bounded workflow:

```text
laptop chooses one file (<= 256 KiB)
  -> fresh transfer key + 128-bit optical session
  -> canonical AGX/1 manifest binds bytes, boundary, purpose, policy and digest
  -> Ed25519 signature
  -> bounded adaptive gzip only when it reduces optical bytes
  -> AGF2 sparse-LT repair stream
  -> one or two animated QR lanes, or a registered full-screen Grid v0 field
  -> phone camera + visual-PHY worker path
  -> wrong/mixed-session rejection and bounded reconstruction
  -> canonical CBOR + COSE + signature + boundary + length + SHA-256 verification
  -> receiver-local default-deny policy
  -> in-memory quarantine
  -> post-receive verified-goodput analytics
  -> explicit human approval
  -> bounded replay reservation
  -> receiver-signed release-authorized receipt
  -> browser save/share exposure
```

This is substantially more than a product mock-up. The browser and Rust paths have deterministic interoperability vectors, the receiver rejects malformed and mixed-session frames, the test harness covers the trust path, and the deployed build is generated by CI.

## Flow audit

### 1. Selection and preparation

**Implemented:** one bounded browser file, sample payloads, empty-state guard, 256 KiB limit, local-only processing, fresh Ed25519 transfer key.

**Security value:** nothing optical is emitted before the operator selects and prepares a file. The signed manifest binds exact payload length and SHA-256.

**Remaining risk:** the browser, extensions, operating system, dependencies, and deployed JavaScript can observe the file. JavaScript key erasure is not a hardware destruction guarantee.

### 2. Pairing

**Implemented:** a stationary QR carries the sender public key, intended boundary, optical profile, visual PHY, target symbol rate, packing mode, and random session identifier. The fingerprint appears on both devices.

**Security value:** animated frames from another session are rejected; a completed envelope must verify under the paired key and boundary.

**Remaining risk:** this is trust on first use. If an attacker replaces the pairing display or convinces the operator to confirm the wrong fingerprint, the session can be paired to the attacker. Organizational provenance requires pre-provisioned trust.

### 3. One-way optical transport

**Implemented:** no acknowledgment is required. Sparse LT repair frames can arrive out of order and tolerate erasures; Burst and Ceiling Lab expose a controlled 30/60/90/120 combined-code capacity ladder. Grid 30 lab adds a full-screen binary field with four orientation-distinct corner markers, projective sampling, whitening, interleaved Hamming correction, and transport CRC. The sender uses bounded gzip only when it reduces the signed envelope, and pairing v4 binds packing, visual PHY, and target rate.

**Security value:** the payload can cross without a network connection or writable removable medium. CRC rejects transport corruption; session binding rejects stream mixing.

**Remaining risk:** CRC and gzip checks are not authentication. Compressed data adds a hostile decompression surface even with declared-output bounds. Light can be observed, injected, blocked, reflected, or recorded. The current payload is not encrypted. Commodity phones and laptops retain radios and other side channels.

### 4. Reconstruction and verification

**Implemented:** bounded frame sizes and counts, canonical CBOR, fixed COSE algorithm profile, strict shape checks, Ed25519 verification with ZIP-215 disabled, boundary match, length match, and whole-payload SHA-256.

**Security value:** corrupt, wrong-session, wrong-signer, wrong-boundary, non-canonical, and digest-mismatched transfers fail closed before release.

**Remaining risk:** parser and dependency bugs remain possible. Continuous fuzzing and independent review are still required.

### 5. Policy and quarantine

**Implemented:** a receiver-local default-deny policy is recomputed after cryptographic verification. Allowed bytes remain in memory until explicit approval.

**Security value:** a valid signature is not treated as sufficient authorization. The receiver controls the final boundary decision.

**Remaining risk:** the browser policy is a pinned research policy, not an organizational policy bundle. There is no malware scanning or CDR. Validly signed content can still be dangerous.

### 6. Analytics, release, replay, and evidence

**Implemented:** verified goodput, acquired-symbol rate, empty decode jobs, decode latency, fountain overhead, payload efficiency, camera diagnostics, like-for-like run history, `glassbridge-capacity/4` success export, `glassbridge-device-run/1` failure export, explicit release, local replay reservation, and a receiver-signed `release-authorized` receipt.

**Security value:** performance is measured at the useful security outcome, not at the number of pixels flashed. Receipt semantics distinguish release authorization from downstream persistence or use.

**Remaining risk:** browser local storage is not monotonic or tamper-resistant. Clearing site data clears replay history and the receiver receipt identity. A receipt does not prove that another app opened or persisted the file. Failed-run export is user-triggered and still lacks joined sender presentation timestamps, geometry, lux, brightness, and a synchronized optical start marker.

## What “air-gapped” means here

GlassBridge can support an air-gapped workflow because the payload channel needs only a display on one side and a camera on the other. It does **not** create an air gap merely because the file travelled as light.

Use three deployment labels:

| Profile | What it is | Valid claim |
| --- | --- | --- |
| Public demo | GitHub-hosted browser code on normal networked devices | “The payload was reconstructed from optical frames; the application has no upload endpoint.” |
| Controlled offline | Reviewed static bundle is pinned before isolation; radios and network interfaces are disabled; trust roots are provisioned locally; procedures control line of sight | “A one-way application transfer ran without a network or removable-media payload path.” |
| High assurance | Dedicated receive-only hardware, documented physical I/O, protected state, independent evaluation, managed trust/policy, safe import, and operational controls | Only this profile may eventually justify hardware one-way or evaluated cross-domain claims. Certification is separate. |

The optical path changes the attack surface rather than removing it. It removes a writable, persistent, host-attached transfer medium and makes the crossing visible and time-bounded. It adds camera/parser exposure, optical eavesdropping and injection, line-of-sight operational requirements, and display/camera supply-chain risk.

## What is special compared with QRFerry and Decimen

Credit the prior art plainly:

- QRFerry demonstrates sophisticated browser transport: RaptorQ, raw QR bytes, dual refresh-stable lanes, dense laboratory profiles, and decoder telemetry.
- Decimen demonstrates a practical no-network, one-way, fountain-coded browser transfer with compression, SHA-256 verification, offline reuse, and published phone-to-phone performance.
- TXQR/qram and libcimbar establish earlier animated-fountain and custom-dense-code directions.

GlassBridge should not claim animated QR, fountain coding, dual lanes, no-network browser transfer, or high optical bitrate as its invention.

The current differentiator is the **composition and semantics of the crossing**:

1. A codec-independent signed AGX envelope binds exact bytes to boundary, direction, purpose, policy identity, sequence, and digest.
2. Pairing binds an optical session, key, boundary, and profile; wrong and mixed sessions are rejected.
3. The receiving side recomputes a default-deny decision and keeps bytes quarantined until explicit release.
4. Replay reservation and receiver-signed evidence make release a typed event, while explicitly refusing to call it proof of later delivery or use.
5. Performance is reported as verified payload goodput together with camera, decoder, erasure, and fountain overhead—after the security pipeline succeeds.
6. Browser and Rust implementations share protocol fixtures and exact-byte interoperability tests.
7. Transport remains pluggable so faster QR, color codes, or future codecs do not change the trust contract.

That combination is a strong systems contribution. It is not yet proof of global novelty; a formal literature and patent review plus empirical evaluation remains necessary.

## Why this could become important

The large opportunity is not consumer file sharing. It is making a manual security-boundary crossing behave like a small, inspectable protocol instead of an informal copy operation.

- **A visible policy enforcement point:** the receiver decides what may cross, regardless of what the sender claims.
- **Less persistent transfer media:** there is no USB filesystem carrying residual files between hosts.
- **Interoperability:** AGX can become a stable contract shared by browser demos, native tools, managed workstations, and dedicated appliances.
- **Measurable operations:** every run can report goodput, loss, decision, and evidence rather than “copy succeeded.”
- **A research platform:** the same harness can evaluate transport, trust, operator behavior, content transformation, and one-way deployment trade-offs.

If it succeeds, GlassBridge is not “a QR app.” It is an open boundary protocol with an optical reference transport.

## Public-release checklist

### Required to say “open source”

- [x] Select and commit a project-wide OSI-approved license.
- [x] Update package and Cargo metadata with the chosen SPDX identifier.
- [x] Preserve adapted-code and bundled-library notices.
- [x] Publish contribution and security policies.
- [x] Exclude secrets, private data, internal conversations, and generated work directories.

### Required for a credible research-preview launch

- [x] Runnable public laptop-to-phone demo.
- [x] Honest status and explicit non-goals.
- [x] Primary-source prior-art attribution.
- [x] Deterministic Rust/browser vectors and automated tests.
- [x] Exportable receiver-side measurement record.
- [ ] Physical device-matrix dataset with raw runs and failures.
- [ ] Reproducible tagged release with checksums, SBOM, and provenance.
- [ ] Independent reproduction instructions tested on a clean machine.

### Recommended community readiness

- [x] Code of conduct.
- [x] Bug, performance-result, feature/research, and private-security routes.
- [x] Private vulnerability reporting enabled on GitHub.
- [x] Dependabot version/security updates configured for npm, Cargo, and GitHub Actions.
- [x] `CITATION.cff` with repository-level software citation metadata.
- [x] Maintainer-led governance and protocol-change process.
- [x] Support routing, CODEOWNERS, and guided issue configuration.

## License decision and commercial optionality

Project-authored GlassBridge code and materials are licensed under the **Apache License 2.0**. It is OSI-approved, permissive, familiar to companies, compatible with the project’s current MIT/Apache dependencies, and includes an express patent license from contributors. Bundled and adapted third-party components retain their own license terms and attribution; see [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and `third_party/`.

Apache-2.0 does not prevent the copyright holders from building paid products or services, licensing separately owned future work under different terms, raising investment, or selling copyright, trademarks, and other business assets in an acquisition. Copyright permissions for versions already distributed under Apache-2.0 remain available under those terms; Section 3 separately defines patent-license termination when a licensee institutes specified patent litigation. Outside contributors retain any copyright they own in their contributions, so a later exclusive relicensing strategy may require a contributor agreement; adding one should be a deliberate legal and community decision, not a retroactive assumption.

If the specification later moves to a standards process, add an explicit specification contribution/IPR policy with qualified legal review. This review is technical guidance, not legal advice or a freedom-to-operate opinion.
