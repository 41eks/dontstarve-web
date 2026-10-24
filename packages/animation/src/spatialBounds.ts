import type { BufferAttribute, BufferGeometry, InterleavedBufferAttribute, Object3D, Sphere } from 'three';

const radii = new WeakMap<Object3D, number>();
const geometryVersions = new WeakMap<BufferGeometry, { attribute: BufferAttribute | InterleavedBufferAttribute; version: number }>();

export function spatialAttributeVersion(attribute: BufferAttribute | InterleavedBufferAttribute): number {
  return 'data' in attribute ? attribute.data.version : attribute.version;
}

/** Sprite renderers maintain bounds over drawn vertices, excluding unused buffer capacity. */
export function markSpatialGeometryBounds(geometry: BufferGeometry): void {
  const attribute = geometry.getAttribute('position');
  if (attribute) geometryVersions.set(geometry, { attribute, version: spatialAttributeVersion(attribute) });
}

export function prepareSpatialGeometryBounds(geometry: BufferGeometry): void {
  const attribute = geometry.getAttribute('position'), previous = geometryVersions.get(geometry);
  const version = attribute ? spatialAttributeVersion(attribute) : undefined;
  if (previous && (previous.attribute !== attribute || previous.version !== version)) {
    geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  } else {
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  }
  if (!previous || previous.attribute !== attribute || previous.version !== version) markSpatialGeometryBounds(geometry);
}

/** A conservative envelope of frames already displayed, independent of billboard facing. */
export function publishSpriteSpatialBounds(visual: Object3D, sphere: Sphere): void {
  const radius = sphere.center.length() + sphere.radius;
  if (radius <= (radii.get(visual) ?? -1)) return;
  radii.set(visual, radius);
}

export function spriteSpatialRadius(visual: Object3D): number | undefined { return radii.get(visual); }
