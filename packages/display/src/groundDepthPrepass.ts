import * as THREE from 'three';

/** Opaque texels establish terrain occlusion; soft atlas edges still blend in the colour pass. */
export class GroundDepthPrepass {
  private readonly meshes = new Map<THREE.Mesh, THREE.Mesh<THREE.BufferGeometry, THREE.MeshLambertMaterial>>();

  add(colour: THREE.Mesh): void {
    if (!(colour.material instanceof THREE.MeshLambertMaterial)) throw new Error('Ground depth requires a single terrain material');
    const material = new THREE.MeshLambertMaterial({ map: colour.material.map, alphaMap: colour.material.alphaMap,
      side: colour.material.side, forceSinglePass: true, colorWrite: false, depthWrite: true, alphaTest: .98 });
    // Ground layers need their atlas alpha, not just the noise map; borrow textures without cloning userData.
    material.onBeforeCompile = colour.material.onBeforeCompile;
    material.customProgramCacheKey = colour.material.customProgramCacheKey;
    material.userData.prewarmTextures = colour.material.userData.prewarmTextures;
    material.name = `${colour.material.name}:depth`;
    const depth = new THREE.Mesh(colour.geometry, material);
    depth.name = `${colour.name}:depth`;
    colour.add(depth);
    this.meshes.set(colour, depth);
  }

  /** The colour owner replaces/disposes shared geometry; this pass only borrows it. */
  sync(colour: THREE.Mesh): void {
    const depth = this.meshes.get(colour);
    if (depth) depth.geometry = colour.geometry;
  }

  dispose(): void {
    for (const depth of this.meshes.values()) {
      depth.removeFromParent();
      depth.material.dispose();
    }
    this.meshes.clear();
  }
}
