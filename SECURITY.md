# Security policy

## Current status

GlassBridge is currently a runnable pre-alpha research project. The repository does not provide a production optical transfer system, certified data diode, malware scanner, or cross-domain solution. Do not rely on it to protect sensitive or operational environments.

Implemented prototype properties are identified in the milestone documents, but none has been independently evaluated for production use.

The current browser security review is published in
[docs/open-source-security-audit.md](docs/open-source-security-audit.md). Report
suspected vulnerabilities privately through GitHub Security Advisories when
private vulnerability reporting is available; do not include sensitive details
in a public issue.

The generated production npm dependency license inventory is published in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md). It is review evidence, not a
legal opinion or a guarantee that a dependency is secure.

## Browser sender warning

The hosted sender processes the selected file in browser memory and does not
implement a file-upload endpoint. It creates a fresh Ed25519 signing key for
each prepared transfer, signs a canonical AGX/1 envelope, and erases its local
secret-key byte array after signing. Browser, extension, operating-system,
dependency, deployment, and memory-lifetime behavior remain in scope; JavaScript
erasure is not a hardware-backed destruction guarantee.

The pairing fingerprint is derived only from the ephemeral sender public key.
The scanned pairing transcript also declares the boundary, session, transport
profile, packing, visual PHY, and target rate. The receiver parses and stores
that transcript canonically and enforces the paired session plus the profile's
codec and symbol size, but the fingerprint does not cover those declarations.
The transcript and target rate remain operator-confirmed session inputs; they
are not proof of a person, company, device, release role, or long-lived
organizational identity. A production deployment needs provisioned trust roots,
signed role delegation, rotation, revocation, protected replay state, and local
policy.

The current browser sender is limited to one file of at most 256 KiB and does
not provide optical confidentiality. Anyone with a view of the display may
capture the file. Use only synthetic, non-sensitive test data. For stronger
air-gap experiments, preload and pin reviewed static assets on a dedicated
machine rather than treating a newly fetched web application as trusted code.

## Browser receiver warning

The hosted receiver is an installable web research prototype. Its pairing QR
pins one sender public key and one boundary for the session, but that is
explicit trust-on-first-use, not an organizational trust bundle or identity
proof. Compare the displayed fingerprint through an independent trusted
channel before accepting important data.

The receiver treats camera and saved-frame input as hostile, bounds optical
reconstruction, verifies canonical AGX encoding, Ed25519 provenance, boundary,
length, and SHA-256, and then applies a pinned local browser policy. An allowed
payload remains quarantined in memory until explicit operator approval. The
receiver reserves its envelope identifier in a bounded replay ledger and creates
a COSE-signed `release-authorized` receipt before exposing save/share.

Replay entries in local storage are schema-validated and malformed state fails
closed. The receiver also refuses a new release when all 256 ledger entries are
occupied instead of silently evicting history. Browser storage is not a trusted
monotonic database: clearing or rolling back site data can remove replay history.
Web Locks serialize the release reservation where supported; other browsers
retain a concurrent-tab race.

The persistent receiver receipt key is a non-extractable WebCrypto Ed25519 private
key stored in IndexedDB. Each generated receipt signature is verified against its
public key before release completes, and malformed or mismatched stored key pairs
fail closed rather than being silently replaced. This prevents ordinary raw-key
export but is not a hardware-backed or organizational identity: same-origin code
can ask it to sign, and clearing site data destroys it. The receipt proves that
receiver policy authorized browser exposure. It is not proof that an
operating-system share target persisted, opened, or accepted the file.

The receiver does not inspect file content, render it inline, scan it for malware,
or perform content disarm and reconstruction. Browser, same-origin deployment,
service-worker, camera-library, extension, and operating-system vulnerabilities
remain in scope. Use only synthetic, non-sensitive test data on ordinary devices.

The optional saved-frame diagnostic accepts PNG and JPEG only. Before creating an
object URL or invoking the image/QR decoder, it checks magic, header dimensions,
and a complete-selection budget: at most 160 files, 16 MiB per file, 128 MiB
combined, 8,192 pixels per dimension, 24 megapixels per image, and 256 megapixels
combined. Validation and decoding are sequential, object URLs are revoked, and a
generation guard makes stop/reset cancel stale work before it can change receiver
state. These ceilings reduce availability risk; header validation is not full
image-integrity validation, and an allowed selection can still be resource
intensive. They do not make browser or ZXing image parsers safe for hostile media.
Re-export questionable frames and use a disposable test environment.

An operator stop transitions camera or saved-frame acquisition to the fail-closed
error screen, where a failure record can be exported. Failure records use
`source_mode` to distinguish `camera` evidence from `saved-frames` diagnostics;
saved-frame results are not physical camera-performance evidence.

The static app shells include a restrictive meta-delivered Content Security
Policy and a no-referrer policy. The generated service worker uses a
content-addressed cache, intercepts only exact same-origin build URLs from its
precache allowlist, and does not turn arbitrary same-origin responses into cached
application assets. GitHub Pages does not expose repository-controlled response
headers, and meta CSP cannot enforce `frame-ancestors`, MIME nosniff, or
Permissions Policy. A production deployment must set those controls at a managed
edge or dedicated receiver appliance.

## Untrusted video warning

`video-receive` invokes the locally installed FFmpeg executable on a prerecorded file. GlassBridge bounds the input to a regular local file of at most 512 MiB, limits probing, duration, extracted frame count, PNG size, image dimensions, and QR reconstruction count, and disables non-file FFmpeg protocols. FFmpeg is still a large native media parser and is not sandboxed or given a wall-clock process timeout in this milestone. Do not process hostile recordings outside a disposable research environment.

## Reporting a vulnerability

Please use the repository's **Security** tab to report vulnerabilities through a private GitHub security advisory. Do not disclose a suspected vulnerability in a public issue before maintainers have had a reasonable opportunity to investigate it.

Include the affected revision, expected and observed behavior, reproduction steps, and potential impact. Never include real secrets, operational data, or sensitive artifacts in a report.
