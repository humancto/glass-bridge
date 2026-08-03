use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use agx_core::{
    ChannelConfig, Direction, EnvelopeRequest, Policy, PolicyState, create_signed_envelope,
    decode_frames, encode_frames, generate_signing_key, import_authorized, key_id,
    signing_key_from_bytes, simulate_channel, verify_receipt, verify_signed_envelope,
    verifying_key_from_bytes,
};
use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand, ValueEnum};

#[derive(Debug, Parser)]
#[command(
    name = "glassbridge",
    version,
    about = "GlassBridge / AGX research prototype",
    long_about = "Create and verify signed AGX envelopes, exercise the bounded lossy-frame loopback, and demonstrate quarantine/import receipts. Not a production cross-domain solution."
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the complete signed-envelope -> lossy-channel -> import demonstration.
    Demo {
        #[arg(long, default_value = "demo-output")]
        output_dir: PathBuf,
        #[arg(long, default_value_t = 35)]
        loss: u8,
        #[arg(long, default_value_t = 5)]
        corruption: u8,
        #[arg(long, default_value_t = 10)]
        duplicates: u8,
    },
    /// Generate a raw 32-byte Ed25519 secret/public key pair.
    Keygen {
        #[arg(long)]
        secret: PathBuf,
        #[arg(long)]
        public: PathBuf,
    },
    /// Wrap one file in a signed AGX/1 envelope.
    Pack {
        #[arg(long)]
        input: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long)]
        secret_key: PathBuf,
        #[arg(long)]
        boundary: String,
        #[arg(long, value_enum, default_value_t = CliDirection::Inbound)]
        direction: CliDirection,
        #[arg(long)]
        purpose: String,
        #[arg(long)]
        policy_file: PathBuf,
        #[arg(long, default_value = "application/octet-stream")]
        media_type: String,
        #[arg(long, default_value_t = 1)]
        sequence: u64,
    },
    /// Verify signature, canonical encoding, boundary, length, and payload hash.
    Verify {
        #[arg(long)]
        envelope: PathBuf,
        #[arg(long)]
        public_key: PathBuf,
        #[arg(long)]
        boundary: Option<String>,
    },
    /// Send an AGX file through the deterministic lossy frame simulator.
    Loopback {
        #[arg(long)]
        envelope: PathBuf,
        #[arg(long)]
        output: PathBuf,
        #[arg(long, default_value_t = 512)]
        symbol_size: usize,
        #[arg(long, default_value_t = 35)]
        loss: u8,
        #[arg(long, default_value_t = 5)]
        corruption: u8,
        #[arg(long, default_value_t = 10)]
        duplicates: u8,
        #[arg(long, default_value_t = 42)]
        seed: u64,
    },
    /// Verify an envelope, quarantine it, and optionally approve atomic import.
    Receive {
        #[arg(long)]
        envelope: PathBuf,
        #[arg(long)]
        sender_public_key: PathBuf,
        #[arg(long)]
        receiver_secret_key: PathBuf,
        #[arg(long)]
        policy_file: PathBuf,
        #[arg(long)]
        workspace: PathBuf,
        #[arg(long)]
        boundary: String,
        #[arg(long)]
        approve: bool,
    },
}

#[derive(Debug, Clone, Copy, ValueEnum)]
enum CliDirection {
    Inbound,
    Outbound,
}

