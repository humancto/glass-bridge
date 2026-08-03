//! Bounded visual codecs for `GlassBridge` optical transport frames.
//!
//! The codec is intentionally unaware of AGX envelope semantics and fountain
//! coding. Its only contract is byte-exact conversion between one hostile
//! transport frame and one visual artifact.

use std::io::Cursor;

use image::{ImageFormat, ImageReader, Limits, Luma};
use qrcode::{EcLevel, QrCode, Version};
use thiserror::Error;

/// Maximum encoded PNG accepted by the decoder.
pub const MAX_PNG_BYTES: usize = 8 * 1024 * 1024;
/// Maximum image width or height accepted by the decoder.
pub const MAX_IMAGE_DIMENSION: u32 = 2_048;
/// Maximum raw frame size sent to the QR encoder.
pub const MAX_QR_FRAME_BYTES: usize = 2_048;

/// A byte-preserving visual transport codec.
pub trait VisualCodec {
    /// Stable identifier recorded in benchmark and export metadata.
    fn id(&self) -> &'static str;

    /// Renders one transport frame into a visual artifact.
    ///
    /// # Errors
    ///
    /// Returns an error when input or output limits are exceeded or encoding
    /// fails.
    fn encode(&self, frame: &[u8]) -> Result<RenderedFrame, CodecError>;

    /// Recovers one transport frame from an untrusted visual artifact.
    ///
    /// # Errors
    ///
    /// Returns an error for oversized, malformed, empty, or ambiguous images.
    fn decode(&self, artifact: &[u8]) -> Result<DecodedFrame, CodecError>;
}

/// Error-correction levels supported by the baseline QR codec.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QrEcc {
    Low,
    Medium,
    Quartile,
    High,
}

impl QrEcc {
    #[must_use]
    pub const fn label(self) -> &'static str {
        match self {
            Self::Low => "L",
            Self::Medium => "M",
            Self::Quartile => "Q",
            Self::High => "H",
        }
    }
}

impl From<QrEcc> for EcLevel {
    fn from(value: QrEcc) -> Self {
        match value {
            QrEcc::Low => Self::L,
            QrEcc::Medium => Self::M,
            QrEcc::Quartile => Self::Q,
            QrEcc::High => Self::H,
        }
    }
}

/// PNG QR implementation used as the first codec baseline.
#[derive(Debug, Clone, Copy)]
pub struct QrPngCodec {
    error_correction: QrEcc,
    module_pixels: u32,
}

impl QrPngCodec {
    /// Creates a QR/PNG codec with bounded integer module scaling.
    ///
    /// # Errors
    ///
    /// Returns [`CodecError::InvalidModulePixels`] unless the module size is
    /// between 2 and 16 pixels.
    pub fn new(error_correction: QrEcc, module_pixels: u32) -> Result<Self, CodecError> {
        if !(2..=16).contains(&module_pixels) {
            return Err(CodecError::InvalidModulePixels);
        }
        Ok(Self {
            error_correction,
            module_pixels,
        })
    }

    #[must_use]
    pub const fn error_correction(self) -> QrEcc {
        self.error_correction
    }

    #[must_use]
    pub const fn module_pixels(self) -> u32 {
        self.module_pixels
    }
}

/// Encoded image plus observable codec parameters.
#[derive(Debug, Clone)]
pub struct RenderedFrame {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    pub qr_version: i16,
}

/// Byte-exact decoder result plus detected QR metadata.
#[derive(Debug, Clone)]
pub struct DecodedFrame {
    pub bytes: Vec<u8>,
    pub qr_version: usize,
}

#[derive(Debug, Error)]
pub enum CodecError {
    #[error("QR module size must be between 2 and 16 pixels")]
    InvalidModulePixels,
    #[error("visual frame exceeds the configured byte limit")]
    FrameTooLarge,
    #[error("PNG artifact exceeds the configured byte limit")]
    ImageTooLarge,
    #[error("QR encoding failed: {0}")]
    QrEncode(String),
    #[error("PNG processing failed: {0}")]
    Png(String),
    #[error("no decodable QR code found")]
    QrNotFound,
    #[error("image contains more than one decodable QR code")]
    AmbiguousImage,
}

