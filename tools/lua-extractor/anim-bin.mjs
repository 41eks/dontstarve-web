import { readFileSync } from 'node:fs';

import { unzipSync } from 'fflate';

/** The engine's string hash for bank and symbol names (packages/animation smallHash): lower-cased, times 65599. */
export function smallHash(value) {
  let hash = 0;
  for (const character of value) {
    let code = character.codePointAt(0) ?? 0;
    if (code >= 65 && code <= 90) {
      code += 32;
    }
    hash = (Math.imul(hash, 65599) + code) >>> 0;
  }
  return hash;
}

/** anim.bin facing bits, in the order the Transform face modes name them. */
export const FACINGS = {
  right: 1,
  up: 2,
  left: 4,
  down: 8,
  upright: 16,
  upleft: 32,
  downright: 64,
  downleft: 128,
};

/**
 * The clips of `bank` in an archive's anim.bin: by name, the facings its entries cover and each entry's frame count and
 * rate. One clip name has an entry per facing set (idle [right+left], idle [up], ...).
 */
export function readBankClips(archivePath, bank) {
  const files = unzipSync(readFileSync(archivePath));
  const data = files['anim.bin'];
  if (!data) {
    throw new Error(`${archivePath} has no anim.bin`);
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (String.fromCharCode(...data.subarray(0, 4)) !== 'ANIM') {
    throw new Error(`${archivePath} is not an animation archive`);
  }
  let offset = 20;
  const u32 = () => {
    const value = view.getUint32(offset, true);
    offset += 4;
    return value;
  };
  const bankHash = smallHash(bank);
  const clips = new Map();
  const count = u32();
  for (let i = 0; i < count; i++) {
    const length = u32();
    const name = new TextDecoder().decode(data.subarray(offset, offset + length));
    offset += length;
    const facing = view.getUint8(offset);
    offset += 1;
    const hash = u32();
    const frameRate = view.getFloat32(offset, true);
    offset += 4;
    const frames = u32();
    for (let frame = 0; frame < frames; frame++) {
      offset += 16;
      // Read each count before moving past what it counts: `offset += u32() * n` would read offset before u32 moves it.
      const events = u32();
      offset += events * 4;
      const elements = u32();
      offset += elements * 40;
    }
    if (hash !== bankHash) {
      continue;
    }
    const clip = clips.get(name) ?? { facings: 0, entries: [] };
    clip.facings |= facing;
    clip.entries.push({ facing, frames, frameRate });
    clips.set(name, clip);
  }
  return clips;
}

/** The facing names a mask covers, in FACINGS order. */
export function facingNames(mask) {
  return Object.entries(FACINGS)
    .filter(([, bit]) => mask & bit)
    .map(([name]) => name);
}
