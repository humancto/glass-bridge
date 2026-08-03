use std::convert::TryInto;

use crc32fast::Hasher;
use serde::Serialize;
use thiserror::Error;

const FRAME_MAGIC: &[u8; 4] = b"AGF1";
const HEADER_BYTES: usize = 40;
const CRC_BYTES: usize = 4;
const MAX_SYMBOLS: usize = 1_024;
const MAX_SYMBOL_BYTES: usize = 64 * 1024;
const MAX_TRANSFER_BYTES: usize = 64 * 1024 * 1024 + 64 * 1024;

#[derive(Debug, Clone)]
pub struct EncodedTransfer {
    pub frames: Vec<Vec<u8>>,
    pub source_count: usize,
    pub symbol_size: usize,
}

#[derive(Debug, Clone, Copy)]
pub struct ChannelConfig {
    pub loss_percent: u8,
    pub corruption_percent: u8,
    pub duplicate_percent: u8,
    pub seed: u64,
}

impl Default for ChannelConfig {
    fn default() -> Self {
        Self {
            loss_percent: 35,
            corruption_percent: 5,
            duplicate_percent: 10,
            seed: 0x474c_4153_5342_5247,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct ChannelStats {
    pub emitted: usize,
    pub delivered: usize,
    pub dropped: usize,
    pub corrupted: usize,
    pub duplicated: usize,
}

#[derive(Debug, Clone)]
pub struct DecodeReport {
    pub bytes: Vec<u8>,
    pub accepted_frames: usize,
    pub rejected_frames: usize,
    pub rank: usize,
    pub source_count: usize,
}

#[derive(Debug, Error)]
pub enum TransportError {
    #[error("symbol size must be between 1 and {MAX_SYMBOL_BYTES} bytes")]
    InvalidSymbolSize,
    #[error("transfer exceeds configured limits")]
    SizeLimit,
    #[error("frame is truncated or malformed")]
    InvalidFrame,
    #[error("frame CRC failed")]
    Crc,
    #[error("received frames describe different sessions")]
    MixedSession,
    #[error("insufficient independent symbols: rank {rank} of {required}")]
    InsufficientRank { rank: usize, required: usize },
    #[error("channel percentages must be in the range 0..=100")]
    InvalidChannel,
}

#[derive(Debug, Clone)]
struct Frame {
    session_id: [u8; 16],
    symbol_id: u32,
    source_count: u32,
    symbol_size: u32,
    payload_len: u64,
    symbol: Vec<u8>,
}

#[derive(Debug, Clone)]
struct Row {
    coefficients: Vec<u64>,
    data: Vec<u8>,
}

/// Encodes a payload into systematic and deterministic XOR repair frames.
///
/// # Errors
///
/// Returns an error when the payload, symbol size, symbol count, or requested
/// frame count exceeds the milestone's explicit resource limits.
pub fn encode_frames(
    payload: &[u8],
    session_id: [u8; 16],
    symbol_size: usize,
    frame_count: Option<usize>,
) -> Result<EncodedTransfer, TransportError> {
    if symbol_size == 0 || symbol_size > MAX_SYMBOL_BYTES {
        return Err(TransportError::InvalidSymbolSize);
    }
    if payload.len() > MAX_TRANSFER_BYTES {
        return Err(TransportError::SizeLimit);
    }
    let source_count = payload.len().max(1).div_ceil(symbol_size);
    if source_count > MAX_SYMBOLS {
        return Err(TransportError::SizeLimit);
    }
    let total_frames = frame_count.unwrap_or(source_count.saturating_mul(3).saturating_add(8));
    if total_frames < source_count || total_frames > MAX_SYMBOLS * 8 {
        return Err(TransportError::SizeLimit);
    }

    let source_count_u32 = u32::try_from(source_count).map_err(|_| TransportError::SizeLimit)?;
    let symbol_size_u32 = u32::try_from(symbol_size).map_err(|_| TransportError::SizeLimit)?;
    let mut source = vec![vec![0_u8; symbol_size]; source_count];
    for (index, chunk) in payload.chunks(symbol_size).enumerate() {
        source[index][..chunk.len()].copy_from_slice(chunk);
    }

    let mut frames = Vec::with_capacity(total_frames);
    for symbol_id in 0..total_frames {
        let symbol_id_u32 = u32::try_from(symbol_id).map_err(|_| TransportError::SizeLimit)?;
        let coefficients = coefficients(session_id, symbol_id_u32, source_count);
        let mut symbol = vec![0_u8; symbol_size];
        for (source_index, source_symbol) in source.iter().enumerate() {
            if bit_is_set(&coefficients, source_index) {
                xor_bytes(&mut symbol, source_symbol);
            }
        }
        frames.push(
            Frame {
                session_id,
                symbol_id: symbol_id_u32,
                source_count: source_count_u32,
                symbol_size: symbol_size_u32,
                payload_len: payload.len() as u64,
                symbol,
            }
            .to_bytes(),
        );
    }

    Ok(EncodedTransfer {
        frames,
        source_count,
        symbol_size,
    })
}

/// Applies deterministic loss, corruption, duplication, and reordering.
///
/// # Errors
///
/// Returns [`TransportError::InvalidChannel`] when a percentage exceeds 100.
pub fn simulate_channel(
    frames: &[Vec<u8>],
    config: ChannelConfig,
) -> Result<(Vec<Vec<u8>>, ChannelStats), TransportError> {
    if [
        config.loss_percent,
        config.corruption_percent,
        config.duplicate_percent,
    ]
    .into_iter()
    .any(|value| value > 100)
    {
        return Err(TransportError::InvalidChannel);
    }

    let mut rng_state = config.seed;
    let mut delivered = Vec::with_capacity(frames.len());
    let mut stats = ChannelStats {
        emitted: frames.len(),
        delivered: 0,
        dropped: 0,
        corrupted: 0,
        duplicated: 0,
    };

    for frame in frames {
        if percentage_roll(&mut rng_state) < config.loss_percent {
            stats.dropped += 1;
            continue;
        }
        let mut candidate = frame.clone();
        if percentage_roll(&mut rng_state) < config.corruption_percent
            && candidate.len() > HEADER_BYTES + CRC_BYTES
        {
            let body_len = candidate.len() - HEADER_BYTES - CRC_BYTES;
            let body_len_u64 = u64::try_from(body_len).map_err(|_| TransportError::SizeLimit)?;
            let offset_in_body = usize::try_from(next_u64(&mut rng_state) % body_len_u64)
                .map_err(|_| TransportError::SizeLimit)?;
            let offset = HEADER_BYTES + offset_in_body;
            candidate[offset] ^= 0x80;
            stats.corrupted += 1;
        }
        delivered.push(candidate.clone());
        if percentage_roll(&mut rng_state) < config.duplicate_percent {
            delivered.push(candidate);
            stats.duplicated += 1;
        }
    }
    shuffle(&mut delivered, &mut rng_state)?;
    stats.delivered = delivered.len();
    Ok((delivered, stats))
}

/// Reconstructs a transfer after validating frame structure and CRCs.
///
/// # Errors
///
/// Returns an error for malformed or mixed-session frames, resource-limit
/// violations, or when the received equations do not have full rank.
pub fn decode_frames(raw_frames: &[Vec<u8>]) -> Result<DecodeReport, TransportError> {
    if raw_frames.len() > MAX_SYMBOLS * 8 {
        return Err(TransportError::SizeLimit);
    }
    let mut rejected_frames = 0;
    let mut parsed = Vec::with_capacity(raw_frames.len());
    for bytes in raw_frames {
        match Frame::from_bytes(bytes) {
            Ok(frame) => parsed.push(frame),
            Err(TransportError::Crc | TransportError::InvalidFrame) => rejected_frames += 1,
            Err(error) => return Err(error),
        }
    }
    let first = parsed.first().ok_or(TransportError::InsufficientRank {
        rank: 0,
        required: 1,
    })?;
    let source_count = first.source_count as usize;
    let symbol_size = first.symbol_size as usize;
    let payload_len = usize::try_from(first.payload_len).map_err(|_| TransportError::SizeLimit)?;
    if source_count == 0
        || source_count > MAX_SYMBOLS
        || symbol_size == 0
        || symbol_size > MAX_SYMBOL_BYTES
        || payload_len > MAX_TRANSFER_BYTES
        || payload_len > source_count.saturating_mul(symbol_size)
    {
        return Err(TransportError::SizeLimit);
    }
    if parsed.iter().any(|frame| {
        frame.session_id != first.session_id
            || frame.source_count != first.source_count
            || frame.symbol_size != first.symbol_size
            || frame.payload_len != first.payload_len
    }) {
        return Err(TransportError::MixedSession);
    }

    let mut basis: Vec<Option<Row>> = (0..source_count).map(|_| None).collect();
    let mut rank = 0;
    for frame in &parsed {
        let mut row = Row {
            coefficients: coefficients(frame.session_id, frame.symbol_id, source_count),
            data: frame.symbol.clone(),
        };
        while let Some(pivot) = first_set(&row.coefficients, source_count) {
            if let Some(existing) = &basis[pivot] {
                xor_words(&mut row.coefficients, &existing.coefficients);
                xor_bytes(&mut row.data, &existing.data);
            } else {
                basis[pivot] = Some(row);
                rank += 1;
                break;
            }
        }
        if rank == source_count {
            break;
        }
    }
    if rank != source_count {
        return Err(TransportError::InsufficientRank {
            rank,
            required: source_count,
        });
    }

    let mut solved = vec![vec![0_u8; symbol_size]; source_count];
    for pivot in (0..source_count).rev() {
        let row = basis[pivot]
            .as_ref()
            .ok_or(TransportError::InsufficientRank {
                rank,
                required: source_count,
            })?;
        let mut data = row.data.clone();
        for (index, solved_symbol) in solved.iter().enumerate().skip(pivot + 1) {
            if bit_is_set(&row.coefficients, index) {
                xor_bytes(&mut data, solved_symbol);
            }
        }
        solved[pivot] = data;
    }

    let mut bytes = Vec::with_capacity(source_count * symbol_size);
    for symbol in solved {
        bytes.extend_from_slice(&symbol);
    }
    bytes.truncate(payload_len);
    Ok(DecodeReport {
        bytes,
        accepted_frames: parsed.len(),
        rejected_frames,
        rank,
        source_count,
    })
}

impl Frame {
    fn to_bytes(&self) -> Vec<u8> {
        let mut bytes = Vec::with_capacity(HEADER_BYTES + self.symbol.len() + CRC_BYTES);
        bytes.extend_from_slice(FRAME_MAGIC);
        bytes.extend_from_slice(&self.session_id);
        bytes.extend_from_slice(&self.symbol_id.to_be_bytes());
        bytes.extend_from_slice(&self.source_count.to_be_bytes());
        bytes.extend_from_slice(&self.symbol_size.to_be_bytes());
        bytes.extend_from_slice(&self.payload_len.to_be_bytes());
        bytes.extend_from_slice(&self.symbol);
        let mut hasher = Hasher::new();
        hasher.update(&bytes);
        bytes.extend_from_slice(&hasher.finalize().to_be_bytes());
        bytes
    }

    fn from_bytes(bytes: &[u8]) -> Result<Self, TransportError> {
        if bytes.len() < HEADER_BYTES + CRC_BYTES || &bytes[..4] != FRAME_MAGIC {
            return Err(TransportError::InvalidFrame);
        }
        if bytes.len() > HEADER_BYTES + MAX_SYMBOL_BYTES + CRC_BYTES {
            return Err(TransportError::SizeLimit);
        }
        let crc_offset = bytes.len() - CRC_BYTES;
        let expected_crc = u32::from_be_bytes(
            bytes[crc_offset..]
                .try_into()
                .map_err(|_| TransportError::InvalidFrame)?,
        );
        let mut hasher = Hasher::new();
        hasher.update(&bytes[..crc_offset]);
        if hasher.finalize() != expected_crc {
            return Err(TransportError::Crc);
        }
        let session_id = bytes[4..20]
            .try_into()
            .map_err(|_| TransportError::InvalidFrame)?;
        let symbol_id = read_u32(bytes, 20)?;
        let source_count = read_u32(bytes, 24)?;
        let symbol_size = read_u32(bytes, 28)?;
        let payload_len = read_u64(bytes, 32)?;
        if source_count == 0
            || source_count as usize > MAX_SYMBOLS
            || symbol_size == 0
            || symbol_size as usize > MAX_SYMBOL_BYTES
            || payload_len > MAX_TRANSFER_BYTES as u64
        {
            return Err(TransportError::SizeLimit);
        }
        if bytes.len() != HEADER_BYTES + symbol_size as usize + CRC_BYTES {
            return Err(TransportError::InvalidFrame);
        }
        Ok(Self {
            session_id,
            symbol_id,
            source_count,
            symbol_size,
            payload_len,
            symbol: bytes[HEADER_BYTES..crc_offset].to_vec(),
        })
    }
}

fn coefficients(session_id: [u8; 16], symbol_id: u32, source_count: usize) -> Vec<u64> {
    let word_count = source_count.div_ceil(64);
    let mut words = vec![0_u64; word_count];
    if let Ok(systematic_index) = usize::try_from(symbol_id)
        && systematic_index < source_count
    {
        set_bit(&mut words, systematic_index);
        return words;
    }
    let mut left = [0_u8; 8];
    let mut right = [0_u8; 8];
    left.copy_from_slice(&session_id[..8]);
    right.copy_from_slice(&session_id[8..]);
    let mut state = u64::from_be_bytes(left)
        ^ u64::from_be_bytes(right).rotate_left(17)
        ^ u64::from(symbol_id).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    for word in &mut words {
        *word = next_u64(&mut state);
    }
    let excess = word_count * 64 - source_count;
    if excess > 0 {
        let keep = 64 - excess;
        words[word_count - 1] &= (1_u64 << keep) - 1;
    }
    if words.iter().all(|word| *word == 0) {
        set_bit(&mut words, symbol_id as usize % source_count);
    }
    words
}

fn percentage_roll(state: &mut u64) -> u8 {
    (next_u64(state) % 100) as u8
}

fn next_u64(state: &mut u64) -> u64 {
    *state = state.wrapping_add(0x9e37_79b9_7f4a_7c15);
    let mut value = *state;
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn shuffle<T>(values: &mut [T], state: &mut u64) -> Result<(), TransportError> {
    for index in (1..values.len()).rev() {
        let bound = u64::try_from(index + 1).map_err(|_| TransportError::SizeLimit)?;
        let swap_with =
            usize::try_from(next_u64(state) % bound).map_err(|_| TransportError::SizeLimit)?;
        values.swap(index, swap_with);
    }
    Ok(())
}

fn set_bit(words: &mut [u64], index: usize) {
    words[index / 64] |= 1_u64 << (index % 64);
}

fn bit_is_set(words: &[u64], index: usize) -> bool {
    words[index / 64] & (1_u64 << (index % 64)) != 0
}

fn first_set(words: &[u64], max_bits: usize) -> Option<usize> {
    words.iter().enumerate().find_map(|(word_index, word)| {
        if *word == 0 {
            return None;
        }
        let bit = word.trailing_zeros() as usize;
        let index = word_index * 64 + bit;
        (index < max_bits).then_some(index)
    })
}

fn xor_bytes(left: &mut [u8], right: &[u8]) {
    for (target, value) in left.iter_mut().zip(right) {
        *target ^= value;
    }
}

fn xor_words(left: &mut [u64], right: &[u64]) {
    for (target, value) in left.iter_mut().zip(right) {
        *target ^= value;
    }
}

fn read_u32(bytes: &[u8], offset: usize) -> Result<u32, TransportError> {
    Ok(u32::from_be_bytes(
        bytes[offset..offset + 4]
            .try_into()
            .map_err(|_| TransportError::InvalidFrame)?,
    ))
}

fn read_u64(bytes: &[u8], offset: usize) -> Result<u64, TransportError> {
    Ok(u64::from_be_bytes(
        bytes[offset..offset + 8]
            .try_into()
            .map_err(|_| TransportError::InvalidFrame)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recovers_after_loss_corruption_reordering_and_duplicates() {
        let payload = (0_u32..20_000)
            .flat_map(u32::to_be_bytes)
            .collect::<Vec<_>>();
        let encoded = encode_frames(&payload, [7_u8; 16], 512, None).unwrap();
        let (delivered, stats) = simulate_channel(
            &encoded.frames,
            ChannelConfig {
                loss_percent: 40,
                corruption_percent: 7,
                duplicate_percent: 12,
                seed: 42,
            },
        )
        .unwrap();
        let decoded = decode_frames(&delivered).unwrap();
        assert_eq!(decoded.bytes, payload);
        assert!(stats.dropped > 0);
        assert!(decoded.rejected_frames > 0);
    }

    #[test]
    fn fails_closed_when_rank_is_insufficient() {
        let encoded =
            encode_frames(b"a payload spanning several symbols", [9_u8; 16], 4, None).unwrap();
        let error = decode_frames(&encoded.frames[..1]).unwrap_err();
        assert!(matches!(error, TransportError::InsufficientRank { .. }));
    }

    #[test]
    fn rejects_crc_corruption() {
        let encoded = encode_frames(b"payload", [1_u8; 16], 64, Some(1)).unwrap();
        let mut frame = encoded.frames[0].clone();
        frame[HEADER_BYTES] ^= 1;
        let error = decode_frames(&[frame]).unwrap_err();
        assert!(matches!(error, TransportError::InsufficientRank { .. }));
    }

    #[test]
    fn rejects_unbounded_frame_sets_before_parsing() {
        let frames = vec![Vec::new(); MAX_SYMBOLS * 8 + 1];
        let error = decode_frames(&frames).unwrap_err();
        assert!(matches!(error, TransportError::SizeLimit));
    }
}
