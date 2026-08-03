# Milestone 2: policy authorization, replay state, and golden vectors

Milestone 2 changes the receiver contract from “valid signature can import” to “valid signature can be evaluated.” Only an `Authorization` returned by the default-deny policy engine can enter the import workflow.

## See the allow path

```bash
cargo run --locked -p glassbridge-cli -- demo
```

The output now includes:

```text
signature + digest:  VERIFIED
policy decision:     GB-ALLOW
```

The run directory contains the exact `policy.json` bound into the signed manifest and `receiver-workspace/policy-state.json` containing the imported envelope identifier and sequence high-water mark.

## See the replay denial

Run `receive` a second time against the same demo envelope, keys, policy, and receiver workspace. The command fails before quarantine/import with:

```text
GB-DENY-REPLAY: envelope id has already been imported
```

The policy engine also has stable denials for policy identifier/digest, boundary, direction, purpose, media type, signer, size, sequence floor, and rollback.

## Policy binding

Policy JSON is normalized by sorting and deduplicating allowlists, then encoded as deterministic CBOR. SHA-256 over that representation is signed inside the AGX manifest. The receiver therefore checks both the human-facing policy identifier and the exact implemented policy semantics.

Current policy state is intentionally local and bounded:

- at most 4,096 imported envelope identifiers;
- at most 128 high-water sequence keys;
- high-water keys are SHA-256 over length-prefixed boundary, policy identifier, and purpose fields; and
- state files are limited to 1 MiB and reject unknown fields.

## Golden vectors

[`test-vectors/agx1`](../test-vectors/agx1/) contains a fixed payload, policy, test-only Ed25519 key pair, valid envelope, and payload-tampered negative envelope. Tests regenerate the valid bytes and require an exact match, verify the valid vector, and require the tampered vector to fail with a digest mismatch.

Regeneration is explicit:

```bash
cargo run -p agx-core --example generate_vectors --features test-vectors
```

Any byte change is treated as a protocol compatibility event requiring review.

## Remaining limitations

- Policies are local files, not signed trust bundles.
- State assumes one receiver process; there is no inter-process lock.
- State persistence and payload import are not one cross-file transaction.
- Denials are structured and visible but do not yet emit signed denial receipts.
- Product/version semantics and multi-role authorization are not implemented.
- The transport remains a simulator rather than a physical QR channel.
