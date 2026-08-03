use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use minicbor::Encoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::envelope::{Direction, Manifest, VerifiedEnvelope};

const MAX_POLICY_BYTES: usize = 64 * 1024;
const MAX_STATE_BYTES: usize = 1024 * 1024;
const MAX_RULE_ITEMS: usize = 128;
const MAX_SEEN_ENVELOPES: usize = 4_096;
const MAX_TEXT_BYTES: usize = 512;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    pub version: u16,
    pub id: String,
    pub boundary: String,
    pub allowed_directions: Vec<Direction>,
    pub allowed_purposes: Vec<String>,
    pub allowed_media_types: Vec<String>,
    pub allowed_signer_key_ids: Vec<String>,
    pub max_payload_bytes: u64,
    pub minimum_sequence: u64,
    pub require_approval: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct PolicyState {
    pub version: u16,
    pub seen_envelopes: BTreeSet<String>,
    pub high_water_sequences: BTreeMap<String, u64>,
}

impl Default for PolicyState {
    fn default() -> Self {
        Self {
            version: 1,
            seen_envelopes: BTreeSet::new(),
            high_water_sequences: BTreeMap::new(),
        }
    }
}

#[derive(Debug)]
pub struct Authorization<'a> {
    verified: &'a VerifiedEnvelope,
    policy_id: String,
}

impl Authorization<'_> {
    #[must_use]
    pub const fn verified(&self) -> &VerifiedEnvelope {
        self.verified
    }

    #[must_use]
    pub fn policy_id(&self) -> &str {
        &self.policy_id
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum DecisionCode {
    #[serde(rename = "GB-ALLOW")]
    Allow,
    #[serde(rename = "GB-DENY-POLICY-ID")]
    PolicyId,
    #[serde(rename = "GB-DENY-POLICY-DIGEST")]
    PolicyDigest,
    #[serde(rename = "GB-DENY-BOUNDARY")]
    Boundary,
    #[serde(rename = "GB-DENY-DIRECTION")]
    Direction,
    #[serde(rename = "GB-DENY-PURPOSE")]
    Purpose,
    #[serde(rename = "GB-DENY-MEDIA-TYPE")]
    MediaType,
    #[serde(rename = "GB-DENY-SIGNER")]
    Signer,
    #[serde(rename = "GB-DENY-SIZE")]
    Size,
    #[serde(rename = "GB-DENY-SEQUENCE-FLOOR")]
    SequenceFloor,
    #[serde(rename = "GB-DENY-ROLLBACK")]
    Rollback,
    #[serde(rename = "GB-DENY-REPLAY")]
    Replay,
}

impl DecisionCode {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "GB-ALLOW",
            Self::PolicyId => "GB-DENY-POLICY-ID",
            Self::PolicyDigest => "GB-DENY-POLICY-DIGEST",
            Self::Boundary => "GB-DENY-BOUNDARY",
            Self::Direction => "GB-DENY-DIRECTION",
            Self::Purpose => "GB-DENY-PURPOSE",
            Self::MediaType => "GB-DENY-MEDIA-TYPE",
            Self::Signer => "GB-DENY-SIGNER",
            Self::Size => "GB-DENY-SIZE",
            Self::SequenceFloor => "GB-DENY-SEQUENCE-FLOOR",
            Self::Rollback => "GB-DENY-ROLLBACK",
            Self::Replay => "GB-DENY-REPLAY",
        }
    }
}

#[derive(Debug, Error, Serialize)]
#[error("{code}: {reason}")]
pub struct PolicyDenial {
    pub code: &'static str,
    pub reason: String,
}

impl PolicyDenial {
    fn new(code: DecisionCode, reason: impl Into<String>) -> Self {
        Self {
            code: code.as_str(),
            reason: reason.into(),
        }
    }
}

