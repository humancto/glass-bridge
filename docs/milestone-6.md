# Milestone 6: immediate phone + laptop screen demo

Milestone 6 closes the gap between generated QR files and a physical optical
trial. It packages a signed transfer, QR frames, policy, an ephemeral receipt key,
and a self-contained fullscreen player so a laptop and ordinary phone camera
are enough to exercise the channel immediately.

## Run it

```bash
cargo run --locked -p glassbridge-cli -- screen-demo
open work/phone-demo/player.html
```

The generator creates a fresh directory and refuses to overwrite an existing
one. Use `--output-dir` when repeating the demo.

In the player, start the countdown and record the complete QR square with a
phone for at least 15 seconds. Move that recording back to the laptop, open
`work/phone-demo/NEXT-STEPS.txt`, replace `/path/to/phone-recording.mov`, and
run the prepared command.

The receiver accepts `.mov`, `.mp4`, and other formats that the local FFmpeg
build can read. It reconstructs the signed envelope from decoded frames before
the existing verification, policy, quarantine, approval, replay, import, and
signed-receipt workflow runs.

## Bundle contents

- `player.html`: dependency-free, offline fullscreen QR player;
- `frames/`: real binary QR PNGs and a machine-readable export index;
- `sender-envelope.agx`: the signed transfer envelope;
- `policy.json`: default-deny policy bound to the demo sender and boundary;
- `sender.public` and `receiver.public`: verification keys;
- `receiver.secret`: ephemeral demo-only receipt-signing key;
- `sample-input.txt`: expected recovered content; and
- `NEXT-STEPS.txt`: an exact receive command using absolute bundle paths.

The player loops a repair-coded stream, exposes a conservative 1–10 FPS
control, begins with a three-second countdown, and works without a server or
network connection. Its high-contrast layout keeps the QR quiet zone clear and
shows the current frame and loop count.

## Security boundary

This is a research and interoperability demo, not a production cross-domain
solution. The generated private receipt key is intentionally a local demo fixture and
the whole bundle belongs under the ignored `work/` directory. Never copy these
keys into a deployment.

The phone is presently an untrusted camera recorder, not the final receiver.
The recording must return to the laptop for bounded extraction and decoding.
That proves a real display/camera path but does not yet prove direct phone-side
import, hardware-enforced directionality, safe media-parser isolation, or a
specific physical goodput target.

## Acceptance criteria

- one command creates a non-overwriting, offline demo bundle;
- every displayed frame is a real, independently decodable QR PNG;
- no network, hosted site, or phone application is required for capture;
- the prepared receive command pins sender key, policy, boundary, and receiver
  receipt key;
- an approved receive imports bytes identical to `sample-input.txt` and writes
  signed evidence; and
- replaying the same envelope into the same workspace is denied.

## Next gate

Run and publish a device matrix across phone cameras, laptop displays,
distances, angles, ambient light, FPS, and QR density. The following milestone
should add direct macOS AVFoundation capture with subprocess isolation and
timeouts, followed by a browser or native phone receiver that keeps AGX trust
and policy semantics independent of the optical codec.
