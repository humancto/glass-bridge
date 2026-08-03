use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::time::Instant;

use agx_core::{
    ChannelConfig, ChannelStats, MAX_OPTICAL_FRAMES, decode_frames, encode_frames,
    simulate_channel, verify_signed_envelope, verifying_key_from_bytes,
};
use agx_visual::{QrEcc, QrPngCodec, VisualCodec};
use anyhow::{Context, Result, bail};
use serde::Serialize;

use super::{
    create_new_directory, hex_string, random_session_id, read_qr_frames, receive_with_counts,
    render_qr_frames, unix_now, write_new,
};

const MAX_VIDEO_BYTES: u64 = 512 * 1024 * 1024;

pub(super) struct LoopbackConfig {
    pub envelope: PathBuf,
    pub output_dir: PathBuf,
    pub public_key: Option<PathBuf>,
    pub boundary: Option<String>,
    pub symbol_size: usize,
    pub frame_count: Option<usize>,
    pub session_id: Option<[u8; 16]>,
    pub fps: u8,
    pub crf: u8,
    pub scale_percent: u8,
    pub channel: ChannelConfig,
    pub ecc: QrEcc,
    pub module_pixels: u32,
    pub ffmpeg: PathBuf,
}

pub(super) struct ReceiveConfig {
    pub video: PathBuf,
    pub output_dir: PathBuf,
    pub sender_public_key: PathBuf,
    pub receiver_secret_key: PathBuf,
    pub policy_file: PathBuf,
    pub workspace: PathBuf,
    pub boundary: String,
    pub approve: bool,
    pub max_frames: usize,
    pub ffmpeg: PathBuf,
}

#[derive(Debug, Serialize)]
struct ReceptionRecord {
    schema: &'static str,
    status: &'static str,
    created_unix: u64,
    source: &'static str,
    host_os: &'static str,
    host_arch: &'static str,
    ffmpeg_version: String,
    video_bytes: u64,
    maximum_frames: usize,
    extracted_frames: usize,
    decoded_qr_frames: usize,
    rejected_qr_frames: usize,
    accepted_transport_frames: usize,
    rejected_crc_frames: usize,
    decoder_rank: usize,
    required_rank: usize,
    recovered_envelope_bytes: usize,
    envelope_id: String,
    signer_key_id: String,
    boundary: String,
    policy_id: String,
    purpose: String,
    sequence: u64,
    cryptographic_verification: &'static str,
    policy_workflow: &'static str,
    extraction_ms: u64,
    decode_verify_policy_ms: u64,
    total_ms: u64,
}

#[derive(Debug, Serialize)]
struct BenchmarkRecord {
    schema: &'static str,
    status: &'static str,
    channel: &'static str,
    created_unix: u64,
    host_os: &'static str,
    host_arch: &'static str,
    ffmpeg_version: String,
    codec: &'static str,
    error_correction: &'static str,
    configuration: BenchmarkConfiguration,
    envelope: EnvelopeResult,
    transport: TransportResult,
    video: VideoResult,
    timing_ms: TimingResult,
    harness_processing_bytes_per_second: u64,
    recovered_channel_goodput_bytes_per_second: u64,
    verified_channel_goodput_bytes_per_second: Option<u64>,
    cryptographic_verification: &'static str,
}

#[derive(Debug, Serialize)]
struct BenchmarkConfiguration {
    symbol_bytes: usize,
    requested_frames: Option<usize>,
    session_id: String,
    module_pixels: u32,
    fps: u8,
    h264_crf: u8,
    scale_percent: u8,
    loss_percent: u8,
    corruption_percent: u8,
    duplicate_percent: u8,
    channel_seed: u64,
}

#[derive(Debug, Serialize)]
struct EnvelopeResult {
    bytes: usize,
    byte_identical: bool,
}

#[derive(Debug, Serialize)]
struct TransportResult {
    source_symbols: usize,
    emitted_frames: usize,
    delivered_frames: usize,
    dropped_frames: usize,
    corrupted_frames: usize,
    duplicated_frames: usize,
    accepted_frames: usize,
    rejected_crc_frames: usize,
    decoder_rank: usize,
}

#[derive(Debug, Serialize)]
struct VideoResult {
    source_png_frames: usize,
    source_png_bytes: usize,
    h264_bytes: u64,
    extracted_png_frames: usize,
    decoded_qr_frames: usize,
    rejected_qr_frames: usize,
}

