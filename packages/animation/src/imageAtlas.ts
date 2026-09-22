import { unzipSync } from 'fflate';
import { parseKtex, type DecodedTexture } from './parseKtex';

export interface ImageAtlasElement {
  readonly name: string;
  readonly u1: number;
  readonly u2: number;
  readonly v1: number;
  readonly v2: number;
}

export interface ParsedImageAtlasXml {
  readonly texture: string;
  readonly elements: ReadonlyMap<string, ImageAtlasElement>;
}

export interface ImageAtlasPage extends ParsedImageAtlasXml {
  readonly path: string;
  readonly texturePath: string;
  readonly decodedTexture: DecodedTexture;
}

export interface ImageAtlasSprite extends DecodedTexture {
  readonly name: string;
  readonly atlasPath: string;
  readonly texturePath: string;
}

export interface ImageAtlas {
  readonly pages: readonly ImageAtlasPage[];
  get(name: string): ImageAtlasSprite | undefined;
  require(name: string): ImageAtlasSprite;
}

interface IndexedElement {
  page: ImageAtlasPage;
  element: ImageAtlasElement;
}

const utf8 = new TextDecoder();
const archiveRequests = new Map<string, Promise<Uint8Array>>();

function decodeXmlValue(value: string) {
  return value.replace(/&(?:#(x[\da-f]+|\d+)|amp|apos|gt|lt|quot);/gi, (entity, numeric: string | undefined) => {
    if (numeric) {
      const radix = numeric[0].toLowerCase() === 'x' ? 16 : 10;
      const digits = radix === 16 ? numeric.slice(1) : numeric;
      return String.fromCodePoint(Number.parseInt(digits, radix));
    }
    const named: Record<string, string> = {
      '&amp;': '&', '&apos;': "'", '&gt;': '>', '&lt;': '<', '&quot;': '"',
    };
    return named[entity.toLowerCase()] ?? entity;
  });
}