#[derive(Debug, Error)]
pub enum PolicyError {
    #[error("policy I/O failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("policy JSON is invalid: {0}")]
    Json(#[from] serde_json::Error),
    #[error("policy exceeds its configured size limit")]
    SizeLimit,
    #[error("policy field `{0}` is invalid")]
    InvalidField(&'static str),
    #[error("policy encoding failed: {0}")]
    Encoding(String),
}

impl Policy {
    /// Parses and validates a policy from bounded JSON input.
    ///
    /// # Errors
    ///
    /// Returns an error for oversized JSON, unknown fields, invalid values, or
    /// unbounded rule lists.
    pub fn from_json(bytes: &[u8]) -> Result<Self, PolicyError> {
        if bytes.len() > MAX_POLICY_BYTES {
            return Err(PolicyError::SizeLimit);
        }
        let mut policy: Self = serde_json::from_slice(bytes)?;
        policy.normalize();
        policy.validate()?;
        Ok(policy)
    }

    /// Returns the SHA-256 digest of the policy's deterministic CBOR form.
    ///
    /// # Errors
    ///
    /// Returns an error if the policy is invalid or cannot be encoded.
    pub fn digest(&self) -> Result<[u8; 32], PolicyError> {
        let mut normalized = self.clone();
        normalized.normalize();
        normalized.validate()?;
        Ok(Sha256::digest(normalized.encode()?).into())
    }

    /// Applies default-deny authorization and persistent replay state.
    ///
    /// # Errors
    ///
    /// Returns [`PolicyDenial`] with a stable machine-readable code when any
    /// policy, signer, size, replay, or rollback condition fails.
    pub fn authorize<'a>(
        &self,
        verified: &'a VerifiedEnvelope,
        state: &PolicyState,
    ) -> Result<Authorization<'a>, PolicyDenial> {
        let manifest = &verified.manifest;
        if manifest.policy_id != self.id {
            return Err(PolicyDenial::new(
                DecisionCode::PolicyId,
                "manifest policy id does not match loaded policy",
            ));
        }
        let expected_digest = self
            .digest()
            .map_err(|error| PolicyDenial::new(DecisionCode::PolicyDigest, error.to_string()))?;
        if manifest.policy_digest != hex::encode(expected_digest) {
            return Err(PolicyDenial::new(
                DecisionCode::PolicyDigest,
                "manifest policy digest does not match loaded policy",
            ));
        }
        if manifest.boundary != self.boundary {
            return Err(PolicyDenial::new(
                DecisionCode::Boundary,
                "target boundary is not allowed",
            ));
        }
        if !self.allowed_directions.contains(&manifest.direction) {
            return Err(PolicyDenial::new(
                DecisionCode::Direction,
                "transfer direction is not allowed",
            ));
        }
        if !self.allowed_purposes.contains(&manifest.purpose) {
            return Err(PolicyDenial::new(
                DecisionCode::Purpose,
                "transfer purpose is not allowed",
            ));
        }
        let object = &manifest.objects[0];
        if !self.allowed_media_types.contains(&object.media_type) {
            return Err(PolicyDenial::new(
                DecisionCode::MediaType,
                "object media type is not allowed",
            ));
        }
        if !self
            .allowed_signer_key_ids
            .contains(&verified.signer_key_id)
        {
            return Err(PolicyDenial::new(
                DecisionCode::Signer,
                "signer key id is not allowed",
            ));
        }
        if object.length > self.max_payload_bytes {
            return Err(PolicyDenial::new(
                DecisionCode::Size,
                "payload exceeds policy limit",
            ));
        }
        if manifest.sequence < self.minimum_sequence {
            return Err(PolicyDenial::new(
                DecisionCode::SequenceFloor,
                "sequence is below policy minimum",
            ));
        }
        if state.seen_envelopes.contains(&manifest.envelope_id) {
            return Err(PolicyDenial::new(
                DecisionCode::Replay,
                "envelope id has already been imported",
            ));
        }
        let key = rollback_key(manifest);
        if state
            .high_water_sequences
            .get(&key)
            .is_some_and(|value| manifest.sequence <= *value)
        {
            return Err(PolicyDenial::new(
                DecisionCode::Rollback,
                "sequence does not advance the imported high-water mark",
            ));
        }
        Ok(Authorization {
            verified,
            policy_id: self.id.clone(),
        })
    }

