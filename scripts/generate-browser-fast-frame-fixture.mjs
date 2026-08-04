import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";

const OUTPUT = fileURLToPath(new URL(
  "../tests/fixtures/browser-fast-frame-v33.png",
  import.meta.url,
));
const FRAME_MAGIC = Uint8Array.from([0x41, 0x47, 0x46, 0x31]);
const HEADER_BYTES = 40;
const SYMBOL_BYTES = 1_536;
const CRC_BYTES = 4;

const payload = Uint8Array.from(
  { length: 900 },
  (_, index) => (index * 31 + 17) & 0xff,
);
const frame = new Uint8Array(HEADER_BYTES + SYMBOL_BYTES + CRC_BYTES);
frame.set(FRAME_MAGIC, 0);
frame.fill(0x47, 4, 20);
const view = new DataView(frame.buffer);
view.setUint32(20, 0, false);
view.setUint32(24, 1, false);
view.setUint32(28, SYMBOL_BYTES, false);
view.setBigUint64(32, BigInt(payload.length), false);
frame.set(payload, HEADER_BYTES);
view.setUint32(frame.length - CRC_BYTES, crc32(frame.subarray(0, -CRC_BYTES)), false);

const qr = QRCode.create([{ data: frame, mode: "byte" }], {
  errorCorrectionLevel: "M",
});
if (qr.version !== 33) {
  throw new Error(`Expected fast-profile QR version 33, got ${qr.version}.`);
}
const png = await QRCode.toBuffer([{ data: frame, mode: "byte" }], {
  errorCorrectionLevel: "M",
  margin: 4,
  scale: 5,
  type: "png",
});
await writeFile(OUTPUT, png);
console.log(JSON.stringify({ output: OUTPUT, frameBytes: frame.length, qrVersion: qr.version, pngBytes: png.length }));

function crc32(bytes) {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

