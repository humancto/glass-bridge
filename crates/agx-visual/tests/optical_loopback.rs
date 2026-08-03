use agx_core::{ChannelConfig, decode_frames, encode_frames, simulate_channel};
use agx_visual::{QrEcc, QrPngCodec, VisualCodec};

#[test]
fn recovers_fountain_frames_after_real_qr_image_roundtrip() {
    let payload = (0_u32..1_024)
        .flat_map(u32::to_be_bytes)
        .collect::<Vec<_>>();
    let encoded = encode_frames(&payload, [0x47; 16], 512, None).unwrap();
    let (delivered, channel) = simulate_channel(
        &encoded.frames,
        ChannelConfig {
            loss_percent: 25,
            corruption_percent: 20,
            duplicate_percent: 8,
            seed: 42,
        },
    )
    .unwrap();
    let codec = QrPngCodec::new(QrEcc::Medium, 3).unwrap();
    let decoded_images = delivered
        .iter()
        .map(|frame| {
            let rendered = codec.encode(frame).unwrap();
            codec.decode(&rendered.png).unwrap().bytes
        })
        .collect::<Vec<_>>();
    let recovered = decode_frames(&decoded_images).unwrap();

    assert_eq!(recovered.bytes, payload);
    assert!(channel.dropped > 0);
    assert!(channel.corrupted > 0);
    assert!(recovered.rejected_frames > 0);
    assert_eq!(recovered.rank, recovered.source_count);
}