#[derive(Debug, Serialize)]
struct TimingResult {
    render_qr: u64,
    encode_h264: u64,
    extract_h264: u64,
    decode_and_recover: u64,
    total: u64,
    emitted_channel_duration: u64,
    encoded_video_duration: u64,
}

pub(super) fn receive_recording(config: &ReceiveConfig) -> Result<()> {
    validate_receive(config)?;
    let started = Instant::now();
    let source_metadata = fs::metadata(&config.video)
        .with_context(|| format!("inspect video {}", config.video.display()))?;
    if !source_metadata.is_file() {
        bail!("video input must be a regular file");
    }
    if source_metadata.len() == 0 || source_metadata.len() > MAX_VIDEO_BYTES {
        bail!("video input exceeds configured size limits");
    }
    let source_video = fs::canonicalize(&config.video)?;

    create_new_directory(&config.output_dir)?;
    let output_root = fs::canonicalize(&config.output_dir)?;
    let extracted_frames = output_root.join("extracted-frames");
    fs::create_dir(&extracted_frames)?;

    let version = ffmpeg_version(&config.ffmpeg)?;
    let extract_started = Instant::now();
    extract_video(
        &config.ffmpeg,
        &source_video,
        &extracted_frames,
        config.max_frames,
    )?;
    let extraction_ms = elapsed_millis(extract_started)?;

    let receive_started = Instant::now();
    let codec = QrPngCodec::new(QrEcc::Medium, 4)?;
    let (frames, images) = read_qr_frames(&extracted_frames, codec)?;
    let decoded = decode_frames(&frames)?;
    let sender_key = verifying_key_from_bytes(&fs::read(&config.sender_public_key)?)?;
    let verified = verify_signed_envelope(&decoded.bytes, &sender_key, Some(&config.boundary))?;
    let recovered_path = output_root.join("recovered.agx");
    write_new(&recovered_path, &decoded.bytes)?;

    receive_with_counts(
        &recovered_path,
        &config.sender_public_key,
        &config.receiver_secret_key,
        &config.policy_file,
        &config.workspace,
        &config.boundary,
        config.approve,
        decoded.accepted_frames,
        decoded.rejected_frames,
    )?;
    let receive_ms = elapsed_millis(receive_started)?;
    let record = ReceptionRecord {
        schema: "glassbridge-reception/1",
        status: "pass",
        created_unix: unix_now()?,
        source: "prerecorded-video",
        host_os: std::env::consts::OS,
        host_arch: std::env::consts::ARCH,
        ffmpeg_version: version,
        video_bytes: source_metadata.len(),
        maximum_frames: config.max_frames,
        extracted_frames: images.images,
        decoded_qr_frames: images.decoded,
        rejected_qr_frames: images.rejected,
        accepted_transport_frames: decoded.accepted_frames,
        rejected_crc_frames: decoded.rejected_frames,
        decoder_rank: decoded.rank,
        required_rank: decoded.source_count,
        recovered_envelope_bytes: decoded.bytes.len(),
        envelope_id: verified.manifest.envelope_id,
        signer_key_id: verified.signer_key_id,
        boundary: verified.manifest.boundary,
        policy_id: verified.manifest.policy_id,
        purpose: verified.manifest.purpose,
        sequence: verified.manifest.sequence,
        cryptographic_verification: "verified",
        policy_workflow: if config.approve {
            "approved-import"
        } else {
            "quarantine-only"
        },
        extraction_ms,
        decode_verify_policy_ms: receive_ms,
        total_ms: elapsed_millis(started)?,
    };
    write_new(
        &output_root.join("reception.json"),
        &serde_json::to_vec_pretty(&record)?,
    )?;
    println!("PRERECORDED VIDEO RECEIVE: PASS");
    println!("  source video:       {} bytes", record.video_bytes);
    println!(
        "  extracted/decoded:  {}/{}",
        record.extracted_frames, record.decoded_qr_frames
    );
    println!(
        "  decoder rank:       {}/{}",
        record.decoder_rank, record.required_rank
    );
    println!("  signature + digest: VERIFIED");
    println!("  policy workflow:    {}", record.policy_workflow);
    println!("  reception evidence: reception.json");
    Ok(())
}

fn validate_receive(config: &ReceiveConfig) -> Result<()> {
    if config.max_frames == 0 || config.max_frames > MAX_OPTICAL_FRAMES {
        bail!("maximum video frames must be between 1 and {MAX_OPTICAL_FRAMES}");
    }
    Ok(())
}

