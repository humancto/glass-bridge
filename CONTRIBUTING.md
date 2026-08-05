# Contributing

GlassBridge is a runnable pre-alpha research prototype. Contributions that improve the threat model, protocol clarity, hostile-input handling, physical measurement, reproducibility, or implementation assurance are welcome.

Before proposing a large change, open an issue describing the problem, security assumptions, intended result, and evidence needed to evaluate it.

## Expectations

- Distinguish implemented behavior, measured results, and hypotheses.
- Cite primary sources for security, standards, prior-art, and performance claims.
- Include positive and negative tests for changed behavior.
- Keep wire-format changes versioned and accompanied by deterministic vectors.
- Document resource ceilings and failure behavior for parsers and decoders.
- Do not implement new cryptographic primitives.
- Do not include private data, internal conversations, credentials, or proprietary artifacts.
- Treat physical throughput, security, and novelty as claims that require reproducible evidence.
- For a device result, attach the exported `glassbridge-capacity/3` JSON and include every repeated run, including failures. Version 3 separates effective file goodput from optical packing reduction.

Run `npm test` and the relevant locked Rust checks before submitting changes. See the pull request template for the minimum evidence expected.
