# GlassBridge browser security audit

**Audit date:** 2026-08-17

**Baseline:** publication candidate at `FINAL_IMPLEMENTATION_SHA`; this token must be replaced with the exact reviewed implementation commit before publication

**Scope:** public React/TypeScript sender and receiver, untrusted optical and saved-image inputs, HTML shells, browser storage, service worker, dependency lockfiles, and CI/Pages workflows. The Rust workspace was built, tested, linted, and dependency-audited; this is not a line-by-line Rust security review.

## Executive summary

No confirmed critical or high-severity frontend vulnerability was found in this
source review and deterministic test pass. That is not an independent assessment
or production assurance. The application avoids raw HTML and string-to-code
sinks, loads no third-party runtime scripts, uses a restrictive meta-delivered
Content Security Policy, strictly parses pairing and optical data, bounds
reconstruction and decompression, verifies canonical AGX/COSE provenance and
exact payload bytes before local policy, keeps verified bytes in memory
quarantine, and requires explicit release.

Implementation findings discovered during this review were fixed and
regression-tested: stored pairing state no longer infers a lower protocol version
from missing fields; diagnostic image selections are bounded and cancellable
before object URLs or ZXing see them; the service worker handles only an exact
precache allowlist; the paired decoder enforces the expected codec and symbol
size; receipt keys and signatures are checked before release; and a full replay
ledger fails closed instead of evicting history. JavaScript and Rust dependency
audits are clean, all CI actions are immutable-SHA pinned, checkout credentials
are not persisted, the production npm license inventory is checked, and exported
record schemas are published with the site build.

The hosted demo is still unsuitable as a production security boundary. Four
medium-severity assurance gaps remain intentional prototype limitations: GitHub
Pages cannot provide the required response-header posture; pairing is trust on
first use rather than organizational provenance; replay/receipt state lacks
protected rollback resistance; and no physical device dataset yet proves the
camera-path performance claims. The narrow WebAssembly CSP exception remains an
accepted low-severity limitation.

## Open findings

### GB-WEB-001 — Required response security headers are absent

- **Rule ID:** REACT-HEADERS-001 / JS-CSP-001
- **Severity:** Medium
- **Location:** `index.html:5-6`, `send.html:5-6`, `receive.html:5-6`; deployed GitHub Pages responses
- **Evidence:** every HTML shell places a restrictive CSP meta element before scripts and includes `referrer=no-referrer`. Live responses from `https://humancto.github.io/glass-bridge/` and `/receive.html` on 2026-08-17 did not include an enforced `Content-Security-Policy` header, `X-Content-Type-Options`, clickjacking protection, `Referrer-Policy`, or `Permissions-Policy`.
- **Impact:** meta CSP cannot enforce `frame-ancestors`; the public app can be framed, and header-only MIME and permissions controls are unavailable. This matters for an interface that asks an operator to confirm trust and release a file.
- **Required production fix:** deploy reviewed, version-pinned assets from a managed origin that sets an enforced CSP header with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a least-privilege `Permissions-Policy`, and HSTS after domain ownership is stable.
- **Current mitigation:** retain the early restrictive meta CSP and no-referrer tag, and label GitHub Pages as a public research demo only.

### GB-TRUST-001 — Pairing authenticates a session, not an organization

- **Rule ID:** project threat model / trust bootstrap review
- **Severity:** Medium for a production boundary; expected for the public demo
- **Location:** `src/receiver/agx.ts:44-112`, `src/receiver/pairing-storage.ts:13-94`
- **Evidence:** the public key, boundary, optical session, profile, packing mode, visual PHY, and rate come from the scanned URL fragment. They are exact-schema parsed, stored in an exact canonical per-version serialization, and reparsed before use. The decoder enforces the paired session plus the selected profile's codec and symbol size. The displayed fingerprint, however, is a digest of the sender public key only; it does not cover the rest of the pairing transcript, and the target rate is an operator-declared measurement input rather than a cryptographically provisioned fact. No organizational root authorizes the transcript.
- **Impact:** replacing the pairing display or persuading the operator to confirm the wrong fingerprint can establish an attacker key or operator-selected channel parameters. Envelope verification then proves consistency with that paired key and boundary, not publisher identity or the truth of the declared rate.
- **Required production fix:** provision trust bundles, named roles, delegation, rotation, revocation, and signed policy. Require the transfer key to chain to an authorized release role.
- **Current mitigation:** compare the fingerprint over an independent trusted path, call the flow trust on first use, and use only synthetic data on the hosted demo.

