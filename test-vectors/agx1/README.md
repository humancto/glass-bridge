# AGX/1 golden vectors

These files freeze the milestone-2 deterministic encoding and rejection behavior.

- `payload.txt` is the signed object.
- `policy.json` is normalized and hashed into the manifest.
- `test-only-secret.hex` and `sender-public.hex` reproduce the Ed25519 signature.
- `valid-envelope.hex` must verify successfully.
- `tampered-payload.hex` changes the final payload byte while retaining the original signed manifest and must fail with a payload-digest mismatch.

The secret key is deliberately public test material consisting entirely of `0x11` bytes. It MUST NOT be used outside interoperability tests.

Regenerate the vectors with:

```bash
cargo run -p agx-core --example generate_vectors --features test-vectors
```

Review any byte change as a protocol compatibility change.
