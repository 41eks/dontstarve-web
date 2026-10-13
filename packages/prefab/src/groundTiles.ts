import * as THREE from 'three';
import { loadKtexTexture } from '@dontstarve-web/animation/textureLoader';
import { parseImageAtlasXml, type ImageAtlasElement } from '@dontstarve-web/animation/imageAtlas';
import definitions from './groundTiles.json';
import { TILE_SIZE } from './tile';

export const GROUND_TILE_DEFINITIONS = definitions;
export type GroundTileName = keyof typeof definitions;

const MIXED_VARIANTS: Readonly<Record<number, Readonly<Record<number, number>>>> = {
  1: { 2: 36, 4: 44, 6: 40 }, 2: { 4: 33, 8: 41, 12: 37 },
  4: { 1: 42, 8: 34, 9: 38 }, 8: { 1: 35, 2: 43, 3: 39 },
  3: { 4: 45 }, 6: { 8: 46 }, 12: { 1: 48 }, 9: { 2: 47 },
};

/** The 48 source atlas cells: full, cardinal strips, diagonal corners and mixtures.
 * Cardinal bits: west/north/east/south = 1/2/4/8.
 * Diagonal bits: northwest/northeast/southeast/southwest = 1/2/4/8.
 * A cardinal strip already covers both adjacent corners; discard those bits.
 */
export function groundTileVariant(own: boolean, cardinal: number, diagonal: number): number {
  if (own) return 1;
  if (cardinal & 1) diagonal &= ~9;
  if (cardinal & 2) diagonal &= ~3;
  if (cardinal & 4) diagonal &= ~6;
  if (cardinal & 8) diagonal &= ~12;
  if (!cardinal) return 17 + diagonal;
  if (!diagonal) return 1 + cardinal;
  return MIXED_VARIANTS[cardinal][diagonal];
}

export interface GroundTileAssets {
  readonly material: THREE.MeshLambertMaterial;
  readonly elements: ReadonlyMap<string, ImageAtlasElement>;
  readonly atlas: THREE.Texture;
}

/** Geometry and borrowed source atlases for a map-wide ground overlay.
 * Each consecutive geometry group uses the atlas at its material index.
 * The overlay owns the geometry; terrain assets retain ownership of the atlases.
 */
export interface GroundOverlayGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly atlases: readonly THREE.Texture[];
}

export interface GroundOverlaySource {
  createLandOverlay(): GroundOverlayGeometry;
  onTerrainChanged(listener: () => void): () => void;
}

async function fetchAsset(root: string, path: string): Promise<Response> {
  const response = await fetch(`${root.replace(/\/$/, '')}/${path}`);
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response;
}

async function texture(root: string, path: string, repeat: boolean): Promise<THREE.DataTexture> {
  const decoded = await loadKtexTexture(`${root.replace(/\/$/, '')}/${path}`);
  const result = new THREE.DataTexture(decoded.pixels, decoded.width, decoded.height, THREE.RGBAFormat);
  result.name = path;
  result.colorSpace = THREE.SRGBColorSpace;
  result.flipY = false;
  result.wrapS = result.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  result.magFilter = THREE.LinearFilter;
  // Tile atlas XML excludes the gutter. Avoid mip bleeding into adjacent masks.
  result.minFilter = repeat ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  result.generateMipmaps = repeat;
  result.needsUpdate = true;
  return result;
}

