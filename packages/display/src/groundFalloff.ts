import * as THREE from 'three';
import { parseImageAtlasXml, type ImageAtlasElement } from '@dontstarve-web/animation/imageAtlas';
import { fetchGroundAsset, loadGroundTexture } from './groundAssets';

/** falloffdefs.lua: the cliff art the world declares (the atlas, its XML and the number of motifs). */
export interface GroundFalloffArt {
  readonly texture: string;
  readonly atlas: string;
  readonly variants: number;
}

/** A cliff on one side (`edge`, an index of FALLOFF_EDGES) of a land cell. */
export interface FalloffEdge { col: number; row: number; edge: number }

/** Outward cell offsets of the four sides that can carry a cliff. */
export const FALLOFF_EDGES = [{ dx: 1, dz: 0 }, { dx: 0, dz: -1 }, { dx: -1, dz: 0 }, { dx: 0, dz: 1 }] as const;
/** Visually calibrated against the cave reference: a motif spans one tile, hanging two tiles below land.
 * Lua exposes the atlas and neighbour rules, but does not expose the native mesh dimensions. */
const FALLOFF_TILE_HEIGHT = 2;
/** Multiplies the atlas colour; the reference cliffs are much darker than the lit ground. */
const FALLOFF_BRIGHTNESS = 0.45;

interface FalloffFaceOrder {
  centres: Float64Array;
  depths: Float64Array;
  order: number[];
  matrix?: THREE.Matrix4;
}
const falloffFaceOrders = new WeakMap<THREE.BufferGeometry, FalloffFaceOrder>();

export interface GroundFalloffAssets {
  readonly material: THREE.MeshLambertMaterial;
  readonly elements: ReadonlyMap<string, ImageAtlasElement>;
  readonly variants: number;
  readonly tileSize: number;
}

/** falloffdefs.lua FALLOFF_IDS.FALLOFF: `falloff.tex` has no noise, so the atlas is the material map. */
export async function loadGroundFalloffAssets(root: string, art: GroundFalloffArt, tileSize: number): Promise<GroundFalloffAssets> {
  const [atlas, xml] = await Promise.all([loadGroundTexture(root, art.texture, false),
    fetchGroundAsset(root, art.atlas).then(response => response.text())]);
  const height = tileSize * FALLOFF_TILE_HEIGHT;
  const material = new THREE.MeshLambertMaterial({ name: 'DST ground:falloff', map: atlas, side: THREE.DoubleSide,
    depthWrite: false, transparent: true, alphaTest: 1 / 255 });
  material.color.setScalar(FALLOFF_BRIGHTNESS);
  material.forceSinglePass = true;
  // The reference cliffs disappear into cave void: darken the rock from the ground edge down to black.
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying float vGroundFalloffDepth;').replace('#include <begin_vertex>',
      `#include <begin_vertex>\nvGroundFalloffDepth = -position.y / ${height.toFixed(1)};`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vGroundFalloffDepth;').replace('#include <alphatest_fragment>',
      'diffuseColor.rgb *= 1.0 - smoothstep(0.0, 1.0, vGroundFalloffDepth);\n#include <alphatest_fragment>');
  };
  material.addEventListener('dispose', () => atlas.dispose());
  return { material, elements: parseImageAtlasXml(xml, art.atlas).elements, variants: art.variants, tileSize };
}

/** Cliff faces standing on `edges` (cell boundaries), dropping two tiles below the ground. */
export function groundFalloffGeometry(edges: readonly FalloffEdge[], assets: GroundFalloffAssets): THREE.BufferGeometry {
  const { tileSize } = assets;
  const width = tileSize, height = tileSize * FALLOFF_TILE_HEIGHT;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  const centres = new Float64Array(edges.length * 3);
  for (const { col, row, edge } of edges) {
    const { dx, dz } = FALLOFF_EDGES[edge];
    // Consecutive texture-width segments share one atlas cell; crossing zero must not restart the UV span.
    const along = dx ? row : col;
    const segment = Math.floor(along * tileSize / width);
    const across = dx ? col : row;
    const variant = 1 + Math.abs(Math.imul(segment, 73856093) ^ Math.imul(across, 19349663) ^ Math.imul(edge, 83492791)) % assets.variants;
    const cell = assets.elements.get(String(variant).padStart(2, '0'));
    if (!cell) throw new Error(`Ground falloff variant ${variant} is unavailable`);
    // The boundary line of the cell on its `dx`/`dz` side, from its low to its high end.
    const x0 = dx ? (col + (dx > 0 ? 1 : 0)) * tileSize : col * tileSize;
    const z0 = dz ? (row + (dz > 0 ? 1 : 0)) * tileSize : row * tileSize;
    const offset = positions.length / 3;
    const face = offset / 4;
    centres.set([dx ? x0 : x0 + tileSize / 2, -height / 2, dx ? z0 + tileSize / 2 : z0], face * 3);
    for (const t of [0, tileSize]) for (const y of [0, -height]) {
      positions.push(dx ? x0 : x0 + t, y, dx ? z0 + t : z0);
      // parseKtex's rows are top-down; invert XML's bottom-up V coordinates.
      const u = (along * tileSize - segment * width + t) / width;
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
