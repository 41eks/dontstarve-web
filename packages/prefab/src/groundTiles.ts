import * as THREE from 'three';
import { parseKtex } from '@three-roaming/animation/parseKtex';
import { parseImageAtlasXml, type ImageAtlasElement } from '@three-roaming/animation/imageAtlas';
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
}

async function fetchAsset(root: string, path: string): Promise<Response> {
  const response = await fetch(`${root.replace(/\/$/, '')}/${path}`);
  if (!response.ok) throw new Error(`Unable to load ${path}: HTTP ${response.status}`);
  return response;
}

async function texture(root: string, path: string, repeat: boolean): Promise<THREE.DataTexture> {
  const response = await fetchAsset(root, path);
  const decoded = parseKtex(new Uint8Array(await response.arrayBuffer()), path);
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
  return { material, elements };
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