#[allow(clippy::too_many_lines)] // One benchmark record is assembled from one measured pipeline.
pub(super) fn loopback(config: &LoopbackConfig) -> Result<()> {
    validate(config)?;
    let started = Instant::now();
    let envelope = fs::read(&config.envelope)
        .with_context(|| format!("read envelope {}", config.envelope.display()))?;
    let session_id = match config.session_id {
        Some(value) => value,
        None => random_session_id()?,
    };
    let encoded = encode_frames(
        &envelope,
        session_id,
        config.symbol_size,
        config.frame_count,
    )?;
    let (delivered, channel) = simulate_channel(&encoded.frames, config.channel)?;
    let codec = QrPngCodec::new(config.ecc, config.module_pixels)?;

    create_new_directory(&config.output_dir)?;
    let output_root = fs::canonicalize(&config.output_dir)?;
    let source_frames = output_root.join("source-frames");
    let extracted_frames = output_root.join("extracted-frames");
    fs::create_dir(&source_frames)?;
    fs::create_dir(&extracted_frames)?;

    let render_started = Instant::now();
    let render = render_qr_frames(&source_frames, &delivered, codec)?;
    let render_ms = elapsed_millis(render_started)?;

    let ffmpeg_version = ffmpeg_version(&config.ffmpeg)?;
    let video_path = output_root.join("channel.mp4");
    let encode_started = Instant::now();
    encode_video(
        &config.ffmpeg,
        &source_frames,
        &video_path,
        delivered.len(),
        config.fps,
        config.crf,
        config.scale_percent,
    )?;
    let encode_ms = elapsed_millis(encode_started)?;
    let video_bytes = fs::metadata(&video_path)?.len();
    if video_bytes > MAX_VIDEO_BYTES {
        bail!("encoded video exceeds configured limit");
    }

    let extract_started = Instant::now();
    extract_video(
        &config.ffmpeg,
        &video_path,
        &extracted_frames,
        delivered.len(),
    )?;
    let extract_ms = elapsed_millis(extract_started)?;

    let decode_started = Instant::now();
    let (video_frames, image_stats) = read_qr_frames(&extracted_frames, codec)?;
    let decoded = decode_frames(&video_frames)?;
    let byte_identical = decoded.bytes == envelope;
    if !byte_identical {
        bail!("video-recovered envelope differs from sender envelope");
    }
    let cryptographic_verification = verify_if_requested(config, &decoded.bytes)?;
    let decode_ms = elapsed_millis(decode_started)?;
    let total_ms = elapsed_millis(started)?;
    let harness_processing_rate = goodput(envelope.len(), total_ms)?;
    let emitted_channel_ms = channel_duration(channel.emitted, config.fps)?;
    let video_duration_ms = channel_duration(channel.delivered, config.fps)?;
    let recovered_channel_goodput = goodput(envelope.len(), emitted_channel_ms)?;
    let verified_channel_goodput = cryptographic_verification.then_some(recovered_channel_goodput);

    write_new(&output_root.join("recovered.agx"), &decoded.bytes)?;
    let record = BenchmarkRecord {
        schema: "glassbridge-benchmark/1",
        status: "pass",
        channel: "h264-file-loopback",
        created_unix: unix_now()?,
        host_os: std::env::consts::OS,
        host_arch: std::env::consts::ARCH,
        ffmpeg_version,
        codec: codec.id(),
        error_correction: codec.error_correction().label(),
        configuration: BenchmarkConfiguration {
            symbol_bytes: config.symbol_size,
            requested_frames: config.frame_count,
            session_id: hex_string(&session_id),
            module_pixels: config.module_pixels,
            fps: config.fps,
            h264_crf: config.crf,
            scale_percent: config.scale_percent,
            loss_percent: config.channel.loss_percent,
            corruption_percent: config.channel.corruption_percent,
            duplicate_percent: config.channel.duplicate_percent,
            channel_seed: config.channel.seed,
        },
        envelope: EnvelopeResult {
            bytes: envelope.len(),
            byte_identical,
        },
        transport: transport_result(encoded.source_count, &channel, &decoded),
        video: VideoResult {
            source_png_frames: render.rendered,
            source_png_bytes: render.png_bytes,
            h264_bytes: video_bytes,
            extracted_png_frames: image_stats.images,
            decoded_qr_frames: image_stats.decoded,
            rejected_qr_frames: image_stats.rejected,
        },
        timing_ms: TimingResult {
            render_qr: render_ms,
            encode_h264: encode_ms,
            extract_h264: extract_ms,
            decode_and_recover: decode_ms,
            total: total_ms,
            emitted_channel_duration: emitted_channel_ms,
            encoded_video_duration: video_duration_ms,
        },
        harness_processing_bytes_per_second: harness_processing_rate,
        recovered_channel_goodput_bytes_per_second: recovered_channel_goodput,
        verified_channel_goodput_bytes_per_second: verified_channel_goodput,
        cryptographic_verification: if cryptographic_verification {
            "verified"
        } else {
            "not-requested"
        },
    };
    write_new(
        &output_root.join("benchmark.json"),
        &serde_json::to_vec_pretty(&record)?,
    )?;

    print_result(config, &record);
    Ok(())
}

