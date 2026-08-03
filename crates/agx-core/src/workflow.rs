use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use ed25519_dalek::{SigningKey, VerifyingKey};
use minicbor::{Decoder, Encoder};
use serde::Serialize;
use thiserror::Error;

use crate::envelope::{
    EnvelopeError, VerifiedEnvelope, key_id, sign_cose_payload, verify_cose_payload,
};

const RECEIPT_AAD: &[u8] = b"GlassBridge/AGX1/import-receipt";
const MAX_RECEIPT_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ImportReceipt {
    pub version: u16,
    pub event: String,
    pub envelope_id: String,
    pub payload_sha256: String,
    pub boundary: String,
    pub policy_id: String,
    pub imported_name: String,
    pub observed_unix: u64,
    pub receiver_key_id: String,
    pub accepted_frames: u64,
    pub rejected_frames: u64,
}

#[derive(Debug, Clone)]
pub struct WorkflowOutcome {
    pub quarantine_dir: PathBuf,
    pub imported_path: Option<PathBuf>,
    pub receipt_path: Option<PathBuf>,
    pub receipt: Option<ImportReceipt>,
}

#[derive(Debug, Error)]
pub enum WorkflowError {
    #[error("workflow I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("envelope operation failed: {0}")]
    Envelope(#[from] EnvelopeError),
    #[error("envelope id is not a valid bounded identifier")]
    InvalidEnvelopeId,
    #[error("receipt is invalid: {0}")]
    InvalidReceipt(String),
}

#[allow(clippy::too_many_arguments)]
/// Writes verified bytes into a generated quarantine path and optionally imports them.
///
/// When approved, the function emits both a human-readable JSON receipt and an
/// authoritative COSE-signed CBOR receipt.
///
/// # Errors
///
/// Returns an error for unsafe identifiers, replayed destinations, filesystem
/// failures, or receipt serialization/signing failures.
pub fn import_verified(
    verified: &VerifiedEnvelope,
    workspace: &Path,
    approve: bool,
    receiver_signing_key: &SigningKey,
    observed_unix: u64,
    accepted_frames: usize,
    rejected_frames: usize,
) -> Result<WorkflowOutcome, WorkflowError> {
    let envelope_id = &verified.manifest.envelope_id;
    if envelope_id.len() != 32 || !envelope_id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(WorkflowError::InvalidEnvelopeId);
    }

    let quarantine_root = workspace.join("quarantine");
    let imports_root = workspace.join("imports");
    let receipts_root = workspace.join("receipts");
    fs::create_dir_all(&quarantine_root)?;
    fs::create_dir_all(&imports_root)?;
    fs::create_dir_all(&receipts_root)?;

    let quarantine_dir = quarantine_root.join(envelope_id);
    fs::create_dir(&quarantine_dir)?;
    let quarantined_payload = quarantine_dir.join("object-0001.part");
    write_new(&quarantined_payload, &verified.payload)?;

    let received_record = serde_json::json!({
        "state": "verified_quarantine",
        "envelope_id": envelope_id,
        "boundary": verified.manifest.boundary,
        "policy_id": verified.manifest.policy_id,
        "display_name_untrusted": verified.manifest.objects[0].display_name,
        "payload_sha256": verified.manifest.objects[0].sha256,
        "accepted_frames": accepted_frames,
        "rejected_frames": rejected_frames,
        "observed_unix": observed_unix,
    });
    write_new(
        &quarantine_dir.join("received.json"),
        &serde_json::to_vec_pretty(&received_record)
            .map_err(|error| WorkflowError::InvalidReceipt(error.to_string()))?,
    )?;

    if !approve {
        return Ok(WorkflowOutcome {
            quarantine_dir,
            imported_path: None,
            receipt_path: None,
            receipt: None,
        });
    }

    let imported_name = format!("{envelope_id}-object-0001.bin");
    let imported_path = imports_root.join(&imported_name);
    if imported_path.exists() {
        return Err(WorkflowError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "import destination already exists",
        )));
    }
    fs::rename(&quarantined_payload, &imported_path)?;

    let receipt = ImportReceipt {
        version: 1,
        event: "imported".into(),
        envelope_id: envelope_id.clone(),
        payload_sha256: verified.manifest.objects[0].sha256.clone(),
        boundary: verified.manifest.boundary.clone(),
        policy_id: verified.manifest.policy_id.clone(),
        imported_name,
        observed_unix,
        receiver_key_id: hex::encode(key_id(&receiver_signing_key.verifying_key())),
        accepted_frames: accepted_frames as u64,
        rejected_frames: rejected_frames as u64,
    };
    let receipt_cbor = encode_receipt(&receipt)?;
    let signed_receipt = sign_cose_payload(&receipt_cbor, receiver_signing_key, RECEIPT_AAD)?;
    let receipt_path = receipts_root.join(format!("{envelope_id}.receipt.cose"));
    write_new(&receipt_path, &signed_receipt)?;
    write_new(
        &receipts_root.join(format!("{envelope_id}.receipt.json")),
        &serde_json::to_vec_pretty(&receipt)
            .map_err(|error| WorkflowError::InvalidReceipt(error.to_string()))?,
    )?;

    let imported_record = serde_json::json!({
        "state": "imported",
        "envelope_id": envelope_id,
        "imported_name": receipt.imported_name,
        "receipt": receipt_path.file_name().and_then(|value| value.to_str()),
        "observed_unix": observed_unix,
    });
    write_new(
        &quarantine_dir.join("imported.json"),
        &serde_json::to_vec_pretty(&imported_record)
            .map_err(|error| WorkflowError::InvalidReceipt(error.to_string()))?,
    )?;

    Ok(WorkflowOutcome {
        quarantine_dir,
        imported_path: Some(imported_path),
        receipt_path: Some(receipt_path),
        receipt: Some(receipt),
    })
}