impl From<CliDirection> for Direction {
    fn from(value: CliDirection) -> Self {
        match value {
            CliDirection::Inbound => Self::Inbound,
            CliDirection::Outbound => Self::Outbound,
        }
    }
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Command::Demo {
            output_dir,
            loss,
            corruption,
            duplicates,
        } => demo(&output_dir, loss, corruption, duplicates),
        Command::Keygen { secret, public } => keygen(&secret, &public),
        Command::Pack {
            input,
            output,
            secret_key,
            boundary,
            direction,
            purpose,
            policy_file,
            media_type,
            sequence,
        } => pack(
            &input,
            &output,
            &secret_key,
            &boundary,
            direction.into(),
            &purpose,
            &policy_file,
            &media_type,
            sequence,
        ),
        Command::Verify {
            envelope,
            public_key,
            boundary,
        } => verify(&envelope, &public_key, boundary.as_deref()),
        Command::Loopback {
            envelope,
            output,
            symbol_size,
            loss,
            corruption,
            duplicates,
            seed,
        } => loopback(
            &envelope,
            &output,
            symbol_size,
            ChannelConfig {
                loss_percent: loss,
                corruption_percent: corruption,
                duplicate_percent: duplicates,
                seed,
            },
        ),
        Command::Receive {
            envelope,
            sender_public_key,
            receiver_secret_key,
            policy_file,
            workspace,
            boundary,
            approve,
        } => receive(
            &envelope,
            &sender_public_key,
            &receiver_secret_key,
            &policy_file,
            &workspace,
            &boundary,
            approve,
        ),
    }
}

#[allow(clippy::too_many_lines)] // The demo intentionally narrates one complete vertical slice.
fn demo(base: &Path, loss: u8, corruption: u8, duplicates: u8) -> Result<()> {
    fs::create_dir_all(base).with_context(|| format!("create {}", base.display()))?;
    let now = unix_now()?;
    let mut suffix = [0_u8; 4];
    getrandom::fill(&mut suffix).context("generate demo run id")?;
    let run_dir = base.join(format!("run-{now}-{}", hex_string(&suffix)));
    fs::create_dir(&run_dir).with_context(|| format!("create {}", run_dir.display()))?;

    let sender = generate_signing_key().context("generate sender signing key")?;
    let receiver = generate_signing_key().context("generate receiver receipt key")?;
    write_secret(&run_dir.join("sender.secret"), &sender.to_bytes())?;
    write_new(
        &run_dir.join("sender.public"),
        &sender.verifying_key().to_bytes(),
    )?;
    write_secret(&run_dir.join("receiver.secret"), &receiver.to_bytes())?;
    write_new(
        &run_dir.join("receiver.public"),
        &receiver.verifying_key().to_bytes(),
    )?;

    let policy = Policy {
        version: 1,
        id: "demo-firmware-in/v1".into(),
        boundary: "demo-lab/firmware-in".into(),
        allowed_directions: vec![Direction::Inbound],
        allowed_purposes: vec!["firmware-update".into()],
        allowed_media_types: vec!["application/octet-stream".into()],
        allowed_signer_key_ids: vec![hex_string(&key_id(&sender.verifying_key()))],
        max_payload_bytes: 1_048_576,
        minimum_sequence: 1,
        require_approval: true,
    };
    write_new(
        &run_dir.join("policy.json"),
        &serde_json::to_vec_pretty(&policy)?,
    )?;

    let payload =
        b"GlassBridge milestone one: signed, bounded, policy-addressed optical transfer.\n"
            .repeat(128);
    write_new(&run_dir.join("sample-input.bin"), &payload)?;
    let request = EnvelopeRequest {
        payload: &payload,
        boundary: "demo-lab/firmware-in",
        direction: Direction::Inbound,
        purpose: "firmware-update",
        policy_id: &policy.id,
        policy_digest: policy.digest()?,
        display_name: "sample-firmware.bin",
        media_type: "application/octet-stream",
        sequence: 1,
        created_unix: now,
    };
    let envelope =
        create_signed_envelope(&request, &sender).context("create signed AGX envelope")?;
    write_new(&run_dir.join("sender-envelope.agx"), &envelope)?;

    let mut session_id = [0_u8; 16];
    getrandom::fill(&mut session_id).context("generate optical session id")?;
    let encoded = encode_frames(&envelope, session_id, 512, None).context("encode frames")?;
    let (delivered, channel) = simulate_channel(
        &encoded.frames,
        ChannelConfig {
            loss_percent: loss,
            corruption_percent: corruption,
            duplicate_percent: duplicates,
            seed: 42,
        },
    )
    .context("simulate channel")?;
    let decoded = decode_frames(&delivered).context("recover envelope from delivered frames")?;
    if decoded.bytes != envelope {
        bail!("recovered envelope differs from sender envelope");
    }
    write_new(&run_dir.join("receiver-envelope.agx"), &decoded.bytes)?;

    let verified = verify_signed_envelope(
        &decoded.bytes,
        &sender.verifying_key(),
        Some("demo-lab/firmware-in"),
    )
    .context("verify reconstructed AGX envelope")?;
    let receiver_workspace = run_dir.join("receiver-workspace");
    let state_path = receiver_workspace.join("policy-state.json");
    let mut policy_state = PolicyState::load(&state_path)?;
    let authorization = policy.authorize(&verified, &policy_state)?;
    let outcome = import_authorized(
        &authorization,
        &receiver_workspace,
        true,
        &receiver,
        unix_now()?,
        decoded.accepted_frames,
        decoded.rejected_frames,
    )
    .context("quarantine and import verified payload")?;
    if outcome.imported_path.is_some() {
        policy_state.record_import(&verified.manifest)?;
        policy_state.save(&state_path)?;
    }
    let receipt_path = outcome.receipt_path.context("demo did not emit receipt")?;
    let receipt_bytes = fs::read(&receipt_path)?;
    let receipt = verify_receipt(&receipt_bytes, &receiver.verifying_key())
        .context("verify receiver import receipt")?;

    println!("GlassBridge milestone demo: PASS");
    println!("  run directory:       {}", run_dir.display());
    println!("  signed envelope:     {} bytes", envelope.len());
    println!(
        "  source symbols:      {} × {} bytes",
        encoded.source_count, encoded.symbol_size
    );
    println!("  frames emitted:      {}", channel.emitted);
    println!("  frames dropped:      {}", channel.dropped);
    println!(
        "  frames corrupted:    {} (rejected by CRC: {})",
        channel.corrupted, decoded.rejected_frames
    );
    println!("  frames duplicated:   {}", channel.duplicated);
    println!(
        "  decoder rank:        {}/{}",
        decoded.rank, decoded.source_count
    );
    println!("  signature + digest:  VERIFIED");
    println!("  policy decision:     GB-ALLOW");
    println!(
        "  boundary + policy:   {} / {}",
        verified.manifest.boundary, verified.manifest.policy_id
    );
    println!(
        "  import:              {}",
        outcome
            .imported_path
            .context("demo did not import")?
            .display()
    );
    println!(
        "  signed receipt:      {} ({})",
        receipt_path.display(),
        receipt.event
    );
    Ok(())
}

