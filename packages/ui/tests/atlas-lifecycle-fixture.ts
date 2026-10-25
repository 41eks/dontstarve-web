import * as THREE from 'three';
import { ArchiveSpriteAssets, createArchiveSprite, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { renderSceneWithPasses } from '@dontstarve-web/animation/sceneRenderPass';
import { atlasReloadsSettled } from '@dontstarve-web/animation/animationAssets';

function contextEvent(canvas: HTMLCanvasElement, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { canvas.removeEventListener(name, done); reject(new Error(`Timed out waiting for ${name}`)); }, 10_000);
    function done() { clearTimeout(timeout); canvas.removeEventListener(name, done); resolve(); }
    canvas.addEventListener(name, done);
  });
}

/** The real flower animation catches stale GPU geometry uploads that can leave every frame after the first empty. */
export async function checkFlowerAtlasLifecycle() {
  const assets = new ArchiveSpriteAssets();
  const definition = { animationArchive: 'bulb_plant_single.zip', buildArchives: ['bulb_plant_single.zip'],
    bank: 'bulb_plant_single', animation: 'idle', loop: true };
  const shared = await createSharedArchiveSprite(assets, definition, { instancedAnimations: 'all', colour: [.7, .9, 1] });
  const reference = await createArchiveSprite(assets, definition, { colour: [.7, .9, 1] });
  const scenes = [new THREE.Scene(), new THREE.Scene()];
  shared.model.position.set(3, 0, 0); reference.model.position.copy(shared.model.position);
  scenes[0].add(shared.model); scenes[1].add(reference.model);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  renderer.setSize(256, 256); renderer.setClearColor(0, 0);
  document.body.append(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-8, 8, 12, -4, .1, 100); camera.position.z = 25;
  const target = new THREE.WebGLRenderTarget(256, 256);
  const read = (scene: THREE.Scene) => {
    assets.instancedSprites.flush(renderer);
    renderer.setRenderTarget(target); renderSceneWithPasses(renderer, scene, camera);
    const pixels = new Uint8Array(256 * 256 * 4); renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    return pixels;
  };
  const batches = () => scenes[0].children.find(child => child.name === 'InstancedArchiveSprites')!.children
    .filter((child): child is THREE.InstancedMesh => child instanceof THREE.InstancedMesh && child.name.endsWith(':colour') && child.count > 0);
  const compare = () => {
    const actual = read(scenes[0]), expected = read(scenes[1]);
    let painted = 0, foregroundError = 0, centroid = 0;
    for (let offset = 0; offset < actual.length; offset += 4) {
      if (actual[offset + 3] > 20) { painted++; centroid += offset / 4 % 256; }
      if (actual[offset + 3] > 20 || expected[offset + 3] > 20)
        for (let channel = 0; channel < 4; channel++) foregroundError += Math.abs(actual[offset + channel] - expected[offset + channel]);
    }
    return { painted, centroid: centroid / painted, error: foregroundError / (painted * 4) };
  };
  try {
    const positions: number[][] = [], samples = [];
    for (const frame of [0, 1, 7, 15, shared.frameCount - 1]) {
      shared.setFrame(frame); reference.setFrame(frame);
      samples.push(compare()); positions.push(shared.model.position.toArray());
    }
    // Drawing uploaded the build atlas; only its alpha stays on the CPU.
    let sourceAtlas: THREE.DataTexture | undefined;
    reference.model.traverse(object => {
      if (object instanceof THREE.Mesh) sourceAtlas ??= (object.material as THREE.MeshBasicMaterial[])[0].map as THREE.DataTexture;
    });
    const released = sourceAtlas?.image.data === null;
    const originalBatch = batches()[0], geometry = originalBatch.geometry, instanceMatrix = originalBatch.instanceMatrix;
    const texture = (originalBatch.material as THREE.MeshBasicMaterial).map;
    shared.playOnce('off'); reference.playOnce('off');
    const off = compare();
    const reusedForOff = batches()[0] === originalBatch && batches()[0].geometry === geometry && batches()[0].instanceMatrix === instanceMatrix;
    shared.start('idle'); reference.start('idle'); shared.setFrame(7); reference.setFrame(7);
    const beforeRestore = compare(), reusedForIdle = batches()[0] === originalBatch;
    const originalIdentity = shared.model.uuid;
    const lost = contextEvent(renderer.domElement, 'webglcontextlost');
    renderer.forceContextLoss(); await lost;
    // Restore after the browser finishes dispatching the loss event and records its preventDefault().
    await new Promise(resolve => setTimeout(resolve, 0));
    const restored = contextEvent(renderer.domElement, 'webglcontextrestored');
    renderer.forceContextRestore(); await restored;
    // The restored context has no copy of the released atlas: the first draw decodes it again, then it is drawn.
    read(scenes[0]); read(scenes[1]); await atlasReloadsSettled();
    const afterRestore = compare();
    const rebuiltTexture = (batches()[0].material as THREE.MeshBasicMaterial).map !== texture;
    const identityPreserved = shared.model.uuid === originalIdentity && shared.currentAnimation === 'idle';
    const recoveredBatch = batches()[0];
    shared.model.visible = false; read(scenes[0]);
    const group = scenes[0].children.find(child => child.name === 'InstancedArchiveSprites')!;
    const spareDetached = group.children.length === 0 && !group.visible && recoveredBatch.parent === null;
    shared.model.visible = true;
    const afterShow = compare(), reusedAfterShow = batches()[0] === recoveredBatch;
    return { samples, released, positions, off, reusedForOff, reusedForIdle, beforeRestore, afterRestore, rebuiltTexture, identityPreserved,
      spareDetached, afterShow, reusedAfterShow };
  } finally {
    shared.dispose(); reference.dispose(); assets.dispose(); target.dispose(); renderer.dispose(); renderer.domElement.remove();
  }
}
