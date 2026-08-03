# Browser transport fixture

`rust-browser-frames.txt` was emitted by the Rust CLI with a fixed transport
session and then committed byte-for-byte:

```sh
cargo run --locked -p glassbridge-cli -- screen-demo \
  --output-dir work/rust-browser-fixture \
  --frames 5 \
  --session-id 474c4153534252494447454d3444454d
```

The browser test reconstructs all five systematic symbols and checks the
2,349-byte envelope against SHA-256
`ff19815744190ed9b5936ec142a7916d6771d83a83b6fa75060fd6a82f09722e`.
The signed demo envelope is intentionally not committed because the transport
contract is fully pinned by the frame bytes, decoded length, session ID, and
digest.
