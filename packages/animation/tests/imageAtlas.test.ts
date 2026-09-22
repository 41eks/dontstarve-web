import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
  parseImageAtlasArchive,
  parseImageAtlasXml,
  preloadImageArchive,
} from '@three-roaming/animation/imageAtlas';

const encoder = new TextEncoder();

function makeKtex(width: number, height: number, pixels: Uint8Array) {
  const output = new Uint8Array(18 + pixels.length);
  output.set([0x4b, 0x54, 0x45, 0x58]);
  const view = new DataView(output.buffer);
  view.setUint32(4, 8192 + 4 * 16, true);
  view.setUint16(8, width, true);
  view.setUint16(10, height, true);
  view.setUint16(12, width * 4, true);
  view.setUint32(14, pixels.length, true);
  output.set(pixels, 18);
  return output;
}

function solidKtex(red: number, green: number, blue: number) {
  return makeKtex(2, 2, new Uint8Array([
    red, green, blue, 255, red, green, blue, 255,
    red, green, blue, 255, red, green, blue, 255,
  ]));
}

function atlasXml(texture: string, elements: string) {
  return encoder.encode(`<Atlas><Texture filename="${texture}"/><Elements>${elements}</Elements></Atlas>`);
}

const fullElement = (name: string) =>
  `<Element v2="1" name="${name}" u2="0.5" v1="0.5" u1="0"/>`;

afterEach(() => vi.unstubAllGlobals());

describe('parseImageAtlasXml', () => {
  it('parses texture metadata regardless of attribute order', () => {
    const parsed = parseImageAtlasXml(new TextDecoder().decode(
      atlasXml('inventoryimages1.tex', fullElement('axe.tex')),
    ));

    expect(parsed.texture).toBe('inventoryimages1.tex');
    expect(parsed.elements.get('axe.tex')).toEqual({
      name: 'axe.tex', u1: 0, u2: 0.5, v1: 0.5, v2: 1,
    });
  });

  it('rejects malformed atlas elements', () => {
    expect(() => parseImageAtlasXml(
      '<Atlas><Texture filename="items.tex"/><Elements><Element name="axe.tex"/></Elements></Atlas>',
      'items.xml',
    )).toThrow('items.xml: invalid u1 coordinate');
  });
});

describe('parseImageAtlasArchive', () => {
  it('decodes a named atlas texture and crops its elements', () => {
    const archive = zipSync({
      'images/crafting_menu.xml': atlasXml('crafting_menu.tex', fullElement('slot_bg.tex')),
      'images/crafting_menu.tex': solidKtex(20, 40, 60),
    });

    const atlas = parseImageAtlasArchive(archive, 'images/crafting_menu.xml');
    const sprite = atlas.require('slot_bg');

    expect(atlas.pages).toHaveLength(1);
    expect(sprite).toMatchObject({
      name: 'slot_bg.tex',
      atlasPath: 'images/crafting_menu.xml',
      texturePath: 'images/crafting_menu.tex',
      width: 2,
      height: 2,
    });
    expect([...sprite.pixels]).toEqual([
      20, 40, 60, 255, 20, 40, 60, 255,
      20, 40, 60, 255, 20, 40, 60, 255,
    ]);
  });

  it('resolves legacy inventoryimages.xml to the numbered current atlases', () => {
    const archive = zipSync({
      'images/inventoryimages.xml': atlasXml('inventoryimages.tex', fullElement('legacy.tex')),
      'images/inventoryimages1.xml': atlasXml('inventoryimages1.tex', fullElement('axe.tex')),
      'images/inventoryimages1.tex': solidKtex(255, 0, 0),
      'images/inventoryimages2.xml': atlasXml('inventoryimages2.tex', fullElement('torch.tex')),
      'images/inventoryimages2.tex': solidKtex(0, 255, 0),
    });

    const atlas = parseImageAtlasArchive(archive);

    expect(atlas.pages.map(({ path }) => path)).toEqual([
      'images/inventoryimages1.xml',
      'images/inventoryimages2.xml',
    ]);
    expect(atlas.require('axe.tex').pixels[0]).toBe(255);
    expect(atlas.require('torch').pixels[1]).toBe(255);
    expect(atlas.get('legacy')).toBeUndefined();
  });

  it('reports missing XML and textures with their archive paths', () => {
    expect(() => parseImageAtlasArchive(zipSync({}), 'images/missing.xml'))
      .toThrow('ZIP archive does not contain images/missing.xml');
    expect(() => parseImageAtlasArchive(zipSync({
      'images/items.xml': atlasXml('items.tex', fullElement('axe.tex')),
    }), 'images/items.xml')).toThrow('ZIP archive does not contain images/items.tex');
  });
});

describe('preloadImageArchive', () => {
  it('shares one in-flight download for the same archive URL', async () => {
    const fetchMock = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal('fetch', fetchMock);

    const first = preloadImageArchive('https://example.test/images.zip');
    const second = preloadImageArchive(new URL('https://example.test/images.zip'));

    expect(first).toBe(second);
    expect([...await first]).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
