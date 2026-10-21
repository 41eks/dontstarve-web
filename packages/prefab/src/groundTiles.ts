import * as THREE from 'three';
import { loadKtexTexture } from '@dontstarve-web/animation/textureLoader';
import { parseImageAtlasXml, type ImageAtlasElement } from '@dontstarve-web/animation/imageAtlas';
import definitions from './groundTiles.json';
import falloff from './groundFalloff.json';
import { TILE_SIZE } from './tile';
import { groundTileVariant } from './groundTileQuads';

export const GROUND_TILE_DEFINITIONS = definitions;
export type GroundTileName = keyof typeof definitions;

export { groundTileVariant };

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
  // Wins depth ties against the coplanar falloff top edge; the falloff prepass still occludes ground behind a cliff.
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -1;
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
  const positions = new Float32Array(quads.length * 12), normals = new Float32Array(quads.length * 12);
  const noiseUvs = new Float32Array(quads.length * 8), tileUvs = new Float32Array(quads.length * 8);
  const indices = quads.length * 4 > 65536 ? new Uint32Array(quads.length * 6) : new Uint16Array(quads.length * 6);
  const cells = Array.from({ length: 49 }, (_, variant) => assets.elements.get(String(variant).padStart(2, '0')));
  let vertices = 0, indexCount = 0;
  const half = size / 2;
  for (const { col, row, variant } of quads) {
    const cell = cells[variant];
    if (!cell) throw new Error(`Ground tile variant ${variant} is unavailable`);
    const originX = col * TILE_SIZE, originZ = row * TILE_SIZE;
    const x0 = Math.max(-half, originX), x1 = Math.min(half, originX + TILE_SIZE);
    const z0 = Math.max(-half, originZ), z1 = Math.min(half, originZ + TILE_SIZE);
    if (x1 <= x0 || z1 <= z0) continue;
    const offset = vertices;
    for (let corner = 0; corner < 4; corner++, vertices++) {
      const x = corner < 2 ? x0 : x1, z = corner % 2 === 0 ? z0 : z1;
      const p = vertices * 3, uv = vertices * 2;
      positions[p] = x; positions[p + 2] = z;
      // Every ground quad is horizontal with the same upward winding.
      normals[p + 1] = 1;
      noiseUvs[uv] = x / (TILE_SIZE * 8); noiseUvs[uv + 1] = -z / (TILE_SIZE * 8);
      // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
      tileUvs[uv] = THREE.MathUtils.lerp(cell.u1, cell.u2, (x - originX) / TILE_SIZE);
      tileUvs[uv + 1] = THREE.MathUtils.lerp(1 - cell.v2, 1 - cell.v1, (z - originZ) / TILE_SIZE);
    }
    indices[indexCount++] = offset; indices[indexCount++] = offset + 1; indices[indexCount++] = offset + 2;
    indices[indexCount++] = offset + 2; indices[indexCount++] = offset + 1; indices[indexCount++] = offset + 3;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions.subarray(0, vertices * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals.subarray(0, vertices * 3), 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(noiseUvs.subarray(0, vertices * 2), 2));
  geometry.setAttribute('groundTileUv', new THREE.BufferAttribute(tileUvs.subarray(0, vertices * 2), 2));
  geometry.setIndex(new THREE.BufferAttribute(indices.subarray(0, indexCount), 1));
  if (vertices) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  return geometry;
}

/** Outward cell offsets of the four sides that can carry a cliff. */
export const FALLOFF_EDGES = [{ dx: 1, dz: 0 }, { dx: 0, dz: -1 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }] as const;
/** Visually calibrated against the cave reference: a motif spans one tile, hanging two tiles below land.
 * Lua exposes the atlas and neighbour rules, but does not expose the native mesh dimensions. */
export const FALLOFF_TEXTURE_WIDTH = TILE_SIZE;
export const FALLOFF_HEIGHT = TILE_SIZE * 2;
/** Multiplies the atlas colour; the reference cliffs are much darker than the lit ground. */
const FALLOFF_BRIGHTNESS = 0.45;

interface FalloffFaceOrder {
  centres: Float64Array;
  depths: Float64Array;
  order: number[];
  matrix?: THREE.Matrix4;
}
const falloffFaceOrders = new WeakMap<THREE.BufferGeometry, FalloffFaceOrder>();

export interface FalloffEdge { col: number; row: number; edge: number }

export interface GroundFalloffAssets {
  readonly material: THREE.MeshLambertMaterial;
  readonly elements: ReadonlyMap<string, ImageAtlasElement>;
}

