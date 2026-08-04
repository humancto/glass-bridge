use agx_core::encode_frames;
use agx_visual::{QrEcc, QrPngCodec, VisualCodec};

#[test]
fn decodes_browser_generated_fast_binary_qr_byte_for_byte() {
    let payload = (0_usize..900)
        .map(|index| u8::try_from((index * 31 + 17) & 0xff).unwrap())
        .collect::<Vec<_>>();
    let rust = encode_frames(&payload, [0x47; 16], 1_536, Some(1)).unwrap();
    let browser_png = include_bytes!("../../../tests/fixtures/browser-fast-frame-v33.png");
    let decoded = QrPngCodec::new(QrEcc::Medium, 5)
        .unwrap()
        .decode(browser_png)
        .unwrap();

    assert_eq!(decoded.qr_version, 33);
    assert_eq!(decoded.bytes, rust.frames[0]);
}
