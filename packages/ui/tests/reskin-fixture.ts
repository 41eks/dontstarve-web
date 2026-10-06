import * as THREE from 'three';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { ReskinActionController, ReskinEffects } from '../../prefab/src/reskin_tool';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import { DisposeSounds } from '../../prefab/src/sound';
import { getPrefabLightOverride } from '../../prefab/src/localLight';
import { setSpriteEntityRenderOrder } from '../../animation/src/renderOrder';
import { GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createInventoryStore } from '../../../src/inventory';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { GroundItemManager } from '../../../src/groundItems';

export async function checkReskinCasting() {
  const sources: AudioBufferSourceNode[] = [];
  const originalCreate = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function () {
    const source = originalCreate.call(this); sources.push(source); return source;
  };
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(400, 400);
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#b8b8b8');
  const camera = new THREE.OrthographicCamera(-15, 15, 15, -15, 0.1, 200);
  camera.position.set(0, 12, 45); camera.lookAt(0, 2, 0); camera.updateMatrixWorld();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#abc5a2' }));
  scene.add(ground);
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 8); scene.add(player);
  const animation = player.userData.animationController as WilsonAnimationController;
  const world = { scene, renderer, camera, ground, player };
  const effects = new ReskinEffects(scene, '/dst/data/anim');
  const buildings = new AnimatedBuildingPlacement(world, { treasurechest: TREASURE_CHEST_DEFINITION }, () => false);
  const root = await buildings.spawnFromSave('treasurechest', { id: 'e_chest',
    transform: { position: [0, 0, 0], rotationY: 0 }, components: { building: { state: 'open' } } });
  const inventory = createInventoryStore();
  inventory.add('reskin_tool', 1);
  inventory.applySlotChanges([
    { slot: inventorySlotAddress(0), itemId: 'reskin_tool', delta: -1 },
    { slot: equipmentSlotAddress('hand'), itemId: 'reskin_tool', delta: 1 },
  ]);
  const items = new GroundItemManager(scene, camera, renderer, '/dst/data/databundles/images.zip',
    (item) => inventory.add(item.itemId, item.count, item.skinId), '/dst/data/anim', world.player);
  await items.spawnFromSave('e_dropped', { ...inventory.getItemSpec('reskin_tool'), itemId: 'reskin_tool', count: 1 }, new THREE.Vector3(6, 0, 0));
  let equipped = true;
  const controller = new ReskinActionController(world, animation,
    { stop() {}, goToPoint() { return true; }, destination: undefined },
    () => equipped ? inventory.get(equipmentSlotAddress('hand'))! : undefined,
    () => [...buildings.reskinTargets, ...items.reskinTargets], effects);
  const failures: string[] = [];
  const check = (condition: boolean, message: string) => { if (!condition) failures.push(message); };
  const step = (frames: number) => {
    for (let f = 0; f < frames; f++) {
      controller.update(1 / 30); animation.update(1 / 30);
      buildings.update(1 / 30); items.update(1 / 30, camera.quaternion); effects.update(1 / 30, camera.quaternion);
    }
  };
  try {
    await animation.setCarryItem('reskin_tool');
    const cases = [];
    for (const skinId of [undefined, ...Object.keys(GROUND_ITEM_DEFINITIONS.reskin_tool.skinArchives)]) {
      // The tool's skin determines the FX and sound independently of the target's skin.
      const previous = inventory.get(equipmentSlotAddress('hand'))!;
      inventory.applySlotChanges([
        { slot: equipmentSlotAddress('hand'), itemId: 'reskin_tool', skinId: previous.skinId, delta: -1 },
        { slot: equipmentSlotAddress('hand'), itemId: 'reskin_tool', skinId, delta: 1 },
      ]);
      await animation.setCarryItem('reskin_tool', skinId);
      await effects.prepare(skinId);
      const target = buildings.reskinTargets[0];
      const previousSkin = buildings.exportRecords()[0].record.components.building?.skinId;
      const soundsBefore = sources.length;
      check(await controller.request(target), 'cast request rejected');
      step(8);
      check(sources.length === soundsBefore + 1, 'missing cast whoosh or early result sound');
      check(buildings.exportRecords()[0].record.components.building?.skinId === previousSkin, 'early skin change');
      check(effects.renderEntities.length === 0, 'early puff');
      step(1);
      check(sources.length === soundsBefore + 2, 'missing result sound');
      check(buildings.exportRecords()[0].record.components.building?.skinId !== previousSkin, 'missing skin change');
      check(root.userData.entityId === 'e_chest' && buildings.renderEntities[0].object === root, 'changed open chest identity');
      const fx = effects.renderEntities[0]?.object;
      check(!!fx, 'missing puff');
      if (fx) {
        setSpriteEntityRenderOrder(fx, 100);
        const mesh = fx.children[0].children[0] as THREE.Mesh;
        check(mesh.geometry.drawRange.count > 0, 'empty puff geometry');
        check((mesh.material as THREE.Material[]).some((material) => material.name === `ground:${skinId ?? 'reskin_tool_fx'}`), 'wrong puff build');
        check(getPrefabLightOverride(fx) === (skinId ? 0 : 1), 'wrong source light override');
      }
      if (fx) fx.visible = false;
      renderer.render(scene, camera);
      const baseline = new Uint8Array(400 * 400 * 4);
      renderer.getContext().readPixels(0, 0, 400, 400, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, baseline);
      if (fx) fx.visible = true;
      renderer.render(scene, camera);
      const pixels = new Uint8Array(400 * 400 * 4);
      renderer.getContext().readPixels(0, 0, 400, 400, renderer.getContext().RGBA, renderer.getContext().UNSIGNED_BYTE, pixels);
      check(pixels.filter((value, index) => value !== baseline[index]).length > 100, 'puff does not change the rendered scene');
      const castSound = sources[soundsBefore], resultSound = sources[soundsBefore + 1];
      check(!castSound.loop && !resultSound.loop, 'unexpected looping sound');
      const duration = resultSound.buffer!.duration;
      check(duration > 2.5 && duration < 3.4, 'wrong result sample');
      cases.push({ skinId: skinId ?? 'base', duration, whoosh: castSound.buffer!.duration });
      step(30);
      check(effects.renderEntities.length === 0 && !animation.isReskinning, 'cast/puff did not finish');
    }
    const target = items.reskinTargets[0];
    check(await controller.request(target), 'dropped item request failed');
    step(9);
    const record = items.exportRecords()[0];
    check(record.id === 'e_dropped' && record.components.stack?.skinId === 'reskin_tool_bouquet', 'ground skin/identity lost');
    check(record.components.stack?.count === 1, 'ground count changed');
    step(30);
    const beforeCancellation = sources.length;
    check(await controller.request(buildings.reskinTargets[0]), 'cancel request failed');
    step(8);
    const unchanged = JSON.stringify(buildings.exportRecords());
    equipped = false; controller.update(1 / 30); step(30);
    check(JSON.stringify(buildings.exportRecords()) === unchanged && sources.length === beforeCancellation + 1, 'cancelled cast committed');
    return { failures, cases, groundSkin: record.components.stack?.skinId, cancels: true };
  } finally {
    controller.dispose(); effects.dispose(); DisposeSounds(); renderer.dispose();
    renderer.domElement.remove(); AudioContext.prototype.createBufferSource = originalCreate;
  }
}
