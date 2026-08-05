## What changed

Describe the smallest user, protocol, security, or research outcome this change delivers.

## Claim type

- [ ] Implemented behavior
- [ ] Measured result (raw data attached)
- [ ] Hypothesis or design proposal
- [ ] Documentation only

## Security and compatibility

- [ ] Hostile inputs and resource ceilings were considered.
- [ ] Wire-format changes are versioned and include positive/negative vectors.
- [ ] No new cryptographic primitive was implemented from scratch.
- [ ] User data, secrets, internal conversations, and proprietary artifacts are absent.
- [ ] Receipt, trust, one-way, and air-gap wording does not overclaim.

## Verification

- [ ] `npm test`
- [ ] `cargo fmt --all -- --check` when Rust changed
- [ ] `cargo clippy --workspace --all-targets --all-features --locked -- -D warnings` when Rust changed
- [ ] `cargo test --workspace --all-targets --all-features --locked` when Rust changed

List any additional physical-device, browser, benchmark, fuzz, or interoperability evidence.
