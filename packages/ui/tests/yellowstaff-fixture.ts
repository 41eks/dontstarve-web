import * as THREE from 'three';
import { DstLightingRenderer } from '../../../src/dstLighting';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { getLightStaffController, type LightStaffId } from '../../prefab/src/yellowstaff';
import { SpellCastActionController } from '../../stategraphs/src/spellcaster';
import { DwarfStarManager, DWARF_STAR_DURATION, POLAR_LIGHT_DURATION } from '../../prefab/src/stafflight';
import { getPrefabLocalLight } from '../../prefab/src/localLight';
import { executeDebugCommand } from '../../../src/debugCommands';
import { INVENTORY_ITEM_SPECS } from '../../../src/inventoryItems';
import { HandSlot, InventorySlot, InventoryStore, equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { clockstate, seasonstate } from '@dontstarve-web/signals';

export async function checkYellowStaff(itemId: LightStaffId = 'yellowstaff') {
  clockstate.set({ phase: 'night', timeinphase: 0 });
  seasonstate.set({ season: 'spring', progress: 0.5 });
  const duration = itemId === 'opalstaff' ? POLAR_LIGHT_DURATION : DWARF_STAR_DURATION;
  const inventory = new InventoryStore([
    { address: inventorySlotAddress(0), slot: new InventorySlot() },
    { address: equipmentSlotAddress('hand'), slot: new HandSlot() },
  ], INVENTORY_ITEM_SPECS);
  const given = await executeDebugCommand(`c_give("${itemId}")`, inventory);
  const transferred = inventory.applySlotChanges([
    { slot: inventorySlotAddress(0), itemId, delta: -1 },
    { slot: equipmentSlotAddress('hand'), itemId, delta: 1 },
  ]);
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(400, 400);
  document.body.append(renderer.domElement);
  const lighting = await DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes');
  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, Math.PI));
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial());
  scene.add(ground);
  const camera = new THREE.OrthographicCamera(-130, 130, 130, -130, 0.1, 250);
  camera.position.set(0, 150, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const pixel = new Uint8Array(4);
  const sample = (x: number, z = 10) => {
    lighting.render(scene, camera);
    const point = new THREE.Vector3(x, 0, z).project(camera);
    const gl = renderer.getContext();
    gl.readPixels(Math.floor((point.x + 1) * 200), Math.floor((point.y + 1) * 200), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return pixel[0] + pixel[1] + pixel[2];
  };
  const baseline = sample(30);
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 0);
  scene.add(player);
  const animation = player.userData.animationController as WilsonAnimationController;
  const failures: string[] = [];
  const skins = [undefined, ...Object.keys(GROUND_ITEM_DEFINITIONS[itemId].skinArchives)];
  for (const skin of skins) {
    await animation.setCarryItem(itemId, skin);
    const build = skin ? GROUND_ITEM_DEFINITIONS[itemId].skinArchives[skin].split('/').at(-1)!.replace('.zip', '') : 'swap_staffs';
    for (const facing of ['up', 'down', 'side'] as const) {
      for (const mirrored of [false, true]) {
        animation.setFacing(facing, mirrored);
        animation.update(0.05);
        const mesh = player.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
        if (!mesh.material.some((material) => material.name === `ground:${build}`)) failures.push(`worn:${skin}:${facing}:${mirrored}`);
        if (mesh.material.some((material) => !material.forceSinglePass)) failures.push('face passes');
      }
    }
  }
  await animation.setCarryItem(itemId);
  const unlitHand = !getPrefabLocalLight(player);
  const stars = new DwarfStarManager(scene, '/dst/data/anim', itemId === 'opalstaff' ? 'staffcoldlight' : 'stafflight');
  const equipped = inventory.handEquipmentExistenceState;
  const entity = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const staff = getLightStaffController(entity, {
    map: { isAboveGroundAtPoint: point => Math.abs(point.x) <= 130 && Math.abs(point.z) <= 130,
      isOceanAtPoint: () => false, isGroundTargetBlocked: () => false },
    preparePrefab: () => stars.prepare(), spawnPrefab: (_prefab, point) => stars.spawnPrepared(point),
  });
  staff.onequip(equipped);
  let stops = 0, sanity = 100;
  const casting = new SpellCastActionController({ scene, camera, renderer, ground, player }, animation,
    { destination: undefined, stop: () => { stops += 1; }, goToPoint: () => true }, inventory.handEquipment,
    { position: player.position, hasTag: () => false,
      components: { sanity: { doDelta: delta => { sanity = Math.max(0, sanity + delta); } } } },
    () => false, error => failures.push(String(error)));
  const click = (button = 2) => {
    const point = new THREE.Vector3(30, 0, 0).project(camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { button, cancelable: true,
      clientX: bounds.left + (point.x + 1) * bounds.width / 2,
      clientY: bounds.top + (1 - point.y) * bounds.height / 2 }));
  };
  const tick = (count: number) => {
    for (let i = 0; i < count; i++) {
      casting.update(); animation.update(1 / 30);
      stars.update(1 / 30, camera.quaternion);
    }
  };
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));
  await stars.prepare();
  click(0);
  await settle();
  const ignoredLeft = !animation.isCasting;
  click();
  click();
  await settle();
  const busy = animation.isCasting;
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 1, clientY: 1 }));
  tick(52);
  const beforeCommit = stars.exportRecords().length;
  tick(3);
  await settle();
  const record = stars.exportRecords()[0];
  const afterCommit = stars.exportRecords().length;
  const template = deserializeSave(await (await fetch('/saves/initial-world.json')).text(), SAVE_CATALOG);
  let saveJson = '';
  const savedCommand = await executeDebugCommand('c_save()', inventory, undefined, () => {
    saveJson = serializeSave(template, {
      entities: { ...template.world.entities, [stars.prefabId]: stars.exportRecords() },
      playerTransform: { position: [0, 0, 0], rotationY: 0 }, elapsedSeconds: 0,
      inventory: inventory.exportState(), playerStats: { health: 150, hunger: 105, sanity },
    }, SAVE_CATALOG);
  });
  const saved = deserializeSave(saveJson, SAVE_CATALOG);
  const restoredInventory = new InventoryStore([
    { address: inventorySlotAddress(0), slot: new InventorySlot() },
    { address: equipmentSlotAddress('hand'), slot: new HandSlot() },
  ], INVENTORY_ITEM_SPECS);
  const savedInventory = inventoryStateFromSave(saved);
  const addresses = restoredInventory.addresses();
  restoredInventory.replaceState({ ...savedInventory, slots: savedInventory.slots.filter(({ address: savedAddress }) =>
    addresses.some(address => address.containerId === savedAddress.containerId && address.slotKey === savedAddress.slotKey)) }, SAVE_CATALOG.recipes);
  const savedStaff = entity.snapshot();
  const restoredStaff = restoredInventory.getEntity(equipmentSlotAddress('hand'))!.snapshot();
  const restoredStars = new DwarfStarManager(new THREE.Scene(), '/dst/data/anim', stars.prefabId);
  const starSave = saved.world.entities[stars.prefabId][0];
  await restoredStars.spawn(new THREE.Vector3(...starSave.transform.position), {
    id: starSave.id, remainingSeconds: starSave.components.timer!.remainingSeconds,
  });
  const restoredStar = restoredStars.exportRecords()[0];
  restoredStars.dispose(); restoredInventory.dispose();
  tick(60);
  const sprite = stars.renderEntities[0]?.object as THREE.Group | undefined;
  if (!sprite) throw new Error(`${itemId} summon failed: ${failures.join('; ')}`);
  const star = sprite.parent!;
  const mesh = sprite.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  const appeared = mesh.geometry.drawRange.count > 0 && mesh.material.every((material) => material.forceSinglePass);
  const bright = sample(30);
  const far = sample(-120, 120);
  const source = getPrefabLocalLight(star)!;

  // An interrupted cast must not produce a second star, even after its commit time.
  click();
  await settle();
  tick(20);
  inventory.transfer(equipmentSlotAddress('hand'), inventorySlotAddress(0), 1);
  staff.onunequip();
  await animation.setCarryItem(null);
  tick(90);
  const cancelled = !animation.isCasting && stars.exportRecords().length === 1;
  const noCastingLight = player.children.filter((child) => getPrefabLocalLight(child)).length === 0;
  click();
  await settle();
  const ignoredUnequipped = !animation.isCasting;
  player.position.set(-60, 0, 40);
  stars.update(0.05, camera.quaternion);
  const fixedPosition = star.position.distanceTo(new THREE.Vector3(...record.transform.position)) < 0.000001;

  const restored = await stars.spawn(new THREE.Vector3(-40, 0, 0), { id: 'e_restored_star', remainingSeconds: 0.5 });
  const restoredLit = !!getPrefabLocalLight(restored);
  stars.update(0.6, camera.quaternion);
  const expiredNotSaved = !stars.exportRecords().some((entry) => entry.id === 'e_restored_star');
  stars.update(1, camera.quaternion);
  const expiredRemoved = !restored.parent && !getPrefabLocalLight(restored);
  const survivor = stars.exportRecords().length;
  const lifetimeStar = await stars.spawn(new THREE.Vector3(-70, 0, 0));
  stars.update(duration - 1, camera.quaternion);
  const survivesUntilExpiry = !!lifetimeStar.parent && !!getPrefabLocalLight(lifetimeStar)
    && stars.exportRecords().some((entry) => entry.id === lifetimeStar.userData.entityId
      && Math.abs(entry.components.timer.remainingSeconds - 1) < 0.000001);
  stars.update(1, camera.quaternion);
  const expiresAtLifetime = !stars.exportRecords().some((entry) => entry.id === lifetimeStar.userData.entityId);
  stars.update(1, camera.quaternion);
  const lifetimeRemoved = !lifetimeStar.parent && !getPrefabLocalLight(lifetimeStar);
  casting.dispose();
  stars.dispose();
  const disposedDark = sample(30);
  lighting.dispose();
  renderer.dispose();
  return { failures, given, transferred, prefabId: star.name, colour: source.colour,
    savedCommand, savedStaff, restoredStaff, starSave, restoredStar, savedSanity: saved.players.local.stats!.sanity,
    skins: skins.length - 1, unlitHand, ignoredLeft, busy, beforeCommit, afterCommit,
    position: record.transform.position, remainingSeconds: record.components.timer.remainingSeconds,
    fixedPosition, survivesUntilExpiry, expiresAtLifetime, lifetimeRemoved,
    stops, sanity, remainingUses: entity.components.finiteuses.remaining, appeared, baseline, bright, far,
    radius: source.radius, cancelled, noCastingLight, ignoredUnequipped, restoredLit,
    expiredNotSaved, expiredRemoved, survivor, disposedDark };
}
