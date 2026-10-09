import * as THREE from 'three';
import { DstLightingRenderer } from '../../../src/dstLighting';
import { GroundItemManager } from '../../../src/groundItems';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createLanternGroundSprite } from '../../prefab/src/lantern';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { clockstate, seasonstate } from '@dontstarve-web/signals';

export async function checkLanternLighting() {
  clockstate.set({ phase: 'night', timeinphase: 0 });
  seasonstate.set({ season: 'spring', progress: 0.5 });
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(400, 400);
  document.body.append(renderer.domElement);
  const lighting = await DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0);
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(180, 180).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial()));
  const camera = new THREE.OrthographicCamera(-90, 90, 90, -90, 0.1, 200);
  camera.position.set(0, 100, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const pixel = new Uint8Array(4);
  const sample = (x: number, z = -8) => {
    lighting.render(scene, camera);
    const point = new THREE.Vector3(x, 0, z).project(camera);
    const gl = renderer.getContext();
    gl.readPixels(Math.floor((point.x + 1) * 200), Math.floor((point.y + 1) * 200), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[0] + pixel[1] + pixel[2];
  };
  const baseline = sample(0);
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 0);
  scene.add(player);
  const controller = player.userData.animationController as WilsonAnimationController;
  await controller.setCarryItem('lantern');
  const hand = { lit: !!getPrefabLocalLight(player), brightness: sample(0) };
  const failures: string[] = [];
  const skins = [undefined, ...Object.keys(GROUND_ITEM_DEFINITIONS.lantern.skinArchives)];
  const assets = new GroundItemAssets('/dst/data/anim');
  for (const skin of skins) {
    const expectedBuild = skin ? GROUND_ITEM_DEFINITIONS.lantern.skinArchives[skin]
      .split('/').at(-1)!.replace('.zip', '') : 'swap_lantern';
    await controller.setCarryItem('lantern', skin);
    for (const facing of ['up', 'down', 'side'] as const) {
      for (const mirrored of [false, true]) {
        controller.setFacing(facing, mirrored);
        controller.update(0.05);
        const mesh = player.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
        if (!mesh.material.some((material) => material.name === `ground:${expectedBuild}`))
          failures.push(`missing worn art ${skin}:${facing}:${mirrored}`);
        if (mesh.material.some((material) => !material.forceSinglePass)) failures.push('split face passes');
      }
    }
    const ground = await createLanternGroundSprite(assets, { skinId: skin });
    scene.add(ground.model);
    ground.model.position.set(60, 0, 0);
    ground.model.quaternion.copy(camera.quaternion);
    lighting.render(scene, camera);
    if (!getPrefabLocalLight(ground.model)) failures.push(`unlit ground ${skin}`);
    ground.light.setFuelPercent(0);
    if (getPrefabLocalLight(ground.model)) failures.push(`empty fuel ${skin}`);
    ground.dispose();
  }
  controller.setLanternFuelPercent(0);
  const emptyHand = !getPrefabLocalLight(player);
  controller.setLanternFuelPercent(1);
  await controller.setCarryItem(null);
  const backpack = { unlit: !getPrefabLocalLight(player), brightness: sample(0) };
  const pending = controller.setCarryItem('lantern', skins[1]);
  await controller.setCarryItem(null);
  await pending;
  const staleEquip = !getPrefabLocalLight(player);

  let acceptsPickup = false;
  const pickupPlayer = new THREE.Group();
  pickupPlayer.position.set(-30, 0, 0);
  const manager = new GroundItemManager(scene, camera, renderer, '/missing-atlas.zip', () => acceptsPickup, '/dst/data/anim', pickupPlayer);
  const definition = { itemId: 'lantern', count: 1, name: '提灯', icon: 'missing.tex' };
  const failedDrop = await manager.drop(definition, new THREE.Vector3(), () => false);
  await manager.drop(definition, new THREE.Vector3(-30, 20, 0), () => true);
  await manager.drop(definition, new THREE.Vector3(30, 20, 0), () => true);
  manager.update(0.05, camera.quaternion);
  const twoLights = { left: sample(-30), right: sample(30), far: sample(0, 75) };
  const clickFirst = () => {
    const { object: model } = manager.renderEntities[0];
    model.updateWorldMatrix(true, true);
    const mesh = model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry>;
    const bounds = new THREE.Box3();
    const vertices = mesh.geometry.getAttribute('position');
    for (let i = 0; i < mesh.geometry.drawRange.count / 6 * 4; i++)
      bounds.expandByPoint(mesh.localToWorld(new THREE.Vector3().fromBufferAttribute(vertices, i)));
    const point = bounds.getCenter(new THREE.Vector3()).project(camera);
    const canvas = renderer.domElement.getBoundingClientRect();
    renderer.domElement.dispatchEvent(new MouseEvent('pointerdown', {
      button: 0, clientX: canvas.left + (point.x + 1) * canvas.width / 2,
      clientY: canvas.top + (1 - point.y) * canvas.height / 2,
    }));
  };
  clickFirst();
  const failedPickupCount = manager.exportRecords().length;
  acceptsPickup = true;
  clickFirst();
  const pickedUp = { count: manager.exportRecords().length, left: sample(-30), right: sample(30) };
  const record = manager.exportRecords()[0];
  const restored = await manager.spawnFromSave('restored-lantern', definition, new THREE.Vector3(-30, 0, 0));
  const save = { itemId: record.components.stack?.itemId, foot: record.transform.position,
    restoredLit: !!getPrefabLocalLight(restored), restoredBrightness: sample(-30) };
  lighting.dispose();
  renderer.dispose();
  return { baseline, hand, emptyHand, backpack, staleEquip, failures, skins: skins.length - 1,
    failedDrop, twoLights, failedPickupCount, pickedUp, save };
}
