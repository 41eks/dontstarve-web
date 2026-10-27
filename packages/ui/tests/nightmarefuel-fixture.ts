import * as THREE from 'three';
import { GroundItemAssets, createResidentGroundItem, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createArchiveSprite } from '../../animation/src/archiveSprite';
import { renderSceneWithPasses } from '../../animation/src/sceneRenderPass';

export async function checkNightmareFuelTransparency() {
  const assets = new GroundItemAssets();
  const source = GROUND_ITEM_DEFINITIONS.nightmarefuel;
  const { visual: fuel, display } = createResidentGroundItem({ assets }, { itemId: 'nightmarefuel' });
  await display.artLoaded();
  const opaque = await createArchiveSprite(assets, { ...source, multColour: [1, 1, 1, 1] });
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(128, 128);
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2.5, -1.5, 0.1, 10);
  camera.position.set(0, 0, 5); camera.lookAt(0, 0, 0);
  const pixels = () => {
    assets.instancedSprites.flush(renderer);
    renderSceneWithPasses(renderer, scene, camera);
    const data = new Uint8Array(128 * 128 * 4);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, 128, 128, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return data;
  };
  const sample = (model: import('three').Group) => {
    scene.add(model);
    scene.background = new THREE.Color(0xffffff);
    const white = pixels();
    scene.background.set(0x00ff00);
    const green = pixels();
    scene.remove(model);
    return { white, green };
  };
  const control = sample(opaque.model), actual = sample(fuel.model);
  let opaqueInterior = 0, translucentInterior = 0;
  for (let i = 0; i < control.white.length; i += 4) {
    // Opaque black source pixels hide both backgrounds. The corrected same
    // pose must reveal both the green channel and the changed red background.
    if (control.white[i] + control.white[i + 1] + control.white[i + 2] > 90
      || Math.abs(control.white[i] - control.green[i]) > 2) continue;
    opaqueInterior++;
    if (actual.white[i] > control.white[i] + 50
      && actual.green[i + 1] > control.green[i + 1] + 50
      && actual.white[i] > actual.green[i] + 50) translucentInterior++;
  }
  fuel.dispose(); opaque.dispose(); assets.dispose(); renderer.dispose();
  return { opaqueInterior, translucentInterior };
}
