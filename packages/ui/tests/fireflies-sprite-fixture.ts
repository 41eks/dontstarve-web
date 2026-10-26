import * as THREE from 'three';
import { createMemo, createSignal, GameTimeScheduler, type HandEquipment } from '@dontstarve-web/signals';
import { ItemEntity } from '@dontstarve-web/inventory';
import { prewarmScenePasses, renderSceneWithPasses } from '@dontstarve-web/animation/sceneRenderPass';
import { FirefliesAssets, configureFirefliesEntity, createFirefliesGroundSprite } from '../../prefab/src/fireflies';
import { configureBugNetEntity } from '../../prefab/src/bugnet';
import { actionEntity, disposeActionEntity } from '../../prefab/src/actionEntity';
import { mouseTargets } from '../../prefab/src/mouseTargets';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { bindTestWorld } from '../../animation/tests/worldContentFixture';
import { DstLocalLighting } from '../../../src/dstLocalLighting';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';

export async function checkFirefliesInstances() {
  const scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const area = createMemo(() => awake.get());
  const { cycle, getWatchWorldContent, unbind } = bindTestWorld(scheduler, () => area);
  cycle.set('night');
  const handEquipment = createSignal<HandEquipment | null>(null);
  const assets = new FirefliesAssets('/dst/data/anim');
  const net = new ItemEntity({ itemId: 'bugnet', count: 1 }); configureBugNetEntity(net);
  const swarms = await Promise.all(Array.from({ length: 32 }, () => createFirefliesGroundSprite(assets, { getWatchWorldContent, handEquipment })));
  const entities = swarms.map((swarm, index) => {
    const entity = new ItemEntity({ itemId: 'fireflies', count: 1 });
    configureFirefliesEntity(entity);
    entity.transform.position.set(index === 31 ? 8 : -8 + index % 4 * .3, 0, 0);
    swarm.bindTransform(entity.transform); swarm.bindEntity(entity);
    swarm.model.position.copy(entity.transform.position);
    swarm.model.dispatchEvent({ type: 'onload' });
    actionEntity(swarm.model, 'fireflies', entity);
    return entity;
  });
  const scene = new THREE.Scene(); swarms.forEach(swarm => scene.add(swarm.model));
  const renderer = new THREE.WebGLRenderer(); renderer.setSize(256, 256); renderer.setClearColor(0);
  document.body.append(renderer.domElement);
  const target = new THREE.WebGLRenderTarget(256, 256);
  const camera = new THREE.OrthographicCamera(-16, 16, 12, -4, .1, 100);
  camera.position.set(0, 4, 25); camera.lookAt(0, 4, 0);
  const pointer = new PointerRaycaster({ camera, renderer });
  swarms.forEach(swarm => swarm.model.quaternion.copy(camera.quaternion));
  const lighting = new DstLocalLighting();
  lighting.setAmbientColour(new THREE.Vector3());
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const advance = (seconds: number) => {
    for (let t = 0; t < seconds - .001; t += .1) {
      scheduler.advance(.1); swarms.forEach(swarm => swarm.update(.1));
    }
  };
  const draw = () => {
    // Isolate AnimState's self-light override from the shared emitted-light map.
    swarms.forEach(swarm => prefabInstance(swarm.model)!.light.set(null));
    lighting.renderLightmap(renderer);
    renderer.info.reset(); renderer.setRenderTarget(target);
    renderSceneWithPasses(renderer, scene, camera);
    return renderer.info.render.calls;
  };
  const sourceMeshes = () => swarms.map(swarm => {
    let mesh: THREE.Mesh | undefined;
    swarm.model.traverse(object => { if (object instanceof THREE.Mesh) mesh = object; });
    return mesh;
  });
  try {
    await settle(); advance(5); await settle();
    // Keep a dark member in the same atlas batch to check independent overrides.
    swarms[31].instance.sprite.setLightOverride(0);
    await prewarmScenePasses(renderer, scene, camera);
    const calls = [draw()];
    const pixels = new Uint8Array(256 * 256 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 256, 256, pixels);
    const bright = [0, 0];
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
      const i = (y * 256 + x) * 4;
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 50) bright[x < 128 ? 0 : 1]++;
    }
    const hiddenSourceCount = sourceMeshes().filter(mesh => mesh && !mesh.visible).length;
    const centre = new THREE.Box3().setFromObject(swarms[0].model).getCenter(new THREE.Vector3());
    const point = centre.project(camera), rect = renderer.domElement.getBoundingClientRect();
    pointer.trackPointer({ clientX: rect.left + (point.x + 1) * rect.width / 2,
      clientY: rect.top + (1 - point.y) * rect.height / 2 } as PointerEvent);
    const pickable = () => !!pointer.pickMouseTarget();
    const mouseTargeting = [pickable()];
    const registrations = [mouseTargets.size];
    handEquipment.set({ itemId: 'bugnet', EQUIPSLOTS: 'HANDS', entity: net }); await settle();
    mouseTargeting.push(pickable());
    registrations.push(mouseTargets.size);
    handEquipment.set({ itemId: 'axe', EQUIPSLOTS: 'HANDS' }); await settle();
    mouseTargeting.push(pickable());
    registrations.push(mouseTargets.size);
    handEquipment.set({ itemId: 'bugnet', EQUIPSLOTS: 'HANDS', entity: net }); await settle();
    registrations.push(mouseTargets.size);
    const positions = swarms.map(swarm => swarm.model.position.clone());
    swarms.forEach(swarm => { swarm.model.position.x += 10000; });
    calls.push(draw());
    const retainedOffscreen = sourceMeshes().every(mesh => mesh !== undefined);
    swarms.forEach((swarm, index) => swarm.model.position.copy(positions[index]));
    calls.push(draw());
    // Hide during the first one-shot, then return to the loop through its callback.
    swarms[0].model.dispatchEvent({ type: 'onputininventory' });
    swarms[0].model.dispatchEvent({ type: 'ondropped' });
    await settle(); calls.push(draw());
    const preVisible = sourceMeshes()[0]?.visible;
    advance(3); await settle(); calls.push(draw());
    const loopVisible = sourceMeshes()[0]?.visible;
    awake.set(false); await settle(); calls.push(draw());
    registrations.push(mouseTargets.size);
    const unloaded = sourceMeshes().every(mesh => mesh === undefined);
    // Cancel asynchronous wake creation before it can attach any stale instances.
    awake.set(true); await Promise.resolve(); awake.set(false); await settle();
    calls.push(draw());
    const cancelled = sourceMeshes().every(mesh => mesh === undefined);
    registrations.push(mouseTargets.size);
    awake.set(true); await settle(); advance(5); await settle(); calls.push(draw());
    registrations.push(mouseTargets.size);
    // Sleep through sunrise, then reload the old night clip in an active tile.
    // The wake effect must hide it before it can rejoin the instance draw.
    awake.set(false); await settle();
    cycle.set('day'); await settle();
    const daylight = [draw()];
    awake.set(true); await settle(); daylight.push(draw());
    advance(5); await settle(); daylight.push(draw());
    registrations.push(mouseTargets.size);
    for (const swarm of swarms) swarm.dispose(); calls.push(draw());
    registrations.push(mouseTargets.size);
    return { calls, bright, hiddenSourceCount, retainedOffscreen, mouseTargeting, registrations, preVisible, loopVisible, unloaded, cancelled, daylight };
  } finally {
    swarms.forEach(swarm => { swarm.dispose(); disposeActionEntity(swarm.model); }); entities.forEach(entity => entity.remove());
    net.destroy(); pointer.dispose(); renderer.domElement.remove();
    assets.dispose(); unbind(); area.dispose(); scheduler.dispose();
    target.dispose(); lighting.dispose(); renderer.dispose();
    if (mouseTargets.size) throw new Error('Mouse registrations survived fireflies disposal');
  }
}
