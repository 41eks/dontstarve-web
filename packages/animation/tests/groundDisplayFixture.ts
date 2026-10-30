import type * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GroundDisplay } from '../../display/src/groundDisplay';
import type { TurfMap } from '../../prefab/src/turfMap';

/** Draws a terrain's declared layers as the scene does. */
export async function drawGround(map: TurfMap, root = '/dst/data'): Promise<GroundDisplay> {
  const display = new GroundDisplay(map, root);
  await display.prepare();
  return display;
}

/** The chunk meshes of one layer (or, with another prefix, an overlay), in chunk order. */
export function layerMeshes(display: GroundDisplay, name: string, prefix = 'TurfBlend:'): THREE.Mesh[] {
  return display.root.children.filter(object => object.name === `${prefix}${name}`) as THREE.Mesh[];
}

/** One layer's chunks merged, for whole-layer assertions; the caller disposes it. */
export function layerGeometry(display: GroundDisplay, name: string): THREE.BufferGeometry {
  const parts = layerMeshes(display, name).map(mesh => mesh.geometry);
  if (!parts.length) throw new Error(`No ${name} ground quads`);
  return mergeGeometries(parts)!;
}
