//! Security-oriented primitives for the `GlassBridge` AGX research prototype.
//!
//! The current milestone deliberately supports one payload object and a bounded
//! in-memory envelope. It is a runnable protocol experiment, not a production
//! cross-domain solution.

pub mod envelope;
pub mod transport;
pub mod workflow;

pub use envelope::{
    Direction, EnvelopeRequest, Manifest, ObjectManifest, VerifiedEnvelope, create_signed_envelope,
    generate_signing_key, key_id, signing_key_from_bytes, verify_signed_envelope,
    verifying_key_from_bytes,
};
pub use transport::{
    ChannelConfig, ChannelStats, DecodeReport, EncodedTransfer, decode_frames, encode_frames,
    simulate_channel,
};
pub use workflow::{ImportReceipt, WorkflowOutcome, import_verified, verify_receipt};