fn validate(config: &LoopbackConfig) -> Result<()> {
    if !(1..=60).contains(&config.fps) {
        bail!("video fps must be between 1 and 60");
    }
    if config.crf > 51 {
        bail!("H.264 CRF must be between 0 and 51");
    }
    if !(50..=100).contains(&config.scale_percent) {
        bail!("video scale percent must be between 50 and 100");
    }
    if config.public_key.is_some() != config.boundary.is_some() {
        bail!("public key and boundary must be supplied together");
    }
    Ok(())
}

fn verify_if_requested(config: &LoopbackConfig, envelope: &[u8]) -> Result<bool> {
    let (Some(public_key_path), Some(boundary)) = (&config.public_key, &config.boundary) else {
        return Ok(false);
    };
    let key = verifying_key_from_bytes(&fs::read(public_key_path)?)?;
    verify_signed_envelope(envelope, &key, Some(boundary))?;
    Ok(true)
}

fn transport_result(
    source_symbols: usize,
    channel: &ChannelStats,
    decoded: &agx_core::DecodeReport,
) -> TransportResult {
    TransportResult {
        source_symbols,
        emitted_frames: channel.emitted,
        delivered_frames: channel.delivered,
        dropped_frames: channel.dropped,
        corrupted_frames: channel.corrupted,
        duplicated_frames: channel.duplicated,
        accepted_frames: decoded.accepted_frames,
        rejected_crc_frames: decoded.rejected_frames,
        decoder_rank: decoded.rank,
    }
}

#[allow(clippy::too_many_arguments)]
fn encode_video(
    executable: &Path,
    frames_dir: &Path,
    output: &Path,
    frame_count: usize,
    fps: u8,
    crf: u8,
    scale_percent: u8,
) -> Result<()> {
    let input_pattern = frames_dir.join("frame-%06d.png");
    let scale = format!(
        "scale=trunc(iw*{scale_percent}/200)*2:trunc(ih*{scale_percent}/200)*2:flags=lanczos"
    );
    let result = Command::new(executable)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-n")
        .arg("-framerate")
        .arg(fps.to_string())
        .arg("-start_number")
        .arg("0")
        .arg("-i")
        .arg(input_pattern)
        .arg("-frames:v")
        .arg(frame_count.to_string())
        .arg("-vf")
        .arg(scale)
        .arg("-an")
        .arg("-c:v")
        .arg("libx264")
        .arg("-preset")
        .arg("medium")
        .arg("-crf")
        .arg(crf.to_string())
        .arg("-pix_fmt")
        .arg("yuv420p")
        .arg("-movflags")
        .arg("+faststart")
        .arg("-fs")
        .arg(MAX_VIDEO_BYTES.to_string())
        .arg(output)
        .output()
        .with_context(|| format!("run FFmpeg executable {}", executable.display()))?;
    require_success(&result, "encode H.264 video")
}

fn extract_video(
    executable: &Path,
    video: &Path,
    output_dir: &Path,
    frame_count: usize,
) -> Result<()> {
    let output_pattern = output_dir.join("frame-%06d.png");
    let result = Command::new(executable)
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-nostdin")
        .arg("-n")
        .arg("-protocol_whitelist")
        .arg("file")
        .arg("-probesize")
        .arg("10485760")
        .arg("-analyzeduration")
        .arg("10000000")
        .arg("-i")
        .arg(video)
        .arg("-t")
        .arg("300")
        .arg("-fps_mode")
        .arg("passthrough")
        .arg("-frames:v")
        .arg(frame_count.to_string())
        .arg("-start_number")
        .arg("0")
        .arg(output_pattern)
        .output()
        .with_context(|| format!("run FFmpeg executable {}", executable.display()))?;
    require_success(&result, "extract H.264 frames")
}