fn keygen(secret_path: &Path, public_path: &Path) -> Result<()> {
    let signing_key = generate_signing_key().context("generate signing key")?;
    write_secret(secret_path, &signing_key.to_bytes())?;
    write_new(public_path, &signing_key.verifying_key().to_bytes())?;
    println!("created secret key: {}", secret_path.display());
    println!("created public key: {}", public_path.display());
    println!(
        "signer key id:      {}",
        hex_string(&key_id(&signing_key.verifying_key()))
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn pack(
    input: &Path,
    output: &Path,
    secret_key_path: &Path,
    boundary: &str,
    direction: Direction,
    purpose: &str,
    policy_file: &Path,
    media_type: &str,
    sequence: u64,
) -> Result<()> {
    let payload = fs::read(input).with_context(|| format!("read {}", input.display()))?;
    let signing_key = signing_key_from_bytes(&fs::read(secret_key_path)?)?;
    let policy = load_policy(policy_file)?;
    let display_name = input
        .file_name()
        .and_then(|value| value.to_str())
        .context("input filename must be valid UTF-8")?;
    let request = EnvelopeRequest {
        payload: &payload,
        boundary,
        direction,
        purpose,
        policy_id: &policy.id,
        policy_digest: policy.digest()?,
        display_name,
        media_type,
        sequence,
        created_unix: unix_now()?,
    };
    let envelope = create_signed_envelope(&request, &signing_key)?;
    let verified = verify_signed_envelope(&envelope, &signing_key.verifying_key(), None)?;
    let empty_state = PolicyState {
        version: 1,
        ..PolicyState::default()
    };
    policy.authorize(&verified, &empty_state)?;
    write_new(output, &envelope)?;
    println!(
        "created signed envelope: {} ({} bytes)",
        output.display(),
        envelope.len()
    );
    Ok(())
}

fn verify(envelope_path: &Path, public_key_path: &Path, boundary: Option<&str>) -> Result<()> {
    let envelope = fs::read(envelope_path)?;
    let public_key = verifying_key_from_bytes(&fs::read(public_key_path)?)?;
    let verified = verify_signed_envelope(&envelope, &public_key, boundary)?;
    println!("{}", serde_json::to_string_pretty(&verified.manifest)?);
    println!("VERIFIED signer_key_id={}", verified.signer_key_id);
    Ok(())
}

fn loopback(
    envelope_path: &Path,
    output: &Path,
    symbol_size: usize,
    config: ChannelConfig,
) -> Result<()> {
    let envelope = fs::read(envelope_path)?;
    let mut session_id = [0_u8; 16];
    getrandom::fill(&mut session_id).context("generate session id")?;
    let encoded = encode_frames(&envelope, session_id, symbol_size, None)?;
    let (delivered, stats) = simulate_channel(&encoded.frames, config)?;
    let decoded = decode_frames(&delivered)?;
    write_new(output, &decoded.bytes)?;
    println!("{}", serde_json::to_string_pretty(&stats)?);
    println!(
        "RECOVERED rank={}/{} rejected={}",
        decoded.rank, decoded.source_count, decoded.rejected_frames
    );
    Ok(())
}

fn receive(
    envelope_path: &Path,
    sender_public_key_path: &Path,
    receiver_secret_key_path: &Path,
    policy_file: &Path,
    workspace: &Path,
    boundary: &str,
    approve: bool,
) -> Result<()> {
    let envelope = fs::read(envelope_path)?;
    let sender_key = verifying_key_from_bytes(&fs::read(sender_public_key_path)?)?;
    let receiver_key = signing_key_from_bytes(&fs::read(receiver_secret_key_path)?)?;
    let policy = load_policy(policy_file)?;
    let verified = verify_signed_envelope(&envelope, &sender_key, Some(boundary))?;
    let state_path = workspace.join("policy-state.json");
    let mut policy_state = PolicyState::load(&state_path)?;
    let authorization = policy.authorize(&verified, &policy_state)?;
    let outcome = import_authorized(
        &authorization,
        workspace,
        approve,
        &receiver_key,
        unix_now()?,
        1,
        0,
    )?;
    if outcome.imported_path.is_some() {
        policy_state.record_import(&verified.manifest)?;
        policy_state.save(&state_path)?;
    }
    if let Some(path) = outcome.imported_path {
        println!("IMPORTED {}", path.display());
    } else {
        println!("QUARANTINED {}", outcome.quarantine_dir.display());
    }
    if let Some(path) = outcome.receipt_path {
        println!("RECEIPT {}", path.display());
    }
    Ok(())
}

fn write_new(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("create {}", path.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn write_secret(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent()
        && !parent.as_os_str().is_empty()
    {
        fs::create_dir_all(parent)?;
    }
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(path)
        .with_context(|| format!("create secret key {}", path.display()))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn unix_now() -> Result<u64> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .context("system clock is before the Unix epoch")?
        .as_secs())
}

fn load_policy(path: &Path) -> Result<Policy> {
    let bytes = fs::read(path).with_context(|| format!("read policy {}", path.display()))?;
    Policy::from_json(&bytes).with_context(|| format!("parse policy {}", path.display()))
}

fn hex_string(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}