    fn normalize(&mut self) {
        self.allowed_directions
            .sort_by_key(|direction| match direction {
                Direction::Inbound => 1,
                Direction::Outbound => 2,
            });
        self.allowed_directions.dedup();
        for values in [
            &mut self.allowed_purposes,
            &mut self.allowed_media_types,
            &mut self.allowed_signer_key_ids,
        ] {
            values.sort();
            values.dedup();
        }
    }

    fn validate(&self) -> Result<(), PolicyError> {
        if self.version != 1 {
            return Err(PolicyError::InvalidField("version"));
        }
        validate_text("id", &self.id)?;
        validate_text("boundary", &self.boundary)?;
        if self.max_payload_bytes == 0 || self.max_payload_bytes > 64 * 1024 * 1024 {
            return Err(PolicyError::InvalidField("max_payload_bytes"));
        }
        if self.allowed_directions.is_empty()
            || self.allowed_purposes.is_empty()
            || self.allowed_media_types.is_empty()
            || self.allowed_signer_key_ids.is_empty()
        {
            return Err(PolicyError::InvalidField("allowlists"));
        }
        for (name, values) in [
            ("allowed_purposes", &self.allowed_purposes),
            ("allowed_media_types", &self.allowed_media_types),
            ("allowed_signer_key_ids", &self.allowed_signer_key_ids),
        ] {
            if values.len() > MAX_RULE_ITEMS {
                return Err(PolicyError::InvalidField(name));
            }
            for value in values {
                validate_text(name, value)?;
            }
        }
        if self
            .allowed_signer_key_ids
            .iter()
            .any(|value| value.len() != 16 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            return Err(PolicyError::InvalidField("allowed_signer_key_ids"));
        }
        Ok(())
    }

    fn encode(&self) -> Result<Vec<u8>, PolicyError> {
        let mut encoder = Encoder::new(Vec::new());
        encoder.map(10).map_err(encode_error)?;
        encoder
            .u8(1)
            .and_then(|value| value.u16(self.version))
            .map_err(encode_error)?;
        encoder
            .u8(2)
            .and_then(|value| value.str(&self.id))
            .map_err(encode_error)?;
        encoder
            .u8(3)
            .and_then(|value| value.str(&self.boundary))
            .map_err(encode_error)?;
        encoder
            .u8(4)
            .and_then(|value| value.array(self.allowed_directions.len() as u64))
            .map_err(encode_error)?;
        for direction in &self.allowed_directions {
            let code = match direction {
                Direction::Inbound => 1,
                Direction::Outbound => 2,
            };
            encoder.u8(code).map_err(encode_error)?;
        }
        encode_text_array(&mut encoder, 5, &self.allowed_purposes)?;
        encode_text_array(&mut encoder, 6, &self.allowed_media_types)?;
        encode_text_array(&mut encoder, 7, &self.allowed_signer_key_ids)?;
        encoder
            .u8(8)
            .and_then(|value| value.u64(self.max_payload_bytes))
            .map_err(encode_error)?;
        encoder
            .u8(9)
            .and_then(|value| value.u64(self.minimum_sequence))
            .map_err(encode_error)?;
        encoder
            .u8(10)
            .and_then(|value| value.bool(self.require_approval))
            .map_err(encode_error)?;
        Ok(encoder.into_writer())
    }
}