function attributes(source: string) {
  const result = new Map<string, string>();
  const pattern = /([\w:-]+)\s*=\s*(["'])(.*?)\2/g;
  for (const match of source.matchAll(pattern)) {
    result.set(match[1], decodeXmlValue(match[3]));
  }
  return result;
}

function coordinate(value: string | undefined, name: string, label: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label}: invalid ${name} coordinate`);
  return parsed;
}

export function parseImageAtlasXml(xml: string, label = 'image atlas XML'): ParsedImageAtlasXml {
  const textureTag = /<Texture\b([^>]*)\/?\s*>/i.exec(xml);
  const texture = textureTag ? attributes(textureTag[1]).get('filename') : undefined;
  if (!texture) throw new Error(`${label}: missing Texture filename`);

  const elements = new Map<string, ImageAtlasElement>();
  const elementPattern = /<Element\b([^>]*)\/?\s*>/gi;
  for (const match of xml.matchAll(elementPattern)) {
    const values = attributes(match[1]);
    const name = values.get('name');
    if (!name) throw new Error(`${label}: Element is missing a name`);
    elements.set(name, {
      name,
      u1: coordinate(values.get('u1'), 'u1', label),
      u2: coordinate(values.get('u2'), 'u2', label),
      v1: coordinate(values.get('v1'), 'v1', label),
      v2: coordinate(values.get('v2'), 'v2', label),
    });
  }
  if (!elements.size) throw new Error(`${label}: atlas contains no elements`);
  return { texture, elements };
}

function normalizePath(path: string) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '');
}

function pathKey(path: string) {
  return normalizePath(path).toLowerCase();
}

function dirname(path: string) {
  const normalized = normalizePath(path);
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator + 1);
}

function resolveTexturePath(xmlPath: string, texture: string) {
  const combined = `${dirname(xmlPath)}${normalizePath(texture)}`;
  const segments: string[] = [];
  for (const segment of combined.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (!segments.pop()) throw new Error(`${xmlPath}: texture path escapes the archive root`);
    } else {
      segments.push(segment);
    }
  }
  return segments.join('/');
}

function archiveEntries(data: Uint8Array, include: (path: string) => boolean) {
  const extracted = unzipSync(data, { filter: ({ name }) => include(pathKey(name)) });
  const result = new Map<string, { path: string; data: Uint8Array }>();
  for (const [path, bytes] of Object.entries(extracted)) {
    result.set(pathKey(path), { path: normalizePath(path), data: bytes });
  }
  return result;
}

function inventoryPageNumber(path: string) {
  const match = /inventoryimages(\d+)\.xml$/i.exec(path);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function xmlPathsFromArchive(data: Uint8Array, requestedPath: string) {
  const requestedKey = pathKey(requestedPath);
  const requestedDirectory = dirname(requestedKey);
  const inventoryAlias = requestedKey.endsWith('/inventoryimages.xml') || requestedKey === 'inventoryimages.xml';
  const inventoryPattern = new RegExp(`^${requestedDirectory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}inventoryimages\\d+\\.xml$`);
  const xmlEntries = archiveEntries(data, (path) => inventoryAlias
    ? inventoryPattern.test(path)
    : path === requestedKey || path.endsWith(`/${requestedKey}`));

  let paths = [...xmlEntries.values()].map(({ path }) => path);
  if (inventoryAlias) paths.sort((a, b) => inventoryPageNumber(a) - inventoryPageNumber(b));
  if (!paths.length && inventoryAlias) {
    const legacy = archiveEntries(data, (path) => path === requestedKey || path.endsWith(`/${requestedKey}`));
    paths = [...legacy.values()].map(({ path }) => path);
    for (const [key, value] of legacy) xmlEntries.set(key, value);
  }
  if (!paths.length) throw new Error(`ZIP archive does not contain ${requestedPath}`);
  return { paths, xmlEntries };
}

export function cropAtlasTexture(texture: DecodedTexture, element: ImageAtlasElement): DecodedTexture {
  const left = Math.max(0, Math.floor(texture.width * element.u1));
  const top = Math.max(0, Math.floor(texture.height * (1 - element.v2)));
  const right = Math.min(texture.width, Math.floor(texture.width * element.u2) + 1);
  const bottom = Math.min(texture.height, Math.floor(texture.height * (1 - element.v1)) + 1);
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) throw new Error(`${element.name}: invalid atlas bounds`);

  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const sourceStart = ((top + y) * texture.width + left) * 4;
    pixels.set(texture.pixels.subarray(sourceStart, sourceStart + width * 4), y * width * 4);
  }
  return { width, height, pixels };
}

class DecodedImageAtlas implements ImageAtlas {
  readonly pages: readonly ImageAtlasPage[];
  private readonly index = new Map<string, IndexedElement>();
  private readonly sprites = new Map<string, ImageAtlasSprite>();

  constructor(pages: readonly ImageAtlasPage[]) {
    this.pages = pages;
    for (const page of pages) {
      for (const element of page.elements.values()) {
        const key = element.name.toLowerCase();
        if (!this.index.has(key)) this.index.set(key, { page, element });
      }
    }
  }

  get(name: string) {
    const names = /\.[^./\\]+$/.test(name) ? [name] : [name, `${name}.tex`, `${name}.png`];
    const indexed = names.map((candidate) => this.index.get(candidate.toLowerCase())).find(Boolean);
    if (!indexed) return undefined;
    const cacheKey = indexed.element.name.toLowerCase();
    const cached = this.sprites.get(cacheKey);
    if (cached) return cached;
    const cropped = cropAtlasTexture(indexed.page.decodedTexture, indexed.element);
    const sprite: ImageAtlasSprite = {
      ...cropped,
      name: indexed.element.name,
      atlasPath: indexed.page.path,
      texturePath: indexed.page.texturePath,
    };
    this.sprites.set(cacheKey, sprite);
    return sprite;
  }

  require(name: string) {
    const sprite = this.get(name);
    if (!sprite) throw new Error(`Image atlas does not contain ${name}`);
    return sprite;
  }
}

export function parseImageAtlasArchive(
  data: Uint8Array,
  atlasPath = 'images/inventoryimages.xml',
): ImageAtlas {
  const { paths, xmlEntries } = xmlPathsFromArchive(data, atlasPath);
  const definitions = paths.map((path) => {
    const xmlEntry = xmlEntries.get(pathKey(path));
    if (!xmlEntry) throw new Error(`ZIP archive does not contain ${path}`);
    const definition = parseImageAtlasXml(utf8.decode(xmlEntry.data), path);
    return { path, definition, texturePath: resolveTexturePath(path, definition.texture) };
  });
  const textureKeys = new Set(definitions.map(({ texturePath }) => pathKey(texturePath)));
  const textures = archiveEntries(data, (path) => textureKeys.has(path));
  const pages = definitions.map(({ path, definition, texturePath }): ImageAtlasPage => {
    const texture = textures.get(pathKey(texturePath));
    if (!texture) throw new Error(`ZIP archive does not contain ${texturePath}`);
    return {
      path,
      texture: definition.texture,
      texturePath,
      elements: definition.elements,
      decodedTexture: parseKtex(texture.data, texturePath),
    };
  });
  return new DecodedImageAtlas(pages);
}

export async function loadImageAtlas(
  archiveUrl: string | URL,
  atlasPath = 'images/inventoryimages.xml',
): Promise<ImageAtlas> {
  return parseImageAtlasArchive(await preloadImageArchive(archiveUrl), atlasPath);
}

export function preloadImageArchive(archiveUrl: string | URL): Promise<Uint8Array> {
  const key = typeof document === 'undefined'
    ? String(archiveUrl)
    : new URL(String(archiveUrl), document.baseURI).href;
  let request = archiveRequests.get(key);
  if (!request) {
    request = fetch(key).then(async (response) => {
      if (!response.ok) throw new Error(`Unable to load image archive ${key}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    });
    archiveRequests.set(key, request);
    void request.catch(() => archiveRequests.delete(key));
  }
  return request;
}
