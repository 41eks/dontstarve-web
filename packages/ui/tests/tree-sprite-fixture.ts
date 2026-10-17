import * as THREE from 'three';
import { ArchiveSpriteAssets, createArchiveSprite, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';

export async function checkTreeSpriteRendering() {
  const assets = new ArchiveSpriteAssets();
  const definition = {
    animationArchive: 'mushroom_tree_tall.zip',
    buildArchives: ['mushroom_tree_tall.zip', 'mushroom_tree_tall_bloom.zip'],
    bank: 'mushroom_tree',
    hiddenSymbols: [1, 2, 3].flatMap(index => [`swap_acidglob${index}`, `swap_acidglob_bloom${index}`]),
  };
  const shared = await Promise.all([.6, .9].map(colour => createSharedArchiveSprite(assets, {
    ...definition, animation: 'idle_loop', loop: true,
  }, { colour: [colour, colour, colour] })));
  const independent = await Promise.all([.6, .9].map(colour => createArchiveSprite(assets, {
    ...definition, animation: 'idle_loop', loop: true,
  }, { colour: [colour, colour, colour] })));
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(192, 192);
  renderer.setClearColor(0x26333f);
  const target = new THREE.WebGLRenderTarget(192, 192);
  const camera = new THREE.OrthographicCamera(-12, 12, 15, -3, .1, 100);
  camera.position.set(0, 6, 25);
  camera.lookAt(0, 6, 0);
  const scenes = [shared, independent].map(sprites => {
    const scene = new THREE.Scene();
    sprites.forEach((sprite, i) => {
      sprite.model.position.x = (i * 2 - 1) * 4;
      sprite.model.quaternion.copy(camera.quaternion);
      sprite.setFrame(7);
      scene.add(sprite.model);
    });
    return scene;
  });
  const pixels = (scene: THREE.Scene) => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const result = new Uint8Array(192 * 192 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 192, 192, result);
    return result;
  };
  const differences: number[] = [];
  let paintedPixels = 0;
  const compare = () => {
    const cached = pixels(scenes[0]), reference = pixels(scenes[1]);
    differences.push(cached.reduce((count, value, i) => count + Number(value !== reference[i]), 0));
    for (let i = 0; i < cached.length; i += 4) {
      if (cached[i] !== cached[0] || cached[i + 1] !== cached[1] || cached[i + 2] !== cached[2]) paintedPixels++;
    }
  };
  try {
    compare();
    shared[0].playOnce('chop'); independent[0].playOnce('chop');
    shared[0].update(.1); independent[0].update(.1);
    compare();
    for (const sprite of [shared[0], independent[0]]) {
      sprite.setBuildArchive('mushroom_tree_tall_bloom.zip');
      sprite.start('idle_loop'); sprite.setFrame(7);
    }
    compare();
    return { differences, paintedPixels };
  } finally {
    for (const sprite of [...shared, ...independent]) sprite.dispose();
    assets.dispose(); target.dispose(); renderer.dispose();
  }
}
