#[cfg(feature = "test-vectors")]
use agx_core::{Direction, EnvelopeRequest, Policy, create_signed_envelope_with_id, key_id};
#[cfg(feature = "test-vectors")]
use ed25519_dalek::SigningKey;

#[cfg(not(feature = "test-vectors"))]
fn main() {
    eprintln!("run with --features test-vectors");
}

#[cfg(feature = "test-vectors")]
fn main() {
    let signing_key = SigningKey::from_bytes(&[0x11; 32]);
    let policy = Policy {
        version: 1,
        id: "golden-firmware-in/v1".into(),
        boundary: "golden-lab/firmware-in".into(),
        allowed_directions: vec![Direction::Inbound],
        allowed_purposes: vec!["firmware-update".into()],
        allowed_media_types: vec!["application/octet-stream".into()],
        allowed_signer_key_ids: vec![hex::encode(key_id(&signing_key.verifying_key()))],
        max_payload_bytes: 4096,
        minimum_sequence: 7,
        require_approval: true,
    };
    let payload = b"GlassBridge AGX/1 golden vector\n";
    let request = EnvelopeRequest {
        payload,
        boundary: &policy.boundary,
        direction: Direction::Inbound,
        purpose: "firmware-update",
        policy_id: &policy.id,
        policy_digest: policy.digest().expect("encode policy"),
        display_name: "golden.bin",
        media_type: "application/octet-stream",
        sequence: 7,
        created_unix: 1_786_003_200,
    };
    let envelope = create_signed_envelope_with_id(
        &request,
        &signing_key,
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    )
    .expect("create vector");
    let mut tampered = envelope.clone();
    *tampered.last_mut().expect("envelope has payload") ^= 1;

    println!("secret={}", hex::encode(signing_key.to_bytes()));
    println!(
        "public={}",
        hex::encode(signing_key.verifying_key().to_bytes())
    );
    println!("valid={}", hex::encode(envelope));
    println!("tampered={}", hex::encode(tampered));
    println!(
        "policy={}",
        serde_json::to_string_pretty(&policy).expect("serialize policy")
    );
}
