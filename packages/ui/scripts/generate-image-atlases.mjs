import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { atlasElementBounds, parseImageAtlasArchive } from '../../animation/src/imageAtlasParser.ts';
import { parseKtex } from '../../animation/src/parseKtex.ts';
import { UI_IMAGE_ATLAS_PATHS } from '../src/image-atlas-paths.ts';

const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--check')) {
  throw new Error('Usage: node scripts/generate-image-atlases.mjs [--check]');
}
const check = args.includes('--check');
const dataRoot = new URL('../../../public/dst/data/', import.meta.url);
const output = fileURLToPath(new URL('ui/atlases/', dataRoot));
const archive = readFileSync(new URL('databundles/images.zip', dataRoot));
const expected = new Set();
const stale = [];

function emit(name, bytes) {
  expected.add(name);
  const path = join(output, name);
  if (check) {
    if (!readFileSync(path).equals(bytes)) {
      stale.push(name);
    }
  } else {
    writeFileSync(path, bytes);
  }
}

function chunk(type, bytes) {
  const result = Buffer.alloc(bytes.length + 12);
  result.writeUInt32BE(bytes.length, 0);
  result.write(type, 4, 'ascii');
  result.set(bytes, 8);
  result.writeUInt32BE(crc32(result.subarray(4, -4)), result.length - 4);
  return result;
}

function encodeRgba({ width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6; // Truecolour with alpha.
  const rowBytes = width * 4;
  const rows = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    // The runtime decoder already returns the atlas in top-down order.
    rows.set(pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

if (!check) {
  mkdirSync(output, { recursive: true });
}
const atlases = {};
const pages = {};
const textureNames = new Map();
for (const path of UI_IMAGE_ATLAS_PATHS) {
  const atlas = parseImageAtlasArchive(archive, path);
  const members = [];
  for (const page of atlas.pages) {
    const name = basename(page.texturePath, '.tex') + '.png';
    if (textureNames.has(name) && textureNames.get(name) !== page.texturePath) {
      throw new Error(`Duplicate PNG filename: ${name}`);
    }
    if (!textureNames.has(name)) {
      emit(name, encodeRgba(parseKtex(page.ktex, page.texturePath)));
      textureNames.set(name, page.texturePath);
    }
    const pagePath = page.path.toLowerCase();
    if (!Object.hasOwn(pages, pagePath)) {
      // Reuse the source UVs and the same crop rounding as the runtime.
      const elements = [...page.elements.values()];
      for (const element of elements) {
        atlasElementBounds(page, element);
      }
      pages[pagePath] = { name, width: page.width, height: page.height, elements };
      atlases[pagePath] = [pagePath];
    }
    members.push(pagePath);
  }
  atlases[path] = members;
}
emit('manifest.json', Buffer.from(JSON.stringify({ atlases, pages }) + '\n'));
for (const name of readdirSync(output)) {
  if (name.endsWith('.png') && !expected.has(name)) {
    stale.push(name);
  }
}
if (stale.length) {
  throw new Error(`Outdated UI atlas files: ${stale.join(', ')}`);
}
console.log(`${check ? 'Checked' : 'Generated'} ${textureNames.size} UI atlas PNGs and their manifest`);
