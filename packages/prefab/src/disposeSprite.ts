import * as THREE from 'three';

/** Release a standalone sprite whose geometry, materials and textures are owned. */
export function disposeSprite(root: THREE.Object3D): void {
  root.removeFromParent();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    // Static sprites own fallback atlas materials even when the current pose
    // only draws skin symbols. Release those resources along with visible ones.
    for (const material of object.userData.ownedSpriteMaterials ?? []) materials.add(material);
    if (!(object instanceof THREE.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
    }
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}
