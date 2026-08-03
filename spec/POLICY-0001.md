# POLICY-0001: Local default-deny import policy

Status: **experimental milestone snapshot**

## Purpose

A cryptographically valid AGX envelope is necessary but not sufficient for import. The receiver loads a bounded local policy and evaluates every verified envelope before the quarantine/import API can be called.

The Rust type system represents a successful decision as an `Authorization`. The import workflow accepts that type rather than a bare `VerifiedEnvelope`, making accidental signature-only import harder.

## Policy fields

Policy JSON is limited to 64 KiB, rejects unknown fields, and contains:

- version and policy identifier;
- exact target boundary;
- allowed directions, purposes, media types, and signer key identifiers;
- maximum payload size;
- minimum accepted sequence; and
- whether human approval is required.

Lists are sorted and deduplicated before deterministic CBOR encoding. The AGX manifest binds SHA-256 over that encoding, so a receiver cannot silently apply a semantically different policy with the same identifier.

## Evaluation order and stable codes

The engine fails closed at the first denial:

| Code | Meaning |
| --- | --- |
| `GB-ALLOW` | Every implemented check passed |
| `GB-DENY-POLICY-ID` | Loaded and signed policy identifiers differ |
| `GB-DENY-POLICY-DIGEST` | Loaded policy semantics differ from the signed digest |
| `GB-DENY-BOUNDARY` | Boundary is not allowed |
| `GB-DENY-DIRECTION` | Direction is not allowed |
| `GB-DENY-PURPOSE` | Purpose is not allowed |
| `GB-DENY-MEDIA-TYPE` | Media type is not allowed |
| `GB-DENY-SIGNER` | Signer key identifier is not allowed |
| `GB-DENY-SIZE` | Payload exceeds the policy ceiling |
| `GB-DENY-SEQUENCE-FLOOR` | Sequence is below the policy minimum |
| `GB-DENY-REPLAY` | Envelope identifier was previously imported |
| `GB-DENY-ROLLBACK` | Sequence does not advance the high-water mark |

## Persistent state

After an approved import succeeds, the receiver records:

- the 16-byte envelope identifier in a bounded replay set; and
- the sequence high-water mark keyed by boundary, policy identifier, and purpose.

State is written to a sibling temporary file, synchronized, and renamed. A failure to save state after payload import is surfaced but is not yet automatically recovered. The current implementation assumes a single receiver process; concurrent locking is a future requirement.

## Non-goals

This policy is not yet a signed distributable policy bundle. It does not implement delegated roles, quorum, trusted time, expiration, key rotation, revocation, content scanners, CDR, or product-specific firmware semantics.