impl PolicyState {
    /// Loads policy state or creates empty version-1 state when no file exists.
    ///
    /// # Errors
    ///
    /// Returns an error for oversized, malformed, or unreadable state.
    pub fn load(path: &Path) -> Result<Self, PolicyError> {
        match fs::read(path) {
            Ok(bytes) => {
                if bytes.len() > MAX_STATE_BYTES {
                    return Err(PolicyError::SizeLimit);
                }
                let state: Self = serde_json::from_slice(&bytes)?;
                state.validate()?;
                Ok(state)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error.into()),
        }
    }

    /// Records an imported envelope after the import operation succeeds.
    ///
    /// # Errors
    ///
    /// Returns an error when the bounded replay cache is full.
    pub fn record_import(&mut self, manifest: &Manifest) -> Result<(), PolicyError> {
        if self.seen_envelopes.len() >= MAX_SEEN_ENVELOPES {
            return Err(PolicyError::SizeLimit);
        }
        self.seen_envelopes.insert(manifest.envelope_id.clone());
        self.high_water_sequences
            .insert(rollback_key(manifest), manifest.sequence);
        Ok(())
    }

    /// Atomically saves state using a sibling temporary file.
    ///
    /// # Errors
    ///
    /// Returns an error when state is invalid or the filesystem write fails.
    pub fn save(&self, path: &Path) -> Result<(), PolicyError> {
        self.validate()?;
        let bytes = serde_json::to_vec_pretty(self)?;
        if bytes.len() > MAX_STATE_BYTES {
            return Err(PolicyError::SizeLimit);
        }
        if let Some(parent) = path.parent()
            && !parent.as_os_str().is_empty()
        {
            fs::create_dir_all(parent)?;
        }
        let temporary = temporary_path(path);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(temporary, path)?;
        Ok(())
    }

    fn validate(&self) -> Result<(), PolicyError> {
        if self.version != 1
            || self.seen_envelopes.len() > MAX_SEEN_ENVELOPES
            || self.high_water_sequences.len() > MAX_RULE_ITEMS
        {
            return Err(PolicyError::InvalidField("state"));
        }
        if self
            .seen_envelopes
            .iter()
            .any(|value| value.len() != 32 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            return Err(PolicyError::InvalidField("seen_envelopes"));
        }
        if self
            .high_water_sequences
            .keys()
            .any(|value| value.len() != 64 || !value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        {
            return Err(PolicyError::InvalidField("high_water_sequences"));
        }
        Ok(())
    }
}

fn rollback_key(manifest: &Manifest) -> String {
    let mut hasher = Sha256::new();
    for value in [&manifest.boundary, &manifest.policy_id, &manifest.purpose] {
        hasher.update((value.len() as u64).to_be_bytes());
        hasher.update(value.as_bytes());
    }
    hex::encode(hasher.finalize())
}

fn validate_text(name: &'static str, value: &str) -> Result<(), PolicyError> {
    if value.is_empty() || value.len() > MAX_TEXT_BYTES || value.chars().any(char::is_control) {
        return Err(PolicyError::InvalidField(name));
    }
    Ok(())
}

fn encode_text_array(
    encoder: &mut Encoder<Vec<u8>>,
    key: u8,
    values: &[String],
) -> Result<(), PolicyError> {
    encoder
        .u8(key)
        .and_then(|value| value.array(values.len() as u64))
        .map_err(encode_error)?;
    for value in values {
        encoder.str(value).map_err(encode_error)?;
    }
    Ok(())
}

fn temporary_path(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".new");
    PathBuf::from(name)
}

