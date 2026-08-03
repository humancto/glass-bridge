# Milestone 5: prerecorded-video receiver

Milestone 5 turns the H.264 experiment into a receiver input. The source video
may be produced elsewhere—including by a camera—while the same AGX trust,
policy, quarantine, replay, import, and receipt controls remain in force.

## See it work

```bash
cargo run --locked -p glassbridge-cli -- video-receive \
  --video capture.mp4 \
  --output-dir reception-evidence \
  --sender-public-key sender.public \
  --receiver-secret-key receiver.secret \
  --policy-file policy.json \
  --workspace receiver-workspace \
  --boundary lab/firmware-in \
  --approve
```

Omit `--approve` to stop after an allowed envelope is quarantined. The command
always requires the expected sender key, boundary, receiver receipt key, and
local policy; there is no unverified import mode.

## Evidence run

The milestone run used the degraded H.264 artifact produced in milestone 4:

```text
PRERECORDED VIDEO RECEIVE: PASS
  source video:       254553 bytes
  extracted/decoded:  33/23
  decoder rank:       21/21
  signature + digest: VERIFIED
  policy workflow:    approved-import
```

The imported payload matched the sender's original payload byte-for-byte. A
second receive against the same policy-state workspace failed before import
with:

```text
GB-DENY-REPLAY: envelope id has already been imported
```

The import receipt now receives the actual accepted and CRC-rejected optical
transport counts instead of placeholder counts.

## Artifacts

- `extracted-frames/`: bounded frames extracted from the source recording;
- `recovered.agx`: signed envelope reconstructed from those frames;
- `reception.json`: unsigned reception evidence defined by
  [RECEPTION-0001](../spec/RECEPTION-0001.md);
- receiver workspace quarantine/import journal and replay state; and
- receiver-signed COSE receipt after approved import.

## Security posture and next gate

The prerecorded file is treated as hostile input, but FFmpeg remains an
unsandboxed native dependency without a wall-clock timeout. This is a research
receiver, not a safe cross-domain video parser.

Milestone 6 should add structured failure evidence, process isolation/timeouts,
a camera-capture environment manifest, and a macOS AVFoundation capture probe.
Only then should the project run repeated physical screen/camera trials and
publish measured physical verified goodput.
