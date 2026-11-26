import { decodeImageAtlasPage } from './imageAtlas';
import { atlasElementBounds, type ImageAtlasElement, type ImageAtlasPage } from './imageAtlasParser';

export interface AtlasImageRegion {
  readonly imageUrl: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
}

export interface AtlasImageElement extends HTMLSpanElement {
  readonly ready: Promise<void>;
}

export interface StaticAtlasImagePage extends Pick<ImageAtlasPage, 'width' | 'height' | 'elements'> {
  readonly imageUrl: string;
}

type AtlasPage = StaticAtlasImagePage | ImageAtlasPage;
type AtlasPages = { readonly pages: readonly AtlasPage[] };
type AtlasSource = AtlasPages | (() => Promise<AtlasPages>);
const sources = new Map<string, AtlasSource>();
const requests = new Map<string, Promise<void>>();
const regions = new Map<string, AtlasImageRegion>();
const index = new Map<string, { page: AtlasPage; element: ImageAtlasElement }>();
const textures = new Map<string, Promise<string>>();
const imageUrls = new Set<string>();
let generation = 0;
let sheet: CSSStyleSheet | undefined;

function key(atlasPath: string, elementName: string): string {
  return `${atlasPath.toLowerCase()}\n${elementName.toLowerCase()}`;
}

/** Register a batch once; lazy sources are loaded only when an image is requested. */
export function registerImageAtlases(atlases: Readonly<Record<string, AtlasSource>>): void {
  for (const [path, source] of Object.entries(atlases)) {
    if (!sources.has(path.toLowerCase())) {
      sources.set(path.toLowerCase(), source);
    }
  }
}

async function encodePage(page: ImageAtlasPage, currentGeneration: number): Promise<string> {
  const { width, height, pixels } = await decodeImageAtlasPage(page);
  if (currentGeneration !== generation) {
    throw new Error('Atlas images were disposed');
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas 2D context is unavailable');
  }
  context.putImageData(new ImageData(Uint8ClampedArray.from(pixels), width, height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => (value ? resolve(value) : reject(new Error('Unable to encode atlas image'))));
  });
  if (currentGeneration !== generation) {
    throw new Error('Atlas images were disposed');
  }
  const url = URL.createObjectURL(blob);
  imageUrls.add(url);
  return url;
}

async function textureImage(page: AtlasPage, currentGeneration: number): Promise<string> {
  const textureKey = 'imageUrl' in page ? page.imageUrl : page.texturePath;
  let request = textures.get(textureKey);
  if (!request) {
    request = (async () => {
      const url = 'imageUrl' in page ? page.imageUrl : await encodePage(page, currentGeneration);
      try {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (currentGeneration !== generation) {
          throw new Error('Atlas images were disposed');
        }
        return url;
      } catch (error) {
        if (imageUrls.delete(url)) {
          URL.revokeObjectURL(url);
        }
        throw error;
      }
    })();
    textures.set(textureKey, request);
    void request.catch(() => {
      if (textures.get(textureKey) === request) {
        textures.delete(textureKey);
      }
    });
  }
  return request;
}

function loadRegisteredAtlas(atlasPath: string): Promise<void> {
  const path = atlasPath.toLowerCase();
  let request = requests.get(path);
  if (!request) {
    const currentGeneration = generation;
    request = (async () => {
      const source = sources.get(path);
      if (!source) {
        throw new Error(`Image atlas is not registered: ${atlasPath}`);
      }
      const atlas = typeof source === 'function' ? await source() : source;
      if (currentGeneration !== generation) {
        throw new Error('Atlas images were disposed');
      }
      for (const page of atlas.pages) {
        for (const element of page.elements.values()) {
          const name = key(path, element.name);
          if (!index.has(name)) {
            index.set(name, { page, element });
          }
        }
      }
    })();
    requests.set(path, request);
    void request.catch(() => {
      if (requests.get(path) === request) {
        requests.delete(path);
      }
    });
  }
  return request;
}