/// Verifies and decodes a receiver-signed import receipt.
///
/// # Errors
///
/// Returns an error for oversized input, signature/key mismatch, malformed
/// receipt fields, or non-deterministic CBOR.
pub fn verify_receipt(
    signed_receipt: &[u8],
    receiver_verifying_key: &VerifyingKey,
) -> Result<ImportReceipt, WorkflowError> {
    if signed_receipt.len() > MAX_RECEIPT_BYTES {
        return Err(WorkflowError::InvalidReceipt("size limit exceeded".into()));
    }
    let bytes = verify_cose_payload(signed_receipt, receiver_verifying_key, RECEIPT_AAD)?;
    let receipt = decode_receipt(&bytes)?;
    if encode_receipt(&receipt)? != bytes {
        return Err(WorkflowError::InvalidReceipt(
            "receipt CBOR is not deterministic".into(),
        ));
    }
    if receipt.receiver_key_id != hex::encode(key_id(receiver_verifying_key)) {
        return Err(WorkflowError::InvalidReceipt(
            "receipt key identifier mismatch".into(),
        ));
    }
    Ok(receipt)
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<(), std::io::Error> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()
}

fn encode_receipt(receipt: &ImportReceipt) -> Result<Vec<u8>, WorkflowError> {
    let envelope_id = decode_fixed::<16>(&receipt.envelope_id, "envelope id")?;
    let payload_digest = decode_fixed::<32>(&receipt.payload_sha256, "payload digest")?;
    let receiver_key_id = decode_fixed::<8>(&receipt.receiver_key_id, "receiver key id")?;
    let mut encoder = Encoder::new(Vec::new());
    encoder.map(11).map_err(encode_error)?;
    encoder
        .u8(1)
        .and_then(|value| value.u16(receipt.version))
        .map_err(encode_error)?;
    encoder
        .u8(2)
        .and_then(|value| value.str(&receipt.event))
        .map_err(encode_error)?;
    encoder
        .u8(3)
        .and_then(|value| value.bytes(&envelope_id))
        .map_err(encode_error)?;
    encoder
        .u8(4)
        .and_then(|value| value.bytes(&payload_digest))
        .map_err(encode_error)?;
    encoder
        .u8(5)
        .and_then(|value| value.str(&receipt.boundary))
        .map_err(encode_error)?;
    encoder
        .u8(6)
        .and_then(|value| value.str(&receipt.policy_id))
        .map_err(encode_error)?;
    encoder
        .u8(7)
        .and_then(|value| value.str(&receipt.imported_name))
        .map_err(encode_error)?;
    encoder
        .u8(8)
        .and_then(|value| value.u64(receipt.observed_unix))
        .map_err(encode_error)?;
    encoder
        .u8(9)
        .and_then(|value| value.bytes(&receiver_key_id))
        .map_err(encode_error)?;
    encoder
        .u8(10)
        .and_then(|value| value.u64(receipt.accepted_frames))
        .map_err(encode_error)?;
    encoder
        .u8(11)
        .and_then(|value| value.u64(receipt.rejected_frames))
        .map_err(encode_error)?;
    Ok(encoder.into_writer())
}

fn decode_receipt(bytes: &[u8]) -> Result<ImportReceipt, WorkflowError> {
    let mut decoder = Decoder::new(bytes);
    let length = decoder
        .map()
        .map_err(decode_error)?
        .ok_or_else(|| WorkflowError::InvalidReceipt("indefinite map".into()))?;
    if length != 11 {
        return Err(WorkflowError::InvalidReceipt("invalid map length".into()));
    }
    require_key(&mut decoder, 1)?;
    let version = decoder.u16().map_err(decode_error)?;
    require_key(&mut decoder, 2)?;
    let event = decoder.str().map_err(decode_error)?.to_owned();
    require_key(&mut decoder, 3)?;
    let envelope_id = read_fixed_hex::<16>(&mut decoder, "envelope id")?;
    require_key(&mut decoder, 4)?;
    let payload_sha256 = read_fixed_hex::<32>(&mut decoder, "payload digest")?;
    require_key(&mut decoder, 5)?;
    let boundary = decoder.str().map_err(decode_error)?.to_owned();
    require_key(&mut decoder, 6)?;
    let policy_id = decoder.str().map_err(decode_error)?.to_owned();
    require_key(&mut decoder, 7)?;
    let imported_name = decoder.str().map_err(decode_error)?.to_owned();
    require_key(&mut decoder, 8)?;
    let observed_unix = decoder.u64().map_err(decode_error)?;
    require_key(&mut decoder, 9)?;
    let receiver_key_id = read_fixed_hex::<8>(&mut decoder, "receiver key id")?;
    require_key(&mut decoder, 10)?;
    let accepted_frames = decoder.u64().map_err(decode_error)?;
    require_key(&mut decoder, 11)?;
    let rejected_frames = decoder.u64().map_err(decode_error)?;
    if decoder.position() != bytes.len() {
        return Err(WorkflowError::InvalidReceipt("trailing bytes".into()));
    }
    Ok(ImportReceipt {
        version,
        event,
        envelope_id,
        payload_sha256,
        boundary,
        policy_id,
        imported_name,
        observed_unix,
        receiver_key_id,
        accepted_frames,
        rejected_frames,
    })
}

