// Renders the seamless open-ocean plate of minimapocean.ksh: EDGE_COLOR0 * paper, fully opaque.
// Usage: node scripts/render-minimap-ocean.mjs [--check]
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKtex } from '../../animation/src/parseKtex.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ocean = JSON.parse(readFileSync(resolve(root, 'packages/prefab/src/minimapOcean.json'), 'utf8'));
const output = resolve(root, 'public/minimap/ocean.png');
const paper = parseKtex(new Uint8Array(readFileSync(resolve(root, 'public/dst/data', ocean.paper))), ocean.paper);
const colour = ocean.tuning.EDGE_COLOR0;

const raw = Buffer.alloc(paper.height * (paper.width * 4 + 1));
for (let y = 0; y < paper.height; y++) {
  const row = y * (paper.width * 4 + 1);
  for (let x = 0; x < paper.width; x++) {
    const from = (y * paper.width + x) * 4, to = row + 1 + x * 4;
    for (let c = 0; c < 3; c++) raw[to + c] = Math.round(colour[c] * paper.pixels[from + c] / 255);
    raw[to + 3] = 255;
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buffer => { let c = 0xffffffff; for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(data.length); head.write(type, 4, 'latin1');
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])));
  return Buffer.concat([head, data, tail]);
};
const header = Buffer.alloc(13); header.writeUInt32BE(paper.width); header.writeUInt32BE(paper.height, 4); header[8] = 8; header[9] = 6;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);

if (process.argv.includes('--check')) {
  if (!existsSync(output) || !readFileSync(output).equals(png)) { console.error(`${output} is out of date`); process.exit(1); }
  console.log('minimap ocean plate is up to date');
} else {
  mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, png);
  console.log(`wrote ${output} (${paper.width}x${paper.height})`);
}
