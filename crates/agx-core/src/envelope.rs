use std::convert::TryInto;

use coset::{
    CborSerializable, CoseSign1, CoseSign1Builder, HeaderBuilder, RegisteredLabelWithPrivate, iana,
};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use minicbor::{Decoder, Encoder};
use serde::Serialize;
use sha2::{Digest, Sha256};
use thiserror::Error;

const OUTER_MAGIC: &str = "AGX1";
const MANIFEST_AAD: &[u8] = b"GlassBridge/AGX1/manifest";
const MAX_ENVELOPE_BYTES: usize = 64 * 1024 * 1024 + 64 * 1024;
const MAX_PAYLOAD_BYTES: usize = 64 * 1024 * 1024;
const MAX_TEXT_BYTES: usize = 512;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    Inbound,
    Outbound,
}

impl Direction {
    const fn code(self) -> u8 {
        match self {
            Self::Inbound => 1,
            Self::Outbound => 2,
        }
    }

    const fn from_code(code: u8) -> Option<Self> {
        match code {
            1 => Some(Self::Inbound),
            2 => Some(Self::Outbound),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ObjectManifest {
    pub id: u64,
    pub display_name: String,
    pub media_type: String,
    pub length: u64,
    pub sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Manifest {
    pub version: u16,
    pub envelope_id: String,
    pub boundary: String,
    pub direction: Direction,
    pub purpose: String,
    pub policy_id: String,
    pub policy_digest: String,
    pub sequence: u64,
    pub created_unix: u64,
    pub objects: Vec<ObjectManifest>,
}

#[derive(Debug, Clone)]
pub struct EnvelopeRequest<'a> {
    pub payload: &'a [u8],
    pub boundary: &'a str,
    pub direction: Direction,
    pub purpose: &'a str,
    pub policy_id: &'a str,
    pub display_name: &'a str,
    pub media_type: &'a str,
    pub sequence: u64,
    pub created_unix: u64,
}

#[derive(Debug, Clone)]
pub struct VerifiedEnvelope {
    pub manifest: Manifest,
    pub payload: Vec<u8>,
    pub signer_key_id: String,
}

#[derive(Debug, Error)]
pub enum EnvelopeError {
    #[error("AGX input exceeds its configured size limit")]
    SizeLimit,
    #[error("required field `{0}` is empty or too long")]
    InvalidText(&'static str),
    #[error("invalid AGX envelope: {0}")]
    InvalidEnvelope(String),
    #[error("non-deterministic CBOR encoding is not accepted")]
    NonCanonical,
    #[error("unsupported signature algorithm")]
    UnsupportedAlgorithm,
    #[error("signer key identifier does not match the supplied public key")]
    KeyIdMismatch,
    #[error("signature verification failed")]
    Signature,
    #[error("payload length does not match the signed manifest")]
    LengthMismatch,
    #[error("payload digest does not match the signed manifest")]
    DigestMismatch,
    #[error("envelope targets boundary `{actual}`, expected `{expected}`")]
    BoundaryMismatch { actual: String, expected: String },
    #[error("invalid Ed25519 key: {0}")]
    InvalidKey(String),
    #[error("operating-system randomness failed: {0}")]
    Random(String),
}

/// Generates an Ed25519 signing key from operating-system randomness.
///
/// # Errors
///
/// Returns [`EnvelopeError::Random`] when the operating system cannot provide
/// cryptographically secure random bytes.
pub fn generate_signing_key() -> Result<SigningKey, EnvelopeError> {
    let mut seed = [0_u8; 32];
    getrandom::fill(&mut seed).map_err(|error| EnvelopeError::Random(error.to_string()))?;
    Ok(SigningKey::from_bytes(&seed))
}

/// Loads an Ed25519 signing key from its raw 32-byte secret representation.
///
/// # Errors
///
/// Returns [`EnvelopeError::InvalidKey`] when `bytes` is not exactly 32 bytes.
pub fn signing_key_from_bytes(bytes: &[u8]) -> Result<SigningKey, EnvelopeError> {
    let seed: [u8; 32] = bytes
        .try_into()
        .map_err(|_| EnvelopeError::InvalidKey("secret keys must be exactly 32 bytes".into()))?;
    Ok(SigningKey::from_bytes(&seed))
}

/// Loads an Ed25519 verifying key from its raw 32-byte representation.
///
/// # Errors
///
/// Returns [`EnvelopeError::InvalidKey`] when the bytes are malformed.
pub fn verifying_key_from_bytes(bytes: &[u8]) -> Result<VerifyingKey, EnvelopeError> {
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| EnvelopeError::InvalidKey("public keys must be exactly 32 bytes".into()))?;
    VerifyingKey::from_bytes(&key).map_err(|error| EnvelopeError::InvalidKey(error.to_string()))
}

#[must_use]
pub fn key_id(verifying_key: &VerifyingKey) -> [u8; 8] {
    let digest = Sha256::digest(verifying_key.as_bytes());
    let mut identifier = [0_u8; 8];
    identifier.copy_from_slice(&digest[..8]);
    identifier
}

/// Creates a bounded, signed AGX/1 envelope for a single payload object.
///
/// # Errors
///
/// Returns an error when fields exceed protocol limits, randomness fails, or
/// deterministic CBOR/COSE serialization cannot be completed.
pub fn create_signed_envelope(
    request: &EnvelopeRequest<'_>,
    signing_key: &SigningKey,
) -> Result<Vec<u8>, EnvelopeError> {
    validate_request(request)?;

    let mut envelope_id = [0_u8; 16];
    getrandom::fill(&mut envelope_id).map_err(|error| EnvelopeError::Random(error.to_string()))?;

    let payload_digest: [u8; 32] = Sha256::digest(request.payload).into();
    let policy_digest: [u8; 32] = Sha256::digest(request.policy_id.as_bytes()).into();
    let object = ObjectManifest {
        id: 1,
        display_name: request.display_name.to_owned(),
        media_type: request.media_type.to_owned(),
        length: request.payload.len() as u64,
        sha256: hex::encode(payload_digest),
    };
    let manifest = Manifest {
        version: 1,
        envelope_id: hex::encode(envelope_id),
        boundary: request.boundary.to_owned(),
        direction: request.direction,
        purpose: request.purpose.to_owned(),
        policy_id: request.policy_id.to_owned(),
        policy_digest: hex::encode(policy_digest),
        sequence: request.sequence,
        created_unix: request.created_unix,
        objects: vec![object],
    };
    let manifest_bytes = encode_manifest(&manifest)?;
    let cose_bytes = sign_cose_payload(&manifest_bytes, signing_key, MANIFEST_AAD)?;
    encode_outer(&cose_bytes, request.payload)
}

/// Verifies an AGX/1 signature, canonical encoding, boundary, length, and hash.
///
/// # Errors
///
/// Returns an error for malformed or oversized input, unsupported algorithms,
/// signature failure, boundary mismatch, or payload integrity failure.
pub fn verify_signed_envelope(
    envelope_bytes: &[u8],
    verifying_key: &VerifyingKey,
    expected_boundary: Option<&str>,
) -> Result<VerifiedEnvelope, EnvelopeError> {
    if envelope_bytes.len() > MAX_ENVELOPE_BYTES {
        return Err(EnvelopeError::SizeLimit);
    }
    let (cose_bytes, payload) = decode_outer(envelope_bytes)?;
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(EnvelopeError::SizeLimit);
    }

    let manifest_bytes = verify_cose_payload(&cose_bytes, verifying_key, MANIFEST_AAD)?;
    let manifest = decode_manifest(&manifest_bytes)?;
    let canonical = encode_manifest(&manifest)?;
    if canonical != manifest_bytes {
        return Err(EnvelopeError::NonCanonical);
    }

    let object = manifest
        .objects
        .first()
        .ok_or_else(|| EnvelopeError::InvalidEnvelope("manifest has no object".into()))?;
    if manifest.objects.len() != 1 || object.id != 1 {
        return Err(EnvelopeError::InvalidEnvelope(
            "milestone 1 requires exactly one object with id 1".into(),
        ));
    }
    if object.length != payload.len() as u64 {
        return Err(EnvelopeError::LengthMismatch);
    }
    let actual_digest = hex::encode(Sha256::digest(&payload));
    if object.sha256 != actual_digest {
        return Err(EnvelopeError::DigestMismatch);
    }
    if let Some(expected) = expected_boundary
        && manifest.boundary != expected
    {
        return Err(EnvelopeError::BoundaryMismatch {
            actual: manifest.boundary,
            expected: expected.to_owned(),
        });
    }

    Ok(VerifiedEnvelope {
        manifest,
        payload,
        signer_key_id: hex::encode(key_id(verifying_key)),
    })
}

pub(crate) fn sign_cose_payload(
    payload: &[u8],
    signing_key: &SigningKey,
    aad: &[u8],
) -> Result<Vec<u8>, EnvelopeError> {
    let protected = HeaderBuilder::new()
        .algorithm(iana::Algorithm::EdDSA)
        .key_id(key_id(&signing_key.verifying_key()).to_vec())
        .build();
    CoseSign1Builder::new()
        .protected(protected)
        .payload(payload.to_vec())
        .create_signature(aad, |message| signing_key.sign(message).to_bytes().to_vec())
        .build()
        .to_vec()
        .map_err(|error| EnvelopeError::InvalidEnvelope(error.to_string()))
}

pub(crate) fn verify_cose_payload(
    cose_bytes: &[u8],
    verifying_key: &VerifyingKey,
    aad: &[u8],
) -> Result<Vec<u8>, EnvelopeError> {
    let sign1 = CoseSign1::from_slice(cose_bytes)
        .map_err(|error| EnvelopeError::InvalidEnvelope(error.to_string()))?;
    if sign1.protected.header.alg
        != Some(RegisteredLabelWithPrivate::Assigned(iana::Algorithm::EdDSA))
    {
        return Err(EnvelopeError::UnsupportedAlgorithm);
    }
    if sign1.protected.header.key_id != key_id(verifying_key) {
        return Err(EnvelopeError::KeyIdMismatch);
    }
    if !sign1.unprotected.is_empty() {
        return Err(EnvelopeError::InvalidEnvelope(
            "unprotected COSE headers are not accepted".into(),
        ));
    }
    sign1
        .verify_signature(aad, |signature, message| {
            let signature = Signature::try_from(signature)?;
            verifying_key.verify_strict(message, &signature)
        })
        .map_err(|_| EnvelopeError::Signature)?;
    sign1
        .payload
        .ok_or_else(|| EnvelopeError::InvalidEnvelope("detached payload is not supported".into()))
}

fn validate_request(request: &EnvelopeRequest<'_>) -> Result<(), EnvelopeError> {
    if request.payload.len() > MAX_PAYLOAD_BYTES {
        return Err(EnvelopeError::SizeLimit);
    }
    for (name, value) in [
        ("boundary", request.boundary),
        ("purpose", request.purpose),
        ("policy_id", request.policy_id),
        ("display_name", request.display_name),
        ("media_type", request.media_type),
    ] {
        if value.is_empty() || value.len() > MAX_TEXT_BYTES || value.chars().any(char::is_control) {
            return Err(EnvelopeError::InvalidText(name));
        }
    }
    Ok(())
}

fn encode_outer(cose_bytes: &[u8], payload: &[u8]) -> Result<Vec<u8>, EnvelopeError> {
    let mut encoder = Encoder::new(Vec::new());
    encoder
        .map(3)
        .and_then(|value| value.u8(1))
        .and_then(|value| value.str(OUTER_MAGIC))
        .and_then(|value| value.u8(2))
        .and_then(|value| value.bytes(cose_bytes))
        .and_then(|value| value.u8(3))
        .and_then(|value| value.bytes(payload))
        .map_err(|error| EnvelopeError::InvalidEnvelope(error.to_string()))?;
    Ok(encoder.into_writer())
}

fn decode_outer(bytes: &[u8]) -> Result<(Vec<u8>, Vec<u8>), EnvelopeError> {
    let mut decoder = Decoder::new(bytes);
    let map_len = decoder
        .map()
        .map_err(decode_error)?
        .ok_or_else(|| EnvelopeError::InvalidEnvelope("indefinite maps are forbidden".into()))?;
    if map_len != 3 || decoder.u8().map_err(decode_error)? != 1 {
        return Err(EnvelopeError::InvalidEnvelope("invalid outer map".into()));
    }
    if decoder.str().map_err(decode_error)? != OUTER_MAGIC {
        return Err(EnvelopeError::InvalidEnvelope("invalid AGX magic".into()));
    }
    if decoder.u8().map_err(decode_error)? != 2 {
        return Err(EnvelopeError::InvalidEnvelope("missing COSE object".into()));
    }
    let cose = decoder.bytes().map_err(decode_error)?.to_vec();
    if decoder.u8().map_err(decode_error)? != 3 {
        return Err(EnvelopeError::InvalidEnvelope("missing payload".into()));
    }
    let payload = decoder.bytes().map_err(decode_error)?.to_vec();
    if decoder.position() != bytes.len() {
        return Err(EnvelopeError::InvalidEnvelope("trailing bytes".into()));
    }
    if encode_outer(&cose, &payload)? != bytes {
        return Err(EnvelopeError::NonCanonical);
    }
    Ok((cose, payload))
}

fn encode_manifest(manifest: &Manifest) -> Result<Vec<u8>, EnvelopeError> {
    let envelope_id = decode_fixed::<16>(&manifest.envelope_id, "envelope id")?;
    let policy_digest = decode_fixed::<32>(&manifest.policy_digest, "policy digest")?;
    let mut encoder = Encoder::new(Vec::new());
    encoder.map(10).map_err(encode_error)?;
    encoder
        .u8(1)
        .and_then(|value| value.u16(manifest.version))
        .map_err(encode_error)?;
    encoder
        .u8(2)
        .and_then(|value| value.bytes(&envelope_id))
        .map_err(encode_error)?;
    encoder
        .u8(3)
        .and_then(|value| value.str(&manifest.boundary))
        .map_err(encode_error)?;
    encoder
        .u8(4)
        .and_then(|value| value.u8(manifest.direction.code()))
        .map_err(encode_error)?;
    encoder
        .u8(5)
        .and_then(|value| value.str(&manifest.purpose))
        .map_err(encode_error)?;
    encoder
        .u8(6)
        .and_then(|value| value.str(&manifest.policy_id))
        .map_err(encode_error)?;
    encoder
        .u8(7)
        .and_then(|value| value.bytes(&policy_digest))
        .map_err(encode_error)?;
    encoder
        .u8(8)
        .and_then(|value| value.u64(manifest.sequence))
        .map_err(encode_error)?;
    encoder
        .u8(9)
        .and_then(|value| value.u64(manifest.created_unix))
        .map_err(encode_error)?;
    encoder
        .u8(10)
        .and_then(|value| value.array(manifest.objects.len() as u64))
        .map_err(encode_error)?;
    for object in &manifest.objects {
        let digest = decode_fixed::<32>(&object.sha256, "object digest")?;
        encoder.map(5).map_err(encode_error)?;
        encoder
            .u8(1)
            .and_then(|value| value.u64(object.id))
            .map_err(encode_error)?;
        encoder
            .u8(2)
            .and_then(|value| value.str(&object.display_name))
            .map_err(encode_error)?;
        encoder
            .u8(3)
            .and_then(|value| value.str(&object.media_type))
            .map_err(encode_error)?;
        encoder
            .u8(4)
            .and_then(|value| value.u64(object.length))
            .map_err(encode_error)?;
        encoder
            .u8(5)
            .and_then(|value| value.bytes(&digest))
            .map_err(encode_error)?;
    }
    Ok(encoder.into_writer())
}

fn decode_manifest(bytes: &[u8]) -> Result<Manifest, EnvelopeError> {
    let mut decoder = Decoder::new(bytes);
    require_map(&mut decoder, 10)?;
    require_key(&mut decoder, 1)?;
    let version = decoder.u16().map_err(decode_error)?;
    if version != 1 {
        return Err(EnvelopeError::InvalidEnvelope(format!(
            "unsupported manifest version {version}"
        )));
    }
    require_key(&mut decoder, 2)?;
    let envelope_id = read_fixed_hex::<16>(&mut decoder, "envelope id")?;
    require_key(&mut decoder, 3)?;
    let boundary = read_text(&mut decoder, "boundary")?;
    require_key(&mut decoder, 4)?;
    let direction = Direction::from_code(decoder.u8().map_err(decode_error)?)
        .ok_or_else(|| EnvelopeError::InvalidEnvelope("invalid direction".into()))?;
    require_key(&mut decoder, 5)?;
    let purpose = read_text(&mut decoder, "purpose")?;
    require_key(&mut decoder, 6)?;
    let policy_id = read_text(&mut decoder, "policy_id")?;
    require_key(&mut decoder, 7)?;
    let policy_digest = read_fixed_hex::<32>(&mut decoder, "policy digest")?;
    require_key(&mut decoder, 8)?;
    let sequence = decoder.u64().map_err(decode_error)?;
    require_key(&mut decoder, 9)?;
    let created_unix = decoder.u64().map_err(decode_error)?;
    require_key(&mut decoder, 10)?;
    let object_count = decoder
        .array()
        .map_err(decode_error)?
        .ok_or_else(|| EnvelopeError::InvalidEnvelope("indefinite arrays are forbidden".into()))?;
    if object_count != 1 {
        return Err(EnvelopeError::InvalidEnvelope(
            "milestone 1 supports exactly one object".into(),
        ));
    }
    let object = decode_object(&mut decoder)?;
    if decoder.position() != bytes.len() {
        return Err(EnvelopeError::InvalidEnvelope(
            "trailing manifest bytes".into(),
        ));
    }
    Ok(Manifest {
        version,
        envelope_id,
        boundary,
        direction,
        purpose,
        policy_id,
        policy_digest,
        sequence,
        created_unix,
        objects: vec![object],
    })
}

fn decode_object(decoder: &mut Decoder<'_>) -> Result<ObjectManifest, EnvelopeError> {
    require_map(decoder, 5)?;
    require_key(decoder, 1)?;
    let id = decoder.u64().map_err(decode_error)?;
    require_key(decoder, 2)?;
    let display_name = read_text(decoder, "display_name")?;
    require_key(decoder, 3)?;
    let media_type = read_text(decoder, "media_type")?;
    require_key(decoder, 4)?;
    let length = decoder.u64().map_err(decode_error)?;
    require_key(decoder, 5)?;
    let sha256 = read_fixed_hex::<32>(decoder, "object digest")?;
    Ok(ObjectManifest {
        id,
        display_name,
        media_type,
        length,
        sha256,
    })
}

fn require_map(decoder: &mut Decoder<'_>, expected: u64) -> Result<(), EnvelopeError> {
    let actual = decoder
        .map()
        .map_err(decode_error)?
        .ok_or_else(|| EnvelopeError::InvalidEnvelope("indefinite maps are forbidden".into()))?;
    if actual != expected {
        return Err(EnvelopeError::InvalidEnvelope(format!(
            "expected map length {expected}, got {actual}"
        )));
    }
    Ok(())
}

fn require_key(decoder: &mut Decoder<'_>, expected: u8) -> Result<(), EnvelopeError> {
    let actual = decoder.u8().map_err(decode_error)?;
    if actual != expected {
        return Err(EnvelopeError::NonCanonical);
    }
    Ok(())
}

fn read_text(decoder: &mut Decoder<'_>, name: &'static str) -> Result<String, EnvelopeError> {
    let value = decoder.str().map_err(decode_error)?;
    if value.is_empty() || value.len() > MAX_TEXT_BYTES || value.chars().any(char::is_control) {
        return Err(EnvelopeError::InvalidText(name));
    }
    Ok(value.to_owned())
}

fn read_fixed_hex<const N: usize>(
    decoder: &mut Decoder<'_>,
    name: &'static str,
) -> Result<String, EnvelopeError> {
    let bytes = decoder.bytes().map_err(decode_error)?;
    if bytes.len() != N {
        return Err(EnvelopeError::InvalidEnvelope(format!(
            "{name} must be {N} bytes"
        )));
    }
    Ok(hex::encode(bytes))
}

fn decode_fixed<const N: usize>(value: &str, name: &str) -> Result<[u8; N], EnvelopeError> {
    let bytes = hex::decode(value)
        .map_err(|_| EnvelopeError::InvalidEnvelope(format!("invalid {name}")))?;
    bytes
        .try_into()
        .map_err(|_| EnvelopeError::InvalidEnvelope(format!("invalid {name} length")))
}

fn encode_error<E: std::fmt::Display>(error: E) -> EnvelopeError {
    EnvelopeError::InvalidEnvelope(error.to_string())
}

#[allow(clippy::needless_pass_by_value)]
fn decode_error(error: minicbor::decode::Error) -> EnvelopeError {
    EnvelopeError::InvalidEnvelope(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(payload: &[u8]) -> EnvelopeRequest<'_> {
        EnvelopeRequest {
            payload,
            boundary: "lab-7/firmware-in",
            direction: Direction::Inbound,
            purpose: "firmware-update",
            policy_id: "firmware-in/v1",
            display_name: "controller.bin",
            media_type: "application/octet-stream",
            sequence: 42,
            created_unix: 1_786_000_000,
        }
    }

    #[test]
    fn signs_and_verifies_an_envelope() {
        let signing_key = generate_signing_key().unwrap();
        let encoded = create_signed_envelope(&request(b"approved firmware"), &signing_key).unwrap();
        let verified = verify_signed_envelope(
            &encoded,
            &signing_key.verifying_key(),
            Some("lab-7/firmware-in"),
        )
        .unwrap();
        assert_eq!(verified.payload, b"approved firmware");
        assert_eq!(verified.manifest.objects[0].length, 17);
    }

    #[test]
    fn rejects_payload_tampering() {
        let signing_key = generate_signing_key().unwrap();
        let mut encoded =
            create_signed_envelope(&request(b"approved firmware"), &signing_key).unwrap();
        let last = encoded.last_mut().unwrap();
        *last ^= 0x01;
        let error =
            verify_signed_envelope(&encoded, &signing_key.verifying_key(), None).unwrap_err();
        assert!(matches!(error, EnvelopeError::DigestMismatch));
    }

    #[test]
    fn rejects_wrong_boundary() {
        let signing_key = generate_signing_key().unwrap();
        let encoded = create_signed_envelope(&request(b"approved firmware"), &signing_key).unwrap();
        let error = verify_signed_envelope(
            &encoded,
            &signing_key.verifying_key(),
            Some("different-boundary"),
        )
        .unwrap_err();
        assert!(matches!(error, EnvelopeError::BoundaryMismatch { .. }));
    }
}