/** Look up crop coordinates; no per-image pixel extraction is performed. */
export async function getAtlasImage(atlasPath: string, elementName: string): Promise<AtlasImageRegion> {
  const currentGeneration = generation;
  await loadRegisteredAtlas(atlasPath);
  const names = /\.[^./\\]+$/.test(elementName)
    ? [elementName]
    : [elementName, `${elementName}.tex`, `${elementName}.png`];
  const indexed = names.map(name => index.get(key(atlasPath, name))).find(Boolean);
  if (!indexed) {
    throw new Error(`Image atlas does not contain ${elementName}`);
  }
  const regionKey = key(atlasPath, indexed.element.name);
  const cached = regions.get(regionKey);
  if (cached) {
    return cached;
  }
  // Inventory aliases span many pages; load only the pages requested by the UI.
  const imageUrl = await textureImage(indexed.page, currentGeneration);
  if (currentGeneration !== generation) {
    throw new Error('Atlas images were disposed');
  }
  const region = regions.get(regionKey) ?? {
    imageUrl,
    ...atlasElementBounds(indexed.page, indexed.element),
    atlasWidth: indexed.page.width,
    atlasHeight: indexed.page.height,
  };
  regions.set(regionKey, region);
  return region;
}

function spriteSheet(): CSSStyleSheet {
  if (!sheet) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host { display: block; pointer-events: none; }
      .viewport { width: 100%; height: 100%; display: grid; place-items: center; container-type: size; }
      .sprite {
        display: block;
        width: min(100cqw, calc(100cqh * var(--aspect)));
        height: min(100cqh, calc(100cqw / var(--aspect)));
        background-repeat: no-repeat;
      }
    `);
  }
  return sheet;
}

/** Each element has its own CSS crop while sharing the atlas's decoded PNG URL. */
export function createAtlasImage(className: string, atlasPath: string, elementName: string): AtlasImageElement {
  const element: HTMLSpanElement & { ready?: Promise<void> } = document.createElement('span');
  element.className = className;
  element.dataset.atlas = atlasPath;
  element.dataset.element = elementName;
  element.setAttribute('aria-hidden', 'true');
  const root = element.attachShadow({ mode: 'open' });
  root.adoptedStyleSheets = [spriteSheet()];
  const viewport = document.createElement('span');
  viewport.className = 'viewport';
  const sprite = document.createElement('span');
  sprite.className = 'sprite';
  sprite.part.add('sprite');
  viewport.append(sprite);
  root.append(viewport);
  const currentGeneration = generation;
  const ready = getAtlasImage(atlasPath, elementName).then(region => {
    if (currentGeneration !== generation) {
      throw new Error('Atlas images were disposed');
    }
    element.dataset.image = region.imageUrl;
    element.dataset.width = String(region.width);
    element.dataset.height = String(region.height);
    sprite.style.setProperty('--aspect', String(region.width / region.height));
    sprite.style.backgroundImage = `url("${region.imageUrl}")`;
    sprite.style.backgroundSize = `${(region.atlasWidth / region.width) * 100}% ${(region.atlasHeight / region.height) * 100}%`;
    sprite.style.backgroundPosition = `${region.atlasWidth === region.width ? 0 : (region.x / (region.atlasWidth - region.width)) * 100}% ${region.atlasHeight === region.height ? 0 : (region.y / (region.atlasHeight - region.height)) * 100}%`;
    element.dataset.loaded = 'true';
  });
  element.ready = ready;
  void ready.catch((error: unknown) => {
    element.dataset.error = error instanceof Error ? error.message : String(error);
    element.dispatchEvent(new Event('error'));
  });
  return element as AtlasImageElement;
}

export function disposeAtlasImages(): void {
  generation++;
  for (const url of imageUrls) {
    URL.revokeObjectURL(url);
  }
  imageUrls.clear();
  sources.clear();
  requests.clear();
  regions.clear();
  index.clear();
  textures.clear();
}
