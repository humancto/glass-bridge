# Milestone 1: signed lossy-loopback vertical slice

Milestone 1 makes the trust path executable before adding QR rendering or camera capture.

## Demonstrated path

```text
sample bytes
  -> deterministic CBOR manifest
  -> Ed25519 COSE_Sign1 authorization
  -> AGX outer envelope
  -> systematic + XOR repair frames
  -> deterministic loss/corruption/duplication/reordering
  -> CRC rejection + rank-based reconstruction
  -> signature/boundary/length/SHA-256 verification
  -> generated quarantine path
  -> explicit approval
  -> atomic import under a generated name
  -> receiver-signed import receipt
```

Run it with:

```bash
cargo run --locked -p glassbridge-cli -- demo
```

Every run uses fresh sender and receiver keys and writes its evidence under a unique `demo-output/run-*` directory. This directory is ignored by Git.

## Implemented controls

- 64 MiB envelope payload ceiling and bounded frame dimensions
- definite-length, integer-keyed CBOR with canonical re-encoding checks
- Ed25519 signatures in COSE_Sign1 protected headers
- signed target boundary, direction, purpose, policy identifier, sequence, object length, and digest
- exact expected-boundary enforcement
- default-deny policy checks for policy digest, signer, direction, purpose, media type, size, sequence floor, replay, and rollback
- persistent envelope replay cache and per-boundary/policy/purpose sequence high-water marks
- CRC rejection before fountain-equation admission
- rank-based recovery that tolerates dropped, reordered, duplicated, and corrupt frames
- generated receiver paths; sender display names are retained only as untrusted metadata
- create-new writes, file synchronization, quarantine journal, and same-filesystem rename into import
- distinct sender authorization and receiver receipt keys
- signed receipt semantics that say `imported`, not `delivered` or `executed`

## Tests

The Rust suite currently covers:

- successful sign/verify;
- payload tampering;
- wrong-boundary rejection;
- recovery through loss, corruption, duplicates, and reordering;
- insufficient-rank failure;
- CRC corruption rejection;
- path-traversal display names; and
- quarantine-only versus approved-import behavior and receipt verification.

## Deliberate limitations

This milestone is not an optical transfer product yet.

- Frames are byte arrays in a deterministic simulator, not QR images or camera observations.
- The repair code is a bounded random linear XOR prototype, not LT, RaptorQ, or a performance claim.
- Envelope and payload processing are in memory.
- Raw 32-byte key files are for prototype ergonomics; production key storage and offline trust bundles are not implemented.
- Policy files are local unsigned configuration; signed policy distribution, role delegation, quorum, expiration, and rotation are not implemented.
- Policy-state updates assume a single receiver process; inter-process locking and transactional recovery are not implemented.
- The quarantine workspace is assumed to be a dedicated directory controlled by the receiver process; hardened component-by-component no-follow traversal remains future work.
- Crash recovery across the final rename and receipt-write boundary is not yet implemented; the journals expose state but do not automatically repair it.
- There is no encryption, scanning, CDR, GUI, camera isolation, radio inventory, or hardware one-way guarantee.
- Wire compatibility is experimental until golden vectors and a formal review freeze AGX/1.

## Next implementation gate

Before physical QR transport, the next gate is to freeze the serialized AGX-OT frame header, add a file/video codec abstraction, and integrate the first real QR encoder/decoder behind it. Golden AGX vectors, persistent policy/replay state, and explicit denial codes are now implemented.
