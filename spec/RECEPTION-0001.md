# RECEPTION-0001: prerecorded-video reception evidence

Status: experimental snapshot for GlassBridge milestone 5. The JSON evidence
record is not itself a signed receipt and is not yet a stable interchange
format.

## Receiver sequence

`video-receive` performs these stages in order:

1. require a non-empty regular local video file no larger than 512 MiB;
2. extract at most the configured number of frames through FFmpeg;
3. apply the existing bounded PNG and QR decoder limits;
4. validate AGX-OT framing and CRC, then reach full repair rank;
5. verify the recovered AGX signature, payload digest, and expected boundary;
6. evaluate local policy and replay/rollback state;
7. quarantine and optionally import under a generated safe name;
8. emit the existing signed import receipt when imported; and
9. write `glassbridge-reception/1` JSON evidence after the workflow succeeds.

No payload import occurs from QR bytes before complete AGX verification and an
allowing policy decision.

## Video bounds

The receiver currently enforces:

- local regular files only;
- source video size from 1 byte through 512 MiB;
- FFmpeg protocol whitelist containing only `file`;
- probe size of 10 MiB;
- analysis duration of 10 seconds;
- decoded media duration of at most 300 seconds;
- caller-selected frame cap from 1 through 8,192;
- the AGX-OT set cap of 8,192 frames; and
- all PNG byte, allocation, dimension, and QR ambiguity limits from
  AGX-OT-0001.

These controls do not sandbox FFmpeg, impose a wall-clock child-process
timeout, or prove that a native media decoder is safe against hostile input.

## Evidence fields

The unsigned `reception.json` records:

- schema/status, time, source type, host OS/architecture, and FFmpeg version;
- source video bytes and requested extraction ceiling;
- extracted, QR-decoded, QR-rejected, transport-accepted, and CRC-rejected
  frame counts;
- achieved and required decoder rank;
- recovered envelope bytes, envelope ID, signer key ID, boundary, policy ID,
  purpose, and sequence;
- cryptographic verification and policy workflow status; and
- extraction, decode/verify/policy, and total processing milliseconds.

The evidence file helps reproduce and inspect a run. It does not replace the
receiver-signed COSE import receipt. The signed receipt remains the authoritative
statement that a particular envelope was imported by a particular receiver.

## Failure semantics

Malformed video, bounded-resource violations, insufficient rank, signature or
digest failure, boundary mismatch, policy denial, replay, rollback, or import
failure returns non-zero and does not write a success evidence record. Partial
extracted artifacts may remain inside the newly created evidence directory for
research diagnosis. Structured signed denial/failure evidence remains future
work.