fn require_key(decoder: &mut Decoder<'_>, expected: u8) -> Result<(), WorkflowError> {
    if decoder.u8().map_err(decode_error)? != expected {
        return Err(WorkflowError::InvalidReceipt(
            "non-canonical map key".into(),
        ));
    }
    Ok(())
}

fn read_fixed_hex<const N: usize>(
    decoder: &mut Decoder<'_>,
    name: &str,
) -> Result<String, WorkflowError> {
    let bytes = decoder.bytes().map_err(decode_error)?;
    if bytes.len() != N {
        return Err(WorkflowError::InvalidReceipt(format!(
            "{name} must be {N} bytes"
        )));
    }
    Ok(hex::encode(bytes))
}

fn decode_fixed<const N: usize>(value: &str, name: &str) -> Result<[u8; N], WorkflowError> {
    let bytes =
        hex::decode(value).map_err(|_| WorkflowError::InvalidReceipt(format!("invalid {name}")))?;
    bytes
        .try_into()
        .map_err(|_| WorkflowError::InvalidReceipt(format!("invalid {name} length")))
}

fn encode_error<E: std::fmt::Display>(error: E) -> WorkflowError {
    WorkflowError::InvalidReceipt(error.to_string())
}

#[allow(clippy::needless_pass_by_value)]
fn decode_error(error: minicbor::decode::Error) -> WorkflowError {
    WorkflowError::InvalidReceipt(error.to_string())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::envelope::{
        Direction, EnvelopeRequest, create_signed_envelope, generate_signing_key,
        verify_signed_envelope,
    };

    #[test]
    fn quarantines_imports_and_verifies_a_signed_receipt() {
        let sender = generate_signing_key().unwrap();
        let receiver = generate_signing_key().unwrap();
        let request = EnvelopeRequest {
            payload: b"approved configuration",
            boundary: "lab/config-in",
            direction: Direction::Inbound,
            purpose: "configuration",
            policy_id: "config/v1",
            display_name: "../../dangerous-name.sh",
            media_type: "application/octet-stream",
            sequence: 7,
            created_unix: 1_786_000_000,
        };
        let envelope = create_signed_envelope(&request, &sender).unwrap();
        let verified =
            verify_signed_envelope(&envelope, &sender.verifying_key(), Some("lab/config-in"))
                .unwrap();
        let workspace = tempdir().unwrap();
        let outcome = import_verified(
            &verified,
            workspace.path(),
            true,
            &receiver,
            1_786_000_001,
            19,
            2,
        )
        .unwrap();
        let imported = outcome.imported_path.unwrap();
        assert_eq!(fs::read(imported).unwrap(), b"approved configuration");
        assert!(!workspace.path().join("dangerous-name.sh").exists());
        let signed_receipt = fs::read(outcome.receipt_path.unwrap()).unwrap();
        let receipt = verify_receipt(&signed_receipt, &receiver.verifying_key()).unwrap();
        assert_eq!(receipt.event, "imported");
        assert_eq!(receipt.accepted_frames, 19);
    }

    #[test]
    fn approval_false_leaves_data_in_quarantine() {
        let sender = generate_signing_key().unwrap();
        let receiver = generate_signing_key().unwrap();
        let request = EnvelopeRequest {
            payload: b"review me",
            boundary: "lab/review",
            direction: Direction::Inbound,
            purpose: "review",
            policy_id: "review/v1",
            display_name: "review.bin",
            media_type: "application/octet-stream",
            sequence: 1,
            created_unix: 1,
        };
        let envelope = create_signed_envelope(&request, &sender).unwrap();
        let verified = verify_signed_envelope(&envelope, &sender.verifying_key(), None).unwrap();
        let workspace = tempdir().unwrap();
        let outcome =
            import_verified(&verified, workspace.path(), false, &receiver, 2, 1, 0).unwrap();
        assert!(outcome.imported_path.is_none());
        assert!(outcome.quarantine_dir.join("object-0001.part").exists());
    }
}
