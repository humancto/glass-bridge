# Milestone 9: governed phone release

Milestone 9 moves the ordinary-phone receiver beyond cryptographic decoding. A
successfully reconstructed file now passes a local default-deny decision, remains
quarantined in memory, requires explicit release approval, enters bounded replay
state, and produces receiver-signed evidence before browser save/share exposure.

## Demonstration

Use the same public sender and receiver:

```text
Laptop sender: https://humancto.github.io/glass-bridge/send.html
Phone receiver: https://humancto.github.io/glass-bridge/receive.html
```

After the optical scan reaches full rank:

1. The phone verifies deterministic AGX/CBOR, COSE Ed25519, the paired sender,
   boundary, payload length, and SHA-256.
2. The phone independently recomputes the installed `browser-sender/v1` policy
   digest and enforces purpose, 256 KiB size, and a bounded freshness window.
3. A previously released envelope identifier is denied before approval.
4. The phone displays **Verified. Held for approval.** No download exists yet.
5. Select **Approve release & create signed receipt**.
6. The phone creates or reuses a persistent receiver receipt identity, signs the
   release receipt, reserves replay state, and only then opens save/share.
7. Preserve the `.receipt.cose`, human-readable receipt JSON, and receiver public
   key with the transferred file.

The COSE evidence can be checked by the independent Rust verifier:

```bash
cargo run --locked -p glassbridge-cli -- receipt-verify \
  --receipt glassbridge.receipt.cose \
  --receiver-public-key glassbridge.receiver.public
```

## Receiver state machine

```text
UNPAIRED
   │ pairing key + boundary
   ▼
PAIRED ──camera──▶ SCANNING ──full rank──▶ VERIFYING
                                                │
                             crypto or policy deny ──▶ ERROR
                                                │ allow + fresh
                                                ▼
                                         QUARANTINED
                                                │ operator approval
                                                ▼
                                           RELEASING
                                     receipt + replay reservation
                                                ▼
                                            RELEASED
```

There is no transition from `VERIFYING` directly to a downloadable file.

## Installed browser policy

The local phone profile allows only:

- policy identifier `browser-sender/v1`;
- purpose `ad-hoc-file-transfer`;
- the Rust `Policy` digest over inbound direction, exact identifier, boundary,
  purpose, media type, paired signer key identifier, 256 KiB limit, sequence floor,
  and required approval;
- payloads no larger than 256 KiB;
- creation times no more than 24 hours old; and
- creation times no more than 10 minutes ahead of the receiver clock.

The paired sender and boundary checks remain part of cryptographic verification.
Policy denial codes are stable strings such as `GB-DENY-POLICY-DIGEST`,
`GB-DENY-STALE`, and `GB-DENY-REPLAY`.

## Replay persistence

The receiver stores only envelope identifier, sender key identifier, and release
time in local storage. It never stores payload bytes or sender secrets. The ledger
is schema-validated, rejects unknown or duplicate fields, fails closed when
malformed, uses the Web Locks API when available, and retains at most 256 entries.

This blocks accidental and ordinary same-origin replay. It does not survive site
data deletion, malicious browser rollback, a compromised origin, or all concurrent
tabs on browsers without Web Locks.

## Signed evidence

The receiver creates a persistent WebCrypto Ed25519 identity. Its private key is
non-extractable and stored by structured clone in IndexedDB; its public key is
exportable. The signed COSE receipt carries the envelope and payload identifiers,
boundary, policy, safe release name, receiver key identifier, observation time,
and optical frame counts.

The event is deliberately `release-authorized`, not `imported`. A web page cannot
prove that an operating-system share target persisted or accepted the file. See
[BROWSER-RECEIPT-0001](../spec/BROWSER-RECEIPT-0001.md).

## Browser hardening

- App shells now ship a restrictive meta-delivered Content Security Policy with
  same-origin scripts, connections, manifests, and workers.
- Referrer data is suppressed by policy.
- Untrusted transferred content is never rendered inline; it is only offered as
  a download/share attachment after approval.
- The service worker caches only same-origin static build assets.
- Progress rendering no longer needs a data-derived inline style attribute.

GitHub Pages does not provide repository-controlled response headers. Meta CSP
cannot set `frame-ancestors`, `X-Content-Type-Options`, or `Permissions-Policy`;
a production deployment must set those at a controlled edge or appliance.

## Verification gates

- positive and negative local-policy tests;
- hostile persisted replay-state tests;
- duplicate envelope denial tests;
- non-extractable WebCrypto receiver key test;
- COSE receipt structure and independent Ed25519 verification;
- existing Rust/browser AGX and AGF1 interoperability vectors;
- strict TypeScript production build and offline service-worker build;
- dependency audit and complete Rust workspace checks; and
- real-browser phone-sized state and console verification.

## Remaining production work

- provisioned organizational sender trust instead of pairing-only session trust;
- signed policy bundles, role delegation, rotation, revocation, and quorum;
- protected monotonic replay/rollback state and crash-safe native quarantine;
- content inspection, malware scanning, and CDR hooks;
- hardware-backed receiver identity and receipt-log continuity;
- response-header CSP, clickjacking, permissions, and MIME-sniffing controls;
- adaptive transport, resume, larger files, and published physical goodput; and
- independent security assessment and certification where required.