fn ffmpeg_version(executable: &Path) -> Result<String> {
    let output = Command::new(executable)
        .arg("-version")
        .output()
        .with_context(|| format!("run FFmpeg executable {}", executable.display()))?;
    if !output.status.success() {
        require_success(&output, "query FFmpeg version")?;
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .unwrap_or("unknown FFmpeg version")
        .chars()
        .take(240)
        .collect())
}

fn require_success(output: &Output, operation: &str) -> Result<()> {
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr)
        .chars()
        .take(4_000)
        .collect::<String>();
    bail!("{operation} failed: {detail}");
}

fn elapsed_millis(started: Instant) -> Result<u64> {
    u64::try_from(started.elapsed().as_millis()).context("benchmark duration exceeds u64")
}

fn goodput(bytes: usize, elapsed_ms: u64) -> Result<u64> {
    let bytes = u64::try_from(bytes).context("convert benchmark byte count")?;
    Ok(bytes.saturating_mul(1_000) / elapsed_ms.max(1))
}

fn channel_duration(frames: usize, fps: u8) -> Result<u64> {
    let frames = u64::try_from(frames).context("convert video frame count")?;
    Ok(frames.saturating_mul(1_000) / u64::from(fps))
}

fn print_result(config: &LoopbackConfig, record: &BenchmarkRecord) {
    println!("H.264 VIDEO LOOPBACK: PASS");
    println!("  output directory:   {}", config.output_dir.display());
    println!("  video artifact:     channel.mp4");
    println!("  envelope bytes:     {}", record.envelope.bytes);
    println!("  frames emitted:     {}", record.transport.emitted_frames);
    println!("  frames dropped:     {}", record.transport.dropped_frames);
    println!(
        "  extracted/decoded:  {}/{}",
        record.video.extracted_png_frames, record.video.decoded_qr_frames
    );
    println!(
        "  decoder rank:       {}/{}",
        record.transport.decoder_rank, record.transport.source_symbols
    );
    println!(
        "  signature + digest: {}",
        record.cryptographic_verification.to_ascii_uppercase()
    );
    println!(
        "  channel goodput:    {} bytes/s at {} fps (file-video only)",
        record.recovered_channel_goodput_bytes_per_second, config.fps
    );
    println!(
        "  harness processing: {} bytes/s",
        record.harness_processing_bytes_per_second
    );
    println!("  raw benchmark:      benchmark.json");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn configuration() -> LoopbackConfig {
        LoopbackConfig {
            envelope: "input.agx".into(),
            output_dir: "output".into(),
            public_key: None,
            boundary: None,
            symbol_size: 512,
            frame_count: Some(40),
            session_id: Some([0x47; 16]),
            fps: 30,
            crf: 23,
            scale_percent: 75,
            channel: ChannelConfig::default(),
            ecc: QrEcc::Medium,
            module_pixels: 4,
            ffmpeg: "ffmpeg".into(),
        }
    }

    fn receive_configuration() -> ReceiveConfig {
        ReceiveConfig {
            video: "capture.mp4".into(),
            output_dir: "evidence".into(),
            sender_public_key: "sender.public".into(),
            receiver_secret_key: "receiver.secret".into(),
            policy_file: "policy.json".into(),
            workspace: "receiver".into(),
            boundary: "lab/firmware-in".into(),
            approve: false,
            max_frames: MAX_OPTICAL_FRAMES,
            ffmpeg: "ffmpeg".into(),
        }
    }

    #[test]
    fn validates_benchmark_controls() {
        assert!(validate(&configuration()).is_ok());
        let mut invalid = configuration();
        invalid.fps = 0;
        assert!(validate(&invalid).is_err());
        invalid = configuration();
        invalid.crf = 52;
        assert!(validate(&invalid).is_err());
        invalid = configuration();
        invalid.scale_percent = 49;
        assert!(validate(&invalid).is_err());
        invalid = configuration();
        invalid.public_key = Some("sender.public".into());
        assert!(validate(&invalid).is_err());
    }

    #[test]
    fn calculates_channel_duration_and_integer_goodput() {
        assert_eq!(channel_duration(40, 30).unwrap(), 1_333);
        assert_eq!(goodput(10_429, 1_333).unwrap(), 7_823);
    }

    #[test]
    fn bounds_prerecorded_video_frame_extraction() {
        assert!(validate_receive(&receive_configuration()).is_ok());
        let mut invalid = receive_configuration();
        invalid.max_frames = 0;
        assert!(validate_receive(&invalid).is_err());
        invalid.max_frames = MAX_OPTICAL_FRAMES + 1;
        assert!(validate_receive(&invalid).is_err());
    }
}