impl VisualCodec for QrPngCodec {
    fn id(&self) -> &'static str {
        "qr/png-v1"
    }

    fn encode(&self, frame: &[u8]) -> Result<RenderedFrame, CodecError> {
        if frame.is_empty() || frame.len() > MAX_QR_FRAME_BYTES {
            return Err(CodecError::FrameTooLarge);
        }
        let code = QrCode::with_error_correction_level(frame, self.error_correction.into())
            .map_err(|error| CodecError::QrEncode(error.to_string()))?;
        let qr_version = match code.version() {
            Version::Normal(value) => value,
            Version::Micro(_) => {
                return Err(CodecError::QrEncode(
                    "unexpected Micro QR version".to_owned(),
                ));
            }
        };
        let image = code
            .render::<Luma<u8>>()
            .dark_color(Luma([0_u8]))
            .light_color(Luma([255_u8]))
            .module_dimensions(self.module_pixels, self.module_pixels)
            .build();
        if image.width() > MAX_IMAGE_DIMENSION || image.height() > MAX_IMAGE_DIMENSION {
            return Err(CodecError::ImageTooLarge);
        }
        let mut cursor = Cursor::new(Vec::new());
        image
            .write_to(&mut cursor, ImageFormat::Png)
            .map_err(|error| CodecError::Png(error.to_string()))?;
        let png = cursor.into_inner();
        if png.len() > MAX_PNG_BYTES {
            return Err(CodecError::ImageTooLarge);
        }
        Ok(RenderedFrame {
            png,
            width: image.width(),
            height: image.height(),
            qr_version,
        })
    }

    fn decode(&self, artifact: &[u8]) -> Result<DecodedFrame, CodecError> {
        if artifact.is_empty() || artifact.len() > MAX_PNG_BYTES {
            return Err(CodecError::ImageTooLarge);
        }
        let mut reader = ImageReader::with_format(Cursor::new(artifact), ImageFormat::Png);
        let mut limits = Limits::default();
        limits.max_image_width = Some(MAX_IMAGE_DIMENSION);
        limits.max_image_height = Some(MAX_IMAGE_DIMENSION);
        limits.max_alloc = Some(64 * 1024 * 1024);
        reader.limits(limits);
        let grayscale = reader
            .decode()
            .map_err(|error| CodecError::Png(error.to_string()))?
            .into_luma8();
        let mut decoder = quircs::Quirc::default();
        let mut candidates = Vec::new();
        for code in decoder.identify(
            grayscale.width() as usize,
            grayscale.height() as usize,
            grayscale.as_raw(),
        ) {
            let Ok(code) = code else {
                continue;
            };
            let Ok(data) = code.decode() else {
                continue;
            };
            candidates.push(DecodedFrame {
                bytes: data.payload,
                qr_version: data.version,
            });
        }
        match candidates.len() {
            0 => Err(CodecError::QrNotFound),
            1 => Ok(candidates.remove(0)),
            _ => Err(CodecError::AmbiguousImage),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_arbitrary_binary_bytes() {
        let payload = (0_u8..=u8::MAX).cycle().take(1_024).collect::<Vec<_>>();
        let codec = QrPngCodec::new(QrEcc::Medium, 4).unwrap();
        let image = codec.encode(&payload).unwrap();
        let decoded = codec.decode(&image.png).unwrap();
        assert_eq!(decoded.bytes, payload);
        assert!(image.width <= MAX_IMAGE_DIMENSION);
        assert_eq!(image.width, image.height);
        assert!(decoded.qr_version > 0);
    }

    #[test]
    fn enforces_configuration_and_input_bounds() {
        assert!(matches!(
            QrPngCodec::new(QrEcc::Medium, 1),
            Err(CodecError::InvalidModulePixels)
        ));
        let codec = QrPngCodec::new(QrEcc::Medium, 4).unwrap();
        assert!(matches!(
            codec.encode(&vec![0; MAX_QR_FRAME_BYTES + 1]),
            Err(CodecError::FrameTooLarge)
        ));
        assert!(matches!(
            codec.decode(&vec![0; MAX_PNG_BYTES + 1]),
            Err(CodecError::ImageTooLarge)
        ));
    }

    #[test]
    fn rejects_non_png_and_blank_png() {
        let codec = QrPngCodec::new(QrEcc::Medium, 4).unwrap();
        assert!(matches!(
            codec.decode(b"not a PNG"),
            Err(CodecError::Png(_))
        ));

        let blank = image::GrayImage::from_pixel(128, 128, Luma([255]));
        let mut cursor = Cursor::new(Vec::new());
        blank.write_to(&mut cursor, ImageFormat::Png).unwrap();
        assert!(matches!(
            codec.decode(&cursor.into_inner()),
            Err(CodecError::QrNotFound)
        ));
    }
}