### GB-STATE-001 — Replay and receipt identity are browser-resettable

- **Rule ID:** JS-STORAGE-001 / replay and evidence requirements
- **Severity:** Medium for a production boundary; expected for the public demo
- **Location:** `src/receiver/replay.ts:19-81`, `src/receiver/receipt.ts:98-142`
- **Evidence:** the bounded replay ledger is in `localStorage`; malformed state and a full 256-entry ledger fail closed. The non-extractable WebCrypto Ed25519 receipt key is in IndexedDB; stored key objects must have the expected Ed25519 type, extractability, and usage, and every new receipt signature is self-verified before release. Clearing or rolling back site data destroys both stores. Browsers without Web Locks retain a concurrent-tab reservation race.
- **Impact:** an old envelope may be accepted after state reset, and receipt identity changes when site data is cleared. This cannot support protected rollback, monotonicity, or durable appliance identity claims.
- **Required production fix:** protected monotonic replay state and a provisioned receiver identity in the native/appliance profile.
- **Current mitigation:** malformed ledger state fails closed, the ledger is bounded, Web Locks serialize release where supported, and receipt text limits the claim to browser release authorization.

### GB-PERF-001 — Physical camera performance is not yet proven

- **Rule ID:** release evidence / measurement-integrity review
- **Severity:** Medium assurance gap for a public performance claim
- **Location:** `src/receiver/capacity-measurement.ts`, `src/receiver/device-run-report.ts`, device-result issue form, and publication documentation
- **Evidence:** deterministic raster, transport, reconstruction, and benchmark tests exercise the implementation, but there is no complete predeclared physical phone/laptop run set. Receiver timing has no synchronized sender optical-start marker. Failure exports distinguish `source_mode: camera` from `source_mode: saved-frames`, and the UI labels current rates diagnostic.
- **Impact:** software ceilings and synthetic-frame throughput cannot establish phone-camera goodput, reliability, or superiority over prior systems. Saved-frame measurements could be mistaken for camera-path evidence if the source field is ignored.
- **Required publication fix:** publish every run from a predeclared named device pair, including operator stops and failures, validate the exported schemas, require `source_mode: camera`, and add a synchronized optical-start marker before comparative performance claims.
- **Current mitigation:** keep all rates diagnostic, prohibit “fastest” or record claims, and export failures from the fail-closed error screen.

### GB-CSP-001 — Receiver needs a narrow WebAssembly CSP exception

- **Rule ID:** JS-CSP-002
- **Severity:** Low / accepted
- **Location:** `receive.html:5`
- **Evidence:** the receiver permits `script-src 'self' 'wasm-unsafe-eval'` for same-origin ZXing-C++ WebAssembly; sender and homepage use only `script-src 'self'`.
- **Impact:** WebAssembly compilation expands executable capability relative to the other pages, though it is narrower than `unsafe-eval`.
- **Mitigation:** keep all runtime code same-origin, retain `object-src 'none'`, `base-uri 'none'`, and `form-action 'none'`, and periodically test whether supported browsers/tooling permit removal.

## Findings resolved during this review

### GB-FILE-001 — Saved-frame image decoding lacked bounded cancellation and resource ceilings — resolved

- **Former severity:** Medium availability risk
- **Fix:** `src/receiver/saved-frame-policy.ts` validates the entire selection before decoder import or object-URL creation. It accepts PNG/JPEG magic only and enforces 160 files, 16 MiB per file, 128 MiB combined compressed bytes, a 256 KiB JPEG header scan, 8,192 px per dimension, 24 MP per image, and 256 MP combined. A generation guard cancels stale validation/decoding after stop, reset, or a new run; decoding remains sequential and every object URL is revoked.
- **Tests:** `tests/saved-frame-policy.test.ts` covers the limits, malformed and disallowed formats, and cancellation; receiver flow checks cover operator-stop failure/export behavior.
- **Residual risk:** header checks are not full image-integrity validation, ZXing/browser image parsers remain in scope, and an allowed worst-case user-selected diagnostic set can still consume substantial time and memory. Use this path only with synthetic frames.

