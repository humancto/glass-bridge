# GlassBridge browser security audit

**Audit date:** 2026-08-04  
**Baseline:** `41c240a`  
**Scope:** public React/TypeScript sender and receiver, HTML entry points, service worker, browser storage, CI/release configuration, dependency and secret checks. The Rust implementation was built, tested, linted, and dependency-audited, but this document is not a line-by-line Rust security review.

## Executive summary

No confirmed critical or high-severity frontend vulnerability was found in this review. The application avoids raw HTML sinks and remote scripts, uses a restrictive meta-delivered Content Security Policy, strictly validates pairing state and optical frames, bounds reconstruction, verifies the signed envelope before policy/release, revokes object URLs, and uses reproducible lockfiles in CI.

The public demo remains unsuitable as a production security boundary. Three medium-severity assurance gaps are intentional prototype limitations: GitHub Pages cannot provide the required response-header posture, pairing is trust on first use rather than organizational provenance, and replay/receipt state lives in browser-managed storage. Dependency automation and production release provenance also need work before an open-source security-product launch.

## Findings

### GB-WEB-001 — Required response security headers are absent

- **Rule ID:** REACT-HEADERS-001 / JS-CSP-001
- **Severity:** Medium
- **Location:** `index.html:5-6`, `send.html:5-6`, `receive.html:5-6`; deployed GitHub Pages responses
- **Evidence:** each HTML shell places a restrictive CSP meta element before scripts and includes `referrer=no-referrer`. Runtime responses from `https://humancto.github.io/glass-bridge/` and `/receive.html` did not include `Content-Security-Policy`, `X-Content-Type-Options`, clickjacking protection, `Referrer-Policy`, or `Permissions-Policy` headers.
- **Impact:** meta CSP cannot enforce `frame-ancestors`; the public app can be framed, and header-only protections such as MIME nosniff and Permissions Policy are unavailable. This matters more for a UI that asks an operator to confirm trust and release a file.
- **Fix:** production deployments should use a managed origin/edge that sets an enforced CSP response header with `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, a least-privilege `Permissions-Policy`, and HSTS after domain ownership is stable.
- **Mitigation:** keep the current early, restrictive meta CSP and no-referrer tag for GitHub Pages; label that origin a public research demo only.
- **False-positive notes:** GitHub Pages may add platform headers over time. Recheck deployed responses before closing this finding; the required headers were not present on the audit date.

### GB-TRUST-001 — Pairing authenticates a session, not an organization

- **Rule ID:** project threat model / storage and untrusted-input review
- **Severity:** Medium for a production boundary; expected behavior for the public demo
- **Location:** `src/receiver/ReceiverApp.tsx:79-120`, `src/receiver/agx.ts:39-79`
- **Evidence:** the public key, boundary, optical session, and profile are accepted from the scanned URL fragment, schema-validated, stored in session storage, and then used as the verification trust anchor. No pre-provisioned organizational root authorizes that key.
- **Impact:** an attacker who can replace the pairing display or deceive the operator before fingerprint confirmation can establish their own session key as trusted. Successful envelope verification then proves consistency with that paired key, not publisher identity.
- **Fix:** add locally provisioned trust bundles, named roles, delegation, rotation, revocation, and signed policy bundles. Require the ephemeral transfer key to chain to an authorized release role or remove ephemeral identity from production profiles.
- **Mitigation:** compare the fingerprint over an independent trusted path and use only synthetic data on the hosted demo. Continue calling the flow trust on first use.
- **False-positive notes:** the session data is strictly parsed and the URL fragment is removed from browser history after ingestion. This finding is about trust bootstrap semantics, not an input-validation failure.

### GB-STATE-001 — Replay and receipt identity are browser-resettable

- **Rule ID:** JS-STORAGE-001 / project replay requirements
- **Severity:** Medium for a production boundary; expected behavior for the public demo
- **Location:** `src/receiver/replay.ts:19-81`, `src/receiver/receipt.ts:98-142`
- **Evidence:** the bounded replay ledger is stored in `localStorage`. The receiver’s non-extractable WebCrypto Ed25519 key is held in IndexedDB. Clearing or rolling back site data destroys both controls; browsers without Web Locks retain a concurrent-tab reservation race.
- **Impact:** a previously released envelope may be accepted again after state reset, and receipt identity can silently change. This prevents strong rollback, monotonicity, and durable receiver-identity claims.
- **Fix:** use protected monotonic state and a provisioned receiver identity in the native/appliance profile. Treat browser replay state as UX protection only.
- **Mitigation:** the ledger fails closed on malformed state, is limited to 256 entries, and uses an exclusive Web Lock where supported. Receipt wording correctly limits the event to browser release authorization.
- **False-positive notes:** no authentication/session secret is stored in web storage. The finding is not secret exfiltration; it is insufficient persistence assurance.

### GB-SUPPLY-001 — Automated dependency response is incomplete

- **Rule ID:** REACT-SUPPLY-001
- **Severity:** Low
- **Location:** `package-lock.json`, `Cargo.lock`, `.github/workflows/ci.yml:14-29`, GitHub repository security settings
- **Evidence:** CI uses `npm ci` and locked Cargo commands. Manual audit on 2026-08-04 reported zero npm vulnerabilities across 117 dependencies and zero RustSec vulnerabilities across 92 locked Rust dependencies. GitHub reported Dependabot security updates disabled, and CI does not run npm/Rust advisory checks.
- **Impact:** a newly disclosed dependency vulnerability may not automatically open an update or fail a pull request.
- **Fix:** add Dependabot configuration, enable security updates and private vulnerability reporting, and add pinned advisory scanning to scheduled/CI workflows.
- **Mitigation:** preserve lockfiles, continue `npm ci`/`cargo --locked`, and record audit results before every release.
- **False-positive notes:** GitHub may still generate alerts separately from automated security-update pull requests. Verify repository settings after adding configuration.

### GB-CSP-001 — Receiver needs a narrow WebAssembly CSP exception

- **Rule ID:** JS-CSP-002
- **Severity:** Low / accepted
- **Location:** `receive.html:5`
- **Evidence:** the receiver uses `script-src 'self' 'wasm-unsafe-eval'`; the sender and homepage use only `script-src 'self'`. ZXing-C++ decoding is delivered as same-origin WebAssembly.
- **Impact:** WebAssembly compilation is allowed on the receiver origin. This is narrower than `unsafe-eval`, but it expands executable capability relative to the other pages.
- **Fix:** retain only while required by supported browsers and the decoder toolchain; test removal periodically. Keep all scripts and WASM same-origin and release-pinned.
- **Mitigation:** no third-party runtime script origins are allowed, and `object-src 'none'`, `base-uri 'none'`, and `form-action 'none'` remain enforced by the meta policy.
- **False-positive notes:** this exception is an explicit functional requirement, not evidence of string-to-code execution in application code.

## Positive controls verified

- No `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, or `new Function` use was found in application code.
- No remote runtime script or stylesheet is loaded. Browser dependencies are built and served same-origin.
- External links opened in a new tab use `rel="noreferrer"`.
- Pairing data and browser storage are parsed through strict shape and value validation before use.
- Uploaded diagnostic images are decoded as images, never rendered as active HTML/SVG, and their object URLs are revoked.
- Download object URLs are revoked after a bounded delay.
- Optical frames have bounded text/binary sizes, CRC checks, session binding, unique-frame caps, and reconstruction limits.
- AGX verification requires canonical CBOR, a fixed Ed25519 COSE profile, signer-key match, boundary match, declared length, and SHA-256 before policy and exposure.
- The replay ledger validates its schema, size, field formats, and duplicate identifiers and fails closed on malformed data.
- The service worker is same-origin only, uses versioned caches, removes old caches, uses network-first navigation to prevent mixed releases, and caches no authenticated API responses.
- CI uses `npm ci`, `Cargo.lock`, `--locked`, formatting, clippy with denied warnings, unit/integration tests, deterministic demos, and optical/video loopbacks.
- Repository secret-pattern scanning found no committed production credential or private-key pattern. The checked-in `test-only-secret.hex` is clearly scoped test-vector material.
- `npm audit` and `cargo audit` were clean on the audit date.

## Verification commands

```bash
npm audit --audit-level=low
cargo audit
npm test
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-targets --all-features --locked
curl -sS -D - -o /dev/null https://humancto.github.io/glass-bridge/
```

## Release recommendation

The findings do not block publishing source for research review. They do block representing the hosted browser app as a production control. Release it as **pre-alpha optical security research**, invite protocol and implementation review, and keep the production claim gated on managed hosting, provisioned trust, protected state, fuzzing, reproducible releases, and physical device evidence.
