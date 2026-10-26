// Generates the original SnapMeet icon (a figure dissolving into dust) as PNGs without
// external dependencies. Output: public/assets/icon-{16,32,48,128}.png
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'assets');
mkdirSync(out, { recursive: true });

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Shape sampler in unit coordinates (0..1). Returns [r,g,b,a].
const BG = [28, 29, 32];
const AMBER = [242, 181, 68];
const dots = [
  [0.66, 0.36, 0.035], [0.74, 0.3, 0.03], [0.8, 0.42, 0.028], [0.71, 0.5, 0.032],
  [0.86, 0.33, 0.022], [0.84, 0.52, 0.024], [0.77, 0.6, 0.026], [0.9, 0.45, 0.018],
];
function sample(x, y) {
  const r = 0.22; // rounded-square corner radius
  const qx = Math.max(Math.abs(x - 0.5) - (0.5 - r), 0);
  const qy = Math.max(Math.abs(y - 0.5) - (0.5 - r), 0);
  if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  const head = Math.hypot(x - 0.42, y - 0.36) < 0.12;
  const body = (x - 0.42) ** 2 / 0.2 ** 2 + (y - 0.82) ** 2 / 0.26 ** 2 < 1 && y < 0.92;
  // the figure fades out on its right side into dust
  const fade = x < 0.5 || (x - 0.5) * 7 < Math.sin(y * 40) * 0.5 + 0.5;
  if ((head || body) && fade) return [...AMBER, 255];
  if (dots.some(([dx, dy, dr]) => Math.hypot(x - dx, y - dy) < dr)) return [...AMBER, 255];
  return [...BG, 255];
}

for (const size of [16, 32, 48, 128]) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          for (let i = 0; i < 3; i++) acc[i] += c[i] * c[3];
          acc[3] += c[3];
        }
      const a = acc[3] / (ss * ss);
      const o = (y * size + x) * 4;
      for (let i = 0; i < 3; i++) buf[o + i] = acc[3] ? Math.round(acc[i] / acc[3]) : 0;
      buf[o + 3] = Math.round(a);
    }
  }
  writeFileSync(join(out, `icon-${size}.png`), png(size, buf));
}
console.log('[icons] wrote public/assets/icon-*.png');