fn encode_error<E: std::fmt::Display>(error: E) -> PolicyError {
    PolicyError::Encoding(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::envelope::{
        EnvelopeRequest, create_signed_envelope, generate_signing_key, key_id,
        verify_signed_envelope,
    };
    use tempfile::tempdir;

    fn policy_for_signer(signer: &ed25519_dalek::SigningKey) -> Policy {
        Policy {
            version: 1,
            id: "firmware-in/v1".into(),
            boundary: "lab/firmware-in".into(),
            allowed_directions: vec![Direction::Inbound],
            allowed_purposes: vec!["firmware-update".into()],
            allowed_media_types: vec!["application/octet-stream".into()],
            allowed_signer_key_ids: vec![hex::encode(key_id(&signer.verifying_key()))],
            max_payload_bytes: 1_024,
            minimum_sequence: 10,
            require_approval: true,
        }
    }

    fn verified_with_sequence(
        signer: &ed25519_dalek::SigningKey,
        policy: &Policy,
        sequence: u64,
    ) -> VerifiedEnvelope {
        let request = EnvelopeRequest {
            payload: b"firmware",
            boundary: "lab/firmware-in",
            direction: Direction::Inbound,
            purpose: "firmware-update",
            policy_id: &policy.id,
            policy_digest: policy.digest().unwrap(),
            display_name: "firmware.bin",
            media_type: "application/octet-stream",
            sequence,
            created_unix: 1,
        };
        let envelope = create_signed_envelope(&request, signer).unwrap();
        verify_signed_envelope(&envelope, &signer.verifying_key(), None).unwrap()
    }

    #[test]
    fn allows_matching_policy_and_denies_replay_and_rollback() {
        let signer = generate_signing_key().unwrap();
        let policy = policy_for_signer(&signer);
        let verified = verified_with_sequence(&signer, &policy, 10);
        let mut state = PolicyState {
            version: 1,
            ..PolicyState::default()
        };
        let authorization = policy.authorize(&verified, &state).unwrap();
        assert_eq!(authorization.policy_id(), policy.id);
        state.record_import(&verified.manifest).unwrap();

        let replay = policy.authorize(&verified, &state).unwrap_err();
        assert_eq!(replay.code, DecisionCode::Replay.as_str());

        let rollback = verified_with_sequence(&signer, &policy, 9);
        let denial = policy.authorize(&rollback, &state).unwrap_err();
        assert_eq!(denial.code, DecisionCode::SequenceFloor.as_str());

        let duplicate_sequence = verified_with_sequence(&signer, &policy, 10);
        let denial = policy.authorize(&duplicate_sequence, &state).unwrap_err();
        assert_eq!(denial.code, DecisionCode::Rollback.as_str());
    }

    #[test]
    fn denies_wrong_signer_and_policy_digest() {
        let signer = generate_signing_key().unwrap();
        let other = generate_signing_key().unwrap();
        let policy = policy_for_signer(&signer);
        let verified = verified_with_sequence(&other, &policy, 10);
        let state = PolicyState {
            version: 1,
            ..PolicyState::default()
        };
        let denial = policy.authorize(&verified, &state).unwrap_err();
        assert_eq!(denial.code, DecisionCode::Signer.as_str());

        let valid = verified_with_sequence(&signer, &policy, 10);
        let mut modified_policy = policy.clone();
        modified_policy.max_payload_bytes = 512;
        let denial = modified_policy.authorize(&valid, &state).unwrap_err();
        assert_eq!(denial.code, DecisionCode::PolicyDigest.as_str());
    }

    #[test]
    fn persists_replay_and_high_water_state() {
        let signer = generate_signing_key().unwrap();
        let policy = policy_for_signer(&signer);
        let verified = verified_with_sequence(&signer, &policy, 11);
        let mut state = PolicyState {
            version: 1,
            ..PolicyState::default()
        };
        state.record_import(&verified.manifest).unwrap();
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.json");
        state.save(&path).unwrap();

        let loaded = PolicyState::load(&path).unwrap();
        let denial = policy.authorize(&verified, &loaded).unwrap_err();
        assert_eq!(denial.code, DecisionCode::Replay.as_str());
        let older = verified_with_sequence(&signer, &policy, 10);
        let denial = policy.authorize(&older, &loaded).unwrap_err();
        assert_eq!(denial.code, DecisionCode::Rollback.as_str());
    }
}
