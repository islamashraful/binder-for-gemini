// Draws the extension icon (a white folder on a blue rounded square) and
// writes PNGs to public/icon/. Run with: bun run icons
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const SIZES = [16, 32, 48, 128];
const SS = 4; // supersampling for smooth edges

/** Signed distance to a rounded rectangle (negative = inside). Units: 128px canvas. */
function roundRect(x: number, y: number, x0: number, y0: number, x1: number, y1: number, r: number) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const hx = (x1 - x0) / 2 - r;
  const hy = (y1 - y0) / 2 - r;
  const dx = Math.max(Math.abs(x - cx) - hx, 0);
  const dy = Math.max(Math.abs(y - cy) - hy, 0);
  const outside = Math.hypot(dx, dy);
  const inside = Math.min(Math.max(Math.abs(x - cx) - hx, Math.abs(y - cy) - hy), 0);
  return outside + inside - r;
}

function pixel(x: number, y: number): [number, number, number, number] {
  const bg = roundRect(x, y, 4, 4, 124, 124, 28) <= 0;
  if (!bg) return [0, 0, 0, 0];
  const tab = roundRect(x, y, 26, 32, 62, 56, 7) <= 0;
  const body = roundRect(x, y, 26, 44, 102, 96, 9) <= 0;
  if (tab || body) return [255, 255, 255, 255];
  // Diagonal gradient, blue to violet.
  const t = (x + y) / 256;
  return [Math.round(66 + (124 - 66) * t), Math.round(110 + (92 - 110) * t), 240, 255];
}

function render(size: number): Buffer {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = ((px + (sx + 0.5) / SS) / size) * 128;
          const y = ((py + (sy + 0.5) / SS) / size) * 128;
          const [r, g, b, a] = pixel(x, y);
          acc[0]! += r * a;
          acc[1]! += g * a;
          acc[2]! += b * a;
          acc[3]! += a;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const alpha = acc[3]! / (SS * SS);
      raw[o] = alpha ? Math.round(acc[0]! / acc[3]!) : 0;
      raw[o + 1] = alpha ? Math.round(acc[1]! / acc[3]!) : 0;
      raw[o + 2] = alpha ? Math.round(acc[2]! / acc[3]!) : 0;
      raw[o + 3] = Math.round(alpha);
    }
  }
  return png(size, size, raw);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(w: number, h: number, raw: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icon', { recursive: true });
for (const size of SIZES) {
  writeFileSync(`public/icon/${size}.png`, render(size));
  console.log(`public/icon/${size}.png`);
}
