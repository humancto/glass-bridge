# BROWSER-RECEIPT-0001: phone release authorization receipt

Status: **experimental milestone snapshot**  
Version: **1**  
Wire compatibility: **not yet stable**

## Purpose

The browser receiver emits a COSE-signed receipt only after a complete AGX
signature and digest check, an allowing local policy decision, explicit operator
approval, and a successful replay-state reservation. The event is
`release-authorized`.

This event means the receiver authorized the browser to expose the verified
payload to its save/share mechanism. It does not claim that the operating system
persisted the file, that another application accepted it, or that the payload was
executed. Native receivers that can observe an atomic move into a controlled
destination continue to use the stronger `imported` event.

## COSE structure

The receipt is the payload of a COSE Sign1 structure using Ed25519. The protected
header contains algorithm `EdDSA` (`-8`) and an 8-byte key identifier equal to the
first eight bytes of SHA-256 over the raw receiver public key. The unprotected
header is empty.

The external additional authenticated data is:

```text
GlassBridge/AGX1/import-receipt
```

The existing receipt AAD is retained so the Rust receipt verifier can verify this
experimental event without a parallel cryptographic format. Verifiers must still
interpret the event string before assigning meaning.

## Deterministic payload

The signed payload is a definite-length CBOR map with ascending integer keys:

| Key | Type | Meaning |
| --- | --- | --- |
| `1` | unsigned integer | Receipt version, exactly `1` |
| `2` | text | Event, exactly `release-authorized` |
| `3` | 16-byte string | AGX envelope identifier |
| `4` | 32-byte string | Verified payload SHA-256 |
| `5` | text | Receiving boundary |
| `6` | text | Applied policy identifier |
| `7` | text | Safe browser release name |
| `8` | unsigned integer | Receiver observation time, Unix seconds |
| `9` | 8-byte string | Receiver key identifier |
| `10` | unsigned integer | Accepted optical frames |
| `11` | unsigned integer | Rejected optical frames |

The map shape intentionally matches the milestone-1 import receipt. Unknown,
duplicate, reordered, indefinite, or non-deterministic fields are rejected by
strict verifiers.

## Browser receiver identity

The browser creates one Ed25519 receipt key pair per origin and stores the
non-extractable private `CryptoKey` in IndexedDB. The raw public key is exportable
and accompanies the receipt. The key is persistent for audit correlation but is
not a hardware-backed organizational identity. Same-origin script executing in
the receiver can ask the key to sign, and clearing site data destroys the identity.

## Replay order

The browser receiver performs release in this order:

1. verify the AGX signature, manifest, payload length, and payload digest;
2. evaluate the installed local browser policy;
3. reject an envelope identifier already present in the local replay ledger;
4. require explicit operator approval;
5. create the signed release receipt;
6. reserve the envelope identifier in the bounded replay ledger; and
7. expose the file and receipt artifacts to save/share.

The ledger holds at most 256 entries and treats malformed persisted state as a
fail-closed condition. Browser storage can be cleared or rolled back and is not a
trusted monotonic counter. A native production receiver needs protected policy
state and concurrency-safe persistence.