### GB-STORAGE-001 — Stored pairing version could be inferred from partial state — resolved

- **Former severity:** Low downgrade/confusion risk
- **Fix:** `BootstrapTrust` retains `pairingVersion`; `src/receiver/pairing-storage.ts` serializes exact version-specific fields, rejects missing or extra fields, reparses through the authoritative pairing parser, and requires byte-for-byte canonical serialization. The new session-storage key intentionally requires one fresh scan rather than consuming old inference-based records.
- **Tests:** `tests/pairing-storage.test.ts` covers all four versions, malformed JSON, non-object values, missing, extra, wrong-type, and v4 field-deletion cases.

### GB-SUPPLY-001 — Advisory scanning and immutable action pinning were missing — resolved

- **Former severity:** Low supply-chain hardening gap
- **Fix:** CI and Pages pin every action to an official full commit SHA, disable persisted checkout credentials, use least-privilege job permissions, run `npm audit --audit-level=high`, and use SHA-pinned `rustsec/audit-check`. Both build paths verify the deterministic production npm license inventory in [THIRD_PARTY_LICENSES.md](../THIRD_PARTY_LICENSES.md), while the site build publishes the canonical success/failure JSON schemas. Dependabot covers npm, Cargo, and GitHub Actions.
- **Evidence:** manual release-candidate audits reported zero npm vulnerabilities and zero RustSec advisories across 92 locked Rust dependencies.
- **Residual risk:** advisory databases and third-party build infrastructure are not proof of absence; reproducible builds, SBOMs, signed provenance, and clean-room release reproduction remain future gates.

## Positive controls verified

- No `dangerouslySetInnerHTML`, HTML-string DOM sinks, `eval`, `new Function`, remote runtime script, attacker-controlled navigation, application network fetch, or client-bundled production secret was found.
- External links opened in a new tab use `rel="noreferrer"`; transferred bytes are never rendered as active content.
- Pairing hashes and stored pairing records use exact, duplicate-resistant version schemas before entering trusted state.
- Paired decoders reject optical frames whose codec or symbol size differs from the selected profile; the declared target rate remains diagnostic input, not authenticated performance evidence.
- Saved diagnostic images are format- and resource-checked before object URLs/native image parsing, decoded sequentially, and every URL is revoked.
- Optical frames have text/binary size ceilings, exact CRC, session binding, unique-frame caps, bounded LT reconstruction, and fail-closed mixed-frame behavior.
- Optional gzip is pairing-bound, used only when smaller, mode-checked before decompression, and decompressed through a declared output ceiling.
- AGX verification requires canonical CBOR, fixed Ed25519 COSE parameters, signer-key match, boundary match, declared length, and SHA-256 before policy or file exposure.
- Verified bytes remain in memory quarantine until explicit human authorization; replay reservation and a receiver-signed, immediately self-verified `release-authorized` receipt precede save/share. Mismatched stored receipt keys fail closed.
- Operator stop cancels camera or saved-frame work, reaches the fail-closed error state, and offers an export whose `source_mode` preserves the evidence boundary.
- The content-addressed service worker intercepts only exact same-origin precached build URLs, deletes old application caches, and uses network-first navigation with an offline fallback to the matching precached shell.
- CI uses lockfiles, non-persistent checkout credentials, immutable action SHAs, advisory and license-inventory gates, published JSON schemas, TypeScript/build/tests, Rust format/clippy/tests, deterministic demos, and PNG/H.264 loopbacks.
- Secret-pattern review found no committed production credential or private key; `test-only-secret.hex` is scoped test-vector material.

## Verification commands

```bash
npm ci
npm run licenses:check
npm audit --audit-level=low
npm test
cargo audit
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-targets --all-features --locked
curl -sS -D - -o /dev/null https://humancto.github.io/glass-bridge/
```

## Release recommendation

The remaining findings do not block publishing source for research review. They
do block representing the hosted browser app as a production control or its
diagnostic timing as proven physical performance. Publish it as **pre-alpha
optical security research**, invite protocol and implementation review, and keep
production claims gated on managed hosting, provisioned trust, protected
rollback-resistant state, fuzzing, reproducible releases, independent review,
and complete physical device evidence.
