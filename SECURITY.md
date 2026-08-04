# Security policy

## Current status

GlassBridge is currently a research and design project. The repository does not yet provide a production optical transfer system, certified data diode, malware scanner, or cross-domain solution. Do not rely on it to protect sensitive or operational environments.

Implemented prototype properties are identified in the milestone documents, but none has been independently evaluated for production use.

## Browser sender warning

The hosted sender processes the selected file in browser memory and does not
implement a file-upload endpoint. It creates a fresh Ed25519 signing key for
each prepared transfer, signs a canonical AGX/1 envelope, and erases its local
secret-key byte array after signing. Browser, extension, operating-system,
dependency, deployment, and memory-lifetime behavior remain in scope; JavaScript
erasure is not a hardware-backed destruction guarantee.

The pairing fingerprint establishes trust in that ephemeral session key only.
It does not establish a person, company, device, release role, or long-lived
organizational identity. A production deployment needs provisioned trust roots,
signed role delegation, rotation, revocation, replay state, and local policy.

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

The receiver treats camera and uploaded-frame input as hostile, bounds optical
reconstruction, verifies canonical AGX encoding, Ed25519 provenance, boundary,
length, and SHA-256, and then applies a pinned local browser policy. An allowed
payload remains quarantined in memory until explicit operator approval. The
receiver reserves its envelope identifier in a bounded replay ledger and creates
a COSE-signed `release-authorized` receipt before exposing save/share.

Replay entries in local storage are schema-validated and malformed state fails
closed, but browser storage is not a trusted monotonic database. Clearing or
rolling back site data can remove replay history. Web Locks serialize the release
reservation where supported; other browsers retain a concurrent-tab race.

The persistent receiver receipt key is a non-extractable WebCrypto Ed25519 private
key stored in IndexedDB. This prevents ordinary raw-key export but is not a
hardware-backed or organizational identity: same-origin code can ask it to sign,
and clearing site data destroys it. The receipt proves that receiver policy
authorized browser exposure. It is not proof that an operating-system share target
persisted, opened, or accepted the file.

The receiver does not inspect file content, render it inline, scan it for malware,
or perform content disarm and reconstruction. Browser, same-origin deployment,
service-worker, camera-library, extension, and operating-system vulnerabilities
remain in scope. Use only synthetic, non-sensitive test data on ordinary devices.

The static app shells include a restrictive meta-delivered Content Security
Policy and a no-referrer policy. GitHub Pages does not expose repository-controlled
response headers, and meta CSP cannot enforce `frame-ancestors`, MIME nosniff, or
Permissions Policy. A production deployment must set those controls at a managed
edge or dedicated receiver appliance.

## Untrusted video warning

`video-receive` invokes the locally installed FFmpeg executable on a prerecorded file. GlassBridge bounds the input to a regular local file of at most 512 MiB, limits probing, duration, extracted frame count, PNG size, image dimensions, and QR reconstruction count, and disables non-file FFmpeg protocols. FFmpeg is still a large native media parser and is not sandboxed or given a wall-clock process timeout in this milestone. Do not process hostile recordings outside a disposable research environment.

## Reporting a vulnerability

Please use the repository's **Security** tab to report vulnerabilities through a private GitHub security advisory. Do not disclose a suspected vulnerability in a public issue before maintainers have had a reasonable opportunity to investigate it.

Include the affected revision, expected and observed behavior, reproduction steps, and potential impact. Never include real secrets, operational data, or sensitive artifacts in a report.