/** falloffdefs.lua FALLOFF_IDS.FALLOFF: `falloff.tex` has no noise, so the atlas is the material map. */
export async function loadGroundFalloffAssets(root: string): Promise<GroundFalloffAssets> {
  const [atlas, xml] = await Promise.all([texture(root, falloff.texture, false),
    fetchAsset(root, falloff.atlas).then(response => response.text())]);
  const material = new THREE.MeshLambertMaterial({ name: 'DST ground:falloff', map: atlas, side: THREE.DoubleSide,
    depthWrite: false, transparent: true, alphaTest: 1 / 255 });
  material.color.setScalar(FALLOFF_BRIGHTNESS);
  material.forceSinglePass = true;
  // The reference cliffs disappear into cave void: darken the rock from the ground edge down to black.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying float vGroundFalloffDepth;').replace('#include <begin_vertex>',
      `#include <begin_vertex>\nvGroundFalloffDepth = -position.y / ${FALLOFF_HEIGHT.toFixed(1)};`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vGroundFalloffDepth;').replace('#include <alphatest_fragment>',
      'diffuseColor.rgb *= 1.0 - smoothstep(0.0, 1.0, vGroundFalloffDepth);\n#include <alphatest_fragment>');
  };
  material.addEventListener('dispose', () => atlas.dispose());
  return { material, elements: parseImageAtlasXml(xml, falloff.atlas).elements };
}

/** Cliff faces standing on `edges` (cell boundaries), dropping `FALLOFF_HEIGHT` below the ground. */
export function groundFalloffGeometry(edges: readonly FalloffEdge[], assets: GroundFalloffAssets): THREE.BufferGeometry {
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const centres = new Float64Array(edges.length * 3);
  for (const { col, row, edge } of edges) {
    const { dx, dz } = FALLOFF_EDGES[edge];
    // Consecutive texture-width segments share one atlas cell; crossing zero must not restart the UV span.
    const along = dx ? row : col;
    const segment = Math.floor(along * TILE_SIZE / FALLOFF_TEXTURE_WIDTH);
    const across = dx ? col : row;
    const variant = 1 + Math.abs(Math.imul(segment, 73856093) ^ Math.imul(across, 19349663) ^ Math.imul(edge, 83492791)) % falloff.variants;
    const cell = assets.elements.get(String(variant).padStart(2, '0'));
    if (!cell) throw new Error(`Ground falloff variant ${variant} is unavailable`);
    // The boundary line of the cell on its `dx`/`dz` side, from its low to its high end.
    const x0 = dx ? (col + (dx > 0 ? 1 : 0)) * TILE_SIZE : col * TILE_SIZE;
    const z0 = dz ? (row + (dz > 0 ? 1 : 0)) * TILE_SIZE : row * TILE_SIZE;
    const offset = positions.length / 3;
    const face = offset / 4;
    centres.set([dx ? x0 : x0 + TILE_SIZE / 2, -FALLOFF_HEIGHT / 2, dx ? z0 + TILE_SIZE / 2 : z0], face * 3);
    for (const t of [0, TILE_SIZE]) for (const y of [0, -FALLOFF_HEIGHT]) {
      positions.push(dx ? x0 : x0 + t, y, dx ? z0 + t : z0);
      // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
      const u = (along * TILE_SIZE - segment * FALLOFF_TEXTURE_WIDTH + t) / FALLOFF_TEXTURE_WIDTH;
      uvs.push(THREE.MathUtils.lerp(cell.u1, cell.u2, u),
        y === 0 ? 1 - cell.v2 : 1 - cell.v1);
    }
    indices.push(offset, offset + 1, offset + 2, offset + 2, offset + 1, offset + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  if (positions.length) { geometry.computeBoundingBox(); geometry.computeBoundingSphere(); }
  falloffFaceOrders.set(geometry, { centres, depths: new Float64Array(edges.length),
    order: Array.from({ length: edges.length }, (_, i) => i) });
  return geometry;
}

/** Three.js sorts transparent objects, not faces within a merged mesh. Reorder only its index buffer. */
export function sortGroundFalloffGeometry(geometry: THREE.BufferGeometry, modelView: THREE.Matrix4): void {
  const data = falloffFaceOrders.get(geometry);
  if (!data || data.matrix?.equals(modelView)) return;
  (data.matrix ??= new THREE.Matrix4()).copy(modelView);
  const matrix = modelView.elements;
  for (let i = 0; i < data.order.length; i++) {
    const p = i * 3;
    data.depths[i] = matrix[2] * data.centres[p] + matrix[6] * data.centres[p + 1]
      + matrix[10] * data.centres[p + 2] + matrix[14];
  }
  data.order.sort((a, b) => data.depths[a] - data.depths[b] || a - b);
  const index = geometry.index!;
  data.order.forEach((face, i) => {
    const v = face * 4, offset = i * 6;
    index.setX(offset, v); index.setX(offset + 1, v + 1); index.setX(offset + 2, v + 2);
    index.setX(offset + 3, v + 2); index.setX(offset + 4, v + 1); index.setX(offset + 5, v + 3);
  });
  index.needsUpdate = true;
}
