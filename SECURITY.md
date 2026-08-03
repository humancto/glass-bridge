# Security policy

## Current status

GlassBridge is currently a research and design project. The repository does not yet provide a production optical transfer system, certified data diode, malware scanner, or cross-domain solution. Do not rely on it to protect sensitive or operational environments.

Implemented prototype properties are identified in the milestone documents, but none has been independently evaluated for production use.

## Untrusted video warning

`video-receive` invokes the locally installed FFmpeg executable on a prerecorded file. GlassBridge bounds the input to a regular local file of at most 512 MiB, limits probing, duration, extracted frame count, PNG size, image dimensions, and QR reconstruction count, and disables non-file FFmpeg protocols. FFmpeg is still a large native media parser and is not sandboxed or given a wall-clock process timeout in this milestone. Do not process hostile recordings outside a disposable research environment.

## Reporting a vulnerability

Please use the repository's **Security** tab to report vulnerabilities through a private GitHub security advisory. Do not disclose a suspected vulnerability in a public issue before maintainers have had a reasonable opportunity to investigate it.

Include the affected revision, expected and observed behavior, reproduction steps, and potential impact. Never include real secrets, operational data, or sensitive artifacts in a report.
