# Security policy

## Current status

GlassBridge is currently a research and design project. The repository does not yet provide a production optical transfer system, certified data diode, malware scanner, or cross-domain solution. Do not rely on it to protect sensitive or operational environments.

Implemented prototype properties are identified in the milestone documents, but none has been independently evaluated for production use.

## Browser receiver warning

The hosted receiver is an installable web research prototype. Its pairing QR
pins one sender public key and one boundary for the session, but that is
explicit trust-on-first-use, not an organizational trust bundle or identity
proof. Compare the displayed fingerprint through an independent trusted
channel before accepting important data.

The receiver treats camera and uploaded-frame input as hostile, bounds optical
reconstruction, verifies canonical AGX encoding, Ed25519 provenance, boundary,
length, and SHA-256 before exposing a download. It does not yet run the full
desktop policy, quarantine, replay, content inspection, or signed-receipt
workflow. Browser and camera-library vulnerabilities remain in scope. Use only
synthetic, non-sensitive test data on ordinary devices.

## Untrusted video warning

`video-receive` invokes the locally installed FFmpeg executable on a prerecorded file. GlassBridge bounds the input to a regular local file of at most 512 MiB, limits probing, duration, extracted frame count, PNG size, image dimensions, and QR reconstruction count, and disables non-file FFmpeg protocols. FFmpeg is still a large native media parser and is not sandboxed or given a wall-clock process timeout in this milestone. Do not process hostile recordings outside a disposable research environment.

## Reporting a vulnerability

Please use the repository's **Security** tab to report vulnerabilities through a private GitHub security advisory. Do not disclose a suspected vulnerability in a public issue before maintainers have had a reasonable opportunity to investigate it.

Include the affected revision, expected and observed behavior, reproduction steps, and potential impact. Never include real secrets, operational data, or sensitive artifacts in a report.