/** ground.ksh: atlas RGBA multiplied by world-space noise and then lighting. */
export async function loadGroundTileAssets(root: string, name: GroundTileName): Promise<GroundTileAssets> {
  const definition = definitions[name];
  const [noise, atlas, xml] = await Promise.all([
    texture(root, definition.noise, true), texture(root, definition.texture, false),
    fetchAsset(root, definition.atlas).then((response) => response.text()),
  ]);
  const elements = parseImageAtlasXml(xml, definition.atlas).elements;
  const material = new THREE.MeshLambertMaterial({
    name: `DST ground:${name}`, map: noise, side: THREE.DoubleSide,
    depthWrite: false, transparent: true, alphaTest: 0.105,
  });
  material.forceSinglePass = true;
  // This atlas is injected by onBeforeCompile rather than a built-in material map.
  material.userData.prewarmTextures = [atlas];
  material.onBeforeCompile = (shader) => {
    shader.uniforms.dstGroundTileAtlas = { value: atlas };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      attribute vec2 groundTileUv;
      varying vec2 vGroundTileUv;
    `).replace('#include <uv_vertex>', `
      #include <uv_vertex>
      vGroundTileUv = groundTileUv;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform sampler2D dstGroundTileAtlas;
      varying vec2 vGroundTileUv;
    `).replace('#include <map_fragment>', `
      #include <map_fragment>
      diffuseColor *= texture2D(dstGroundTileAtlas, vGroundTileUv);
    `);
  };
  material.customProgramCacheKey = () => 'dst-ground-atlas-noise-v1';
  material.addEventListener('dispose', () => { noise.dispose(); atlas.dispose(); });
  return { material, elements, atlas };
}

/** Straight-alpha RGBA pixels, top row first. */
export interface GroundTilePixels { readonly data: Uint8ClampedArray; readonly width: number; readonly height: number }

/** What MapLayerManager:CreateRenderLayer receives: the tile atlas and its noise texture. */
export interface GroundTileLayerImage {
  readonly cells: ReadonlyMap<number, GroundTilePixels>;
  readonly noise: GroundTilePixels;
  readonly renderOrder: number;
}

/**
 * MapLayerManager:CreateRenderLayer inputs for a tile: all 48 map_edge masks
 * and the tile's own minimap noise (tiledefs.lua `minimap_tile_def`).
 */
export async function loadGroundTileMinimapLayer(root: string, name: GroundTileName): Promise<GroundTileLayerImage> {
  const { minimap } = definitions[name];
  const base = root.replace(/\/$/, '');
  const [atlas, noise, xml] = await Promise.all([
    loadKtexTexture(`${base}/${minimap.texture}`), loadKtexTexture(`${base}/${minimap.noise}`),
    fetchAsset(root, minimap.atlas).then((response) => response.text()),
  ]);
  const elements = parseImageAtlasXml(xml, minimap.atlas).elements;
  const cells = new Map<number, GroundTilePixels>();
  for (let variant = 1; variant <= 48; variant++) {
    const cell = elements.get(String(variant).padStart(2, '0'));
    if (!cell) throw new Error(`Minimap atlas lacks mask ${variant}: ${minimap.atlas}`);
    // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
    const x0 = Math.floor(cell.u1 * atlas.width), x1 = Math.ceil(cell.u2 * atlas.width);
    const y0 = Math.floor((1 - cell.v2) * atlas.height), y1 = Math.ceil((1 - cell.v1) * atlas.height);
    const width = x1 - x0, height = y1 - y0;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      const from = ((y0 + y) * atlas.width + x0) * 4;
      data.set(atlas.pixels.subarray(from, from + width * 4), y * width * 4);
    }
    cells.set(variant, { data, width, height });
  }
  return { cells, renderOrder: definitions[name].renderOrder,
    noise: { data: Uint8ClampedArray.from(noise.pixels), width: noise.width, height: noise.height } };
}

export interface GroundTileQuad { col: number; row: number; variant: number }

/** One mesh per terrain layer. UVs come from the real XML, noise from world XZ. */
export function groundTileGeometry(quads: readonly GroundTileQuad[], assets: GroundTileAssets, size: number): THREE.BufferGeometry {
  const positions: number[] = [], noiseUvs: number[] = [], tileUvs: number[] = [], indices: number[] = [];
  const half = size / 2;
  for (const { col, row, variant } of quads) {
    const cell = assets.elements.get(String(variant).padStart(2, '0'));
    if (!cell) throw new Error(`Ground tile variant ${variant} is unavailable`);
    const originX = col * TILE_SIZE, originZ = row * TILE_SIZE;
    const x0 = Math.max(-half, originX), x1 = Math.min(half, originX + TILE_SIZE);
    const z0 = Math.max(-half, originZ), z1 = Math.min(half, originZ + TILE_SIZE);
    if (x1 <= x0 || z1 <= z0) continue;
    const offset = positions.length / 3;
    for (const [x, z] of [[x0, z0], [x0, z1], [x1, z0], [x1, z1]]) {
      positions.push(x, 0, z);
      noiseUvs.push(x / (TILE_SIZE * 8), -z / (TILE_SIZE * 8));
      // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
      tileUvs.push(THREE.MathUtils.lerp(cell.u1, cell.u2, (x - originX) / TILE_SIZE),
        THREE.MathUtils.lerp(1 - cell.v2, 1 - cell.v1, (z - originZ) / TILE_SIZE));
    }
    indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(noiseUvs, 2));
  geometry.setAttribute('groundTileUv', new THREE.Float32BufferAttribute(tileUvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (positions.length) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  return geometry;
}
