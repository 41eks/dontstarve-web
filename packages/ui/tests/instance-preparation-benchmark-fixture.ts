import * as THREE from 'three';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';

export async function benchmarkInstancePreparation(variant: string) {
  const assets = new ArchiveSpriteAssets();
  if (variant === 'before') {
    const { InstancedArchiveSprites } = await import('../../animation/src/instancedArchiveSprites.benchmark');
    Object.defineProperty(assets, 'instancedSprites', { value: new InstancedArchiveSprites() });
  }
  const create = await preloadSharedArchiveSprite(assets, {
    animationArchive: 'mushroom_tree_tall.zip', buildArchives: ['mushroom_tree_tall.zip'], bank: 'mushroom_tree',
    hiddenSymbols: [1, 2, 3].flatMap(index => [`swap_acidglob${index}`, `swap_acidglob_bloom${index}`]),
  }, { instancedAnimations: ['idle_loop'], staticBillboard: true });
  const renderer = new THREE.WebGLRenderer(); renderer.setSize(128, 128);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-140, 140, 160, -80, .1, 1000);
  camera.position.set(0, 150, 200); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const sprites = Array.from({ length: 3000 }, (_, index) => {
    const sprite = create('idle_loop', true);
    sprite.model.position.set((index % 60 - 30) * 4, 0, (Math.floor(index / 60) - 25) * 4);
    sprite.faceCamera(camera.quaternion); sprite.refreshTransform(); scene.add(sprite.model); return sprite;
  });
  const samples: number[] = [];
  try {
    assets.instancedSprites.flush(renderer); scene.updateMatrixWorld();
    for (let frame = 0; frame < 150; frame++) {
      // Animation advances; camera and ground-contact positions remain fixed.
      sprites.forEach((sprite, index) => sprite.setFrame((frame + index) % sprite.frameCount));
      scene.updateMatrixWorld();
      const start = performance.now(); assets.instancedSprites.render(renderer, camera, undefined, scene);
      const elapsed = performance.now() - start;
      if (frame >= 30) samples.push(elapsed);
      // Consume uploads outside the preparation measurement.
      const automatic = scene.matrixWorldAutoUpdate; scene.matrixWorldAutoUpdate = false;
      renderer.render(scene, camera); scene.matrixWorldAutoUpdate = automatic;
    }
    samples.sort((a, b) => a - b);
    return { variant, count: sprites.length, frames: samples.length, mean: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      median: samples[Math.floor(samples.length / 2)], p90: samples[Math.floor(samples.length * .9)], max: samples.at(-1) };
  } finally { sprites.forEach(sprite => sprite.dispose()); assets.dispose(); renderer.dispose(); }
}
