import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { parseKtex } from '../../animation/src/parseKtex.ts';

// Decode native HUD regions using the runtime's KTEX decoder; PNGs are UI exports.
const source = '/data/copy/AssetArchive-Dev/data/DST/data';
const destination = fileURLToPath(new URL('../../../public/dst/data/ui/bag/', import.meta.url));
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(argument => argument !== '--check')) throw new Error('Usage: node import-self-inspect-icons.mjs [--check]');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, bytes) {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc32(data));
  return Buffer.concat([length, data, checksum]);
}

function png(texture, element) {
  // imageAtlasParser.ts atlasElementBounds: UVs include the texel centres.
  const left = Math.max(0, Math.floor(texture.width * Number(element.u1)));
  const top = Math.max(0, Math.floor(texture.height * (1 - Number(element.v2))));
  const right = Math.min(texture.width, Math.floor(texture.width * Number(element.u2)) + 1);
  const bottom = Math.min(texture.height, Math.floor(texture.height * (1 - Number(element.v1))) + 1);
  const width = right - left, height = bottom - top;
  if (width <= 0 || height <= 0) throw new Error(`Invalid bounds: ${element.name}`);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const start = ((top + y) * texture.width + left) * 4;
    rows.set(texture.pixels.subarray(start, start + width * 4), y * (width * 4 + 1) + 1);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

let count = 0;
const names = new Set();
for (const atlas of ['hud', 'hud2']) {
  const xml = readFileSync(`${source}/images/${atlas}.xml`, 'utf8');
  const texture = parseKtex(readFileSync(`${source}/images/${atlas}.tex`), `${atlas}.tex`);
  for (const [tag] of xml.matchAll(/<Element\s[^>]+\/>/g)) {
    const element = Object.fromEntries([...tag.matchAll(/(\w+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
    if (!/^self_inspect_[a-z0-9_]+\.tex$/.test(element.name) || names.has(element.name)) continue;
    names.add(element.name);
    const bytes = png(texture, element), path = `${destination}${element.name}.png`;
    if (check) {
      if (!readFileSync(path).equals(bytes)) throw new Error(`Different native icon: ${element.name}`);
    } else { mkdirSync(destination, { recursive: true }); writeFileSync(path, bytes); }
    count++;
  }
}
if (!names.has('self_inspect_waxwell.tex')) throw new Error('Missing Maxwell self-inspect icon');
console.log(`${check ? 'Checked' : 'Imported'} ${count} native self-inspect icons`);
