# Contributing

GlassBridge is a runnable pre-alpha research prototype. Contributions that improve the threat model, protocol clarity, hostile-input handling, physical measurement, reproducibility, or implementation assurance are welcome.

Before proposing a large change, open an issue describing the problem, security assumptions, intended result, and evidence needed to evaluate it.

> [!IMPORTANT]
> The repository is public for technical review but does not yet have a project-wide license. Discuss proposals and contribute reproducible device results now; third-party code should not be merged until the owner selects the project license and contribution terms are unambiguous.

## Good first contributions

- reproduce the 144 KiB capacity ladder on a new laptop/phone pair;
- add a negative vector for a malformed, oversized, replayed, or mixed-session object;
- improve primary-source prior-art references;
- clarify a protocol invariant or security limitation; or
- make a benchmark easier to reproduce without changing its claim.

Use the guided issue forms. Performance contributions must include every repeated
run, including failures, and use synthetic non-sensitive data.

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

## Development setup

Requirements: Node.js 22.13+ and Rust 1.91.1.

```bash
npm ci
npm test

cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-targets --all-features --locked
```

Use `npm run dev` for the browser application. Use only generated or synthetic
files in public demonstrations and test artifacts.

## Pull requests

Keep each pull request focused on one user, protocol, security, or research
outcome. Complete the repository template and identify the claim type:

- **Implemented behavior:** tested functionality present in the branch.
- **Measured result:** raw, reproducible evidence is attached.
- **Hypothesis or design proposal:** a claim that still requires implementation
  or evaluation.
- **Documentation only:** no behavior or measurement changed.

Wire-format changes require versioning, positive and negative vectors, and an
explicit compatibility plan. Security-relevant changes require the affected
threats, failure behavior, and resource ceilings. Performance changes require a
frozen baseline and like-for-like device conditions.

The maintainer may ask to split a change when implementation, benchmark claims,
and protocol redesign cannot be reviewed independently. See
[GOVERNANCE.md](GOVERNANCE.md) for the decision model and the pull request
template for the minimum evidence expected.
