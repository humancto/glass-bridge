# Contributing

GlassBridge is in its design-baseline phase. Contributions that improve the threat model, protocol clarity, testability, reproducibility, or implementation foundations are welcome.

Before proposing a large change, open an issue describing the problem, security assumptions, intended result, and evidence needed to evaluate it.

## Expectations

- Distinguish implemented behavior, measured results, and hypotheses.
- Cite primary sources for security, standards, prior-art, and performance claims.
- Include positive and negative tests for changed behavior.
- Keep wire-format changes versioned and accompanied by deterministic vectors.
- Document resource ceilings and failure behavior for parsers and decoders.
- Do not implement new cryptographic primitives.
- Do not include private data, internal conversations, credentials, or proprietary artifacts.

Run `npm test` before submitting changes to the design site.
