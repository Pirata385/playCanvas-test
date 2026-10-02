// Dev utility: renders the generated minimap for a seed to a PNG for quick visual checks.
// Usage: npx vite-node scripts/preview-map.ts <seed> <out.png>
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { generateWorld } from '../src/world/generate';

const seed = Number(process.argv[2] ?? 1337);
const out = process.argv[3] ?? 'map.png';
const w = generateWorld(seed);
console.log(JSON.stringify(w.stats), 'spawn', w.spawn);
const R = w.res;
const raw = Buffer.alloc((R * 4 + 1) * R);
for (let z = 0; z < R; z++) {
  raw[z * (R * 4 + 1)] = 0;
  for (let x = 0; x < R * 4; x++) raw[z * (R * 4 + 1) + 1 + x] = w.mapPixels[z * R * 4 + x];
}
const crcTable = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc = (buf: Buffer) => {
  let c = -1;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(R, 0);
ihdr.writeUInt32BE(R, 4);
ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(out, Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))
]));
