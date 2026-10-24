import { unzipSync } from 'fflate';
import { parseKtex } from './parseKtex';

export interface BitmapFont {
  drawGlyph(target: HTMLCanvasElement, codePoint: number): void;
}

/** DST bitmap fonts bundle BMFont XML and a KTEX atlas in the original zip. */
export async function loadBitmapFont(url: string): Promise<BitmapFont> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Unable to load bitmap font ${url}: HTTP ${response.status}`);
  const entries = unzipSync(new Uint8Array(await response.arrayBuffer()));
  if (!entries['font.fnt'] || !entries['font.tex']) throw new Error(`${url}: missing font.fnt or font.tex`);
  const xml = new DOMParser().parseFromString(new TextDecoder().decode(entries['font.fnt']), 'application/xml');
  const texture = parseKtex(entries['font.tex'], url);
  const atlas = document.createElement('canvas');
  atlas.width = texture.width;
  atlas.height = texture.height;
  const context = atlas.getContext('2d');
  if (!context) throw new Error('Bitmap font requires a 2D canvas');
  const image = context.createImageData(texture.width, texture.height);
  image.data.set(texture.pixels);
  context.putImageData(image, 0, 0);
  const glyphs = new Map(Array.from(xml.querySelectorAll('char'), (char) => [Number(char.getAttribute('id')), char]));
  return {
    drawGlyph(target, codePoint) {
      const char = glyphs.get(codePoint);
      if (!char) throw new Error(`${url}: missing glyph U+${codePoint.toString(16)}`);
      const attr = (name: string) => Number(char.getAttribute(name));
      target.width = attr('width');
      target.height = attr('height');
      const output = target.getContext('2d');
      if (!output) throw new Error('Bitmap glyph requires a 2D canvas');
      output.drawImage(atlas, attr('x'), attr('y'), target.width, target.height,
        0, 0, target.width, target.height);
    },
  };
}
