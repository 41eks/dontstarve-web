import * as THREE from 'three';
import { createWilsonPlayerPrefab, type WilsonAnimationController } from '../../prefab/src/player';
import { HammerActionController } from '../../prefab/src/hammer';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS, createGroundItemSprite } from '../../prefab/src/groundItems';
import { Locomotor } from '../../prefab/src/locomotor';
import type { TransientSpriteAnimationController } from '../../animation/src/sprite';
import { createInventoryStore } from '../../../src/inventory';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { PlaceableBuildingPlacement, type PlaceableBuildingId } from '../../../src/placeableBuilding';

export async function checkHammer() {
  const failures: string[] = [];
  const { model: player, body } = await createWilsonPlayerPrefab('/dst/data/anim');
  player.position.set(0, 0, 0);
  body.position.set(0, 4.5, 0);
  body.canJump = true;
  const animation = player.userData.animationController as WilsonAnimationController;
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(800, 600);
  document.body.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(player);
  const camera = new THREE.PerspectiveCamera(35, 4 / 3, 0.1, 300);
  camera.position.set(0, 20, 35);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial());
  scene.add(ground);
  const labels: string[] = [];
  const world = { scene, player, camera, ground, renderer,
    createCursorLabel: () => ({ show: (text: string) => labels.push(text), hide() {}, update() {} }) };
  const placement = new PlaceableBuildingPlacement(world, () => false);
  const ids: PlaceableBuildingId[] = ['cookpot', 'firepit', 'icebox', 'researchlab', 'researchlab2', 'researchlab3',
    'researchlab4', 'treasurechest', 'tent', 'dragonflychest', 'saltbox', 'nightlight', 'pighouse', 'mushroom_light', 'mushroom_light2', 'wall_stone', 'campfire'];
  for (const [index, id] of ids.entries()) {
    await placement.spawnFromSave(id, {
      id: `hammer_${id}`, transform: { position: [index * 20, 0, 0], rotationY: 0 },
      components: id === 'wall_stone' ? { health: { current: 100, max: 200 } }
        : { building: { state: ['cookpot', 'icebox', 'treasurechest', 'dragonflychest', 'saltbox'].includes(id) ? 'open' : 'idle' } },
    });
  }
  const assets = new GroundItemAssets('/dst/data/anim');
  const skins = [undefined, ...Object.keys(GROUND_ITEM_DEFINITIONS.hammer.skinArchives)];
  let wornCases = 0;
  for (const skin of skins) {
    await animation.setCarryItem('hammer', skin);
    const buildName = skin ? GROUND_ITEM_DEFINITIONS.hammer.skinArchives[skin].split('/').at(-1)!.replace('.zip', '') : 'swap_hammer';
    for (const facing of ['down', 'up', 'side'] as const) {
      for (const mirrored of [false, true]) {
        animation.setFacing(facing, mirrored);
        animation.start('walk');
        animation.update(0.05);
        const mesh = player.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
        if (skin === 'hammer_invisible') {
          if (mesh.material.some((material) => material.name === 'ground:swap_hammer')) failures.push(`invisible:${facing}:${mirrored}`);
        } else if (!mesh.material.some((material) => material.name === `ground:${buildName}`)) failures.push(`worn:${skin}:${facing}:${mirrored}`);
        if (mesh.material.some((material) => !material.forceSinglePass)) failures.push('face passes');
        animation.start('idle');
        wornCases++;
      }
    }
    const dropped = await createGroundItemSprite(assets, 'hammer', skin);
    const mesh = dropped.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
    if (mesh.geometry.drawRange.count < 6 || !mesh.material.some((material) => material.name === `ground:${buildName}`)) failures.push(`ground:${skin}`);
    dropped.dispose();
  }
  const store = createInventoryStore([{ slot_index: 0, id: 'hammer', num: 1 }]);
  const from = inventorySlotAddress(0);
  const hand = equipmentSlotAddress('hand');
  const inventorySpec = store.getItemSpec('hammer');
  const transfer = store.applySlotChanges([{ slot: from, itemId: 'hammer', delta: -1 }, { slot: hand, itemId: 'hammer', delta: 1 }]);
  const inventoryEquipped = transfer && store.get(hand)?.itemId === 'hammer' && store.get(from) === null;
  await animation.setCarryItem('hammer');
  let buildingCases = 0;
  for (const target of placement.hammerTargets) {
    player.position.copy(target.position).add(new THREE.Vector3(0, 0, 3));
    placement.update(0);
    const targetAnimation = target.model.userData.animationController as TransientSpriteAnimationController;
    const beforeClip = targetAnimation.currentAnimation;
    const beforeSave = JSON.stringify(placement.exportRecords());
    let hits = 0;
    if (!animation.playHammer(() => { hits++; target.playHit(); })) failures.push(`start:${target.id}`);
    for (let f = 0; f < 15; f++) animation.update(1 / 30);
    if (hits !== 0) failures.push(`early:${target.id}`);
    animation.update(1 / 30);
    if (hits !== 1) failures.push(`timing:${target.id}:${hits}`);
    const expected = target.id === 'hammer_cookpot' ? 'hit_empty' : target.id === 'hammer_wall_stone' ? 'half_hit' : 'hit';
    if (targetAnimation.currentAnimation !== expected) failures.push(`clip:${target.id}:${targetAnimation.currentAnimation}`);
    if (JSON.stringify(placement.exportRecords()) !== beforeSave) failures.push(`state:${target.id}`);
    for (let f = 0; f < 90; f++) { placement.update(1 / 30); animation.update(1 / 30); }
    if (targetAnimation.currentAnimation !== beforeClip) failures.push(`restore:${target.id}:${beforeClip}:${targetAnimation.currentAnimation}`);
    if (hits !== 1 || animation.isHammering || JSON.stringify(placement.exportRecords()) !== beforeSave) failures.push(`finish:${target.id}`);
    buildingCases++;
  }

  const wall = placement.hammerTargets.find((target) => target.id === 'hammer_wall_stone')!;
  const wallAnimation = wall.model.userData.animationController as TransientSpriteAnimationController;
  const wallMesh = wall.model.children[0].children[0] as THREE.Mesh<THREE.BufferGeometry>;
  const pose = () => [...wallMesh.geometry.getAttribute('position').array];
  player.position.copy(wall.position).add(new THREE.Vector3(0, 0, 3));
  for (const heading of [0, 45, 90, 135]) {
    const angle = heading * Math.PI / 180;
    camera.position.set(-Math.cos(angle) * 35, 20, -Math.sin(angle) * 35);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    placement.update(0);
    const before = JSON.stringify(pose());
    wall.playHit();
    const during = JSON.stringify(pose());
    if (during === before) failures.push(`wall static hit:${heading}`);
    for (let f = 0; f < 10; f++) placement.update(1 / 30);
    if (JSON.stringify(pose()) !== before || wallAnimation.currentAnimation !== 'half') failures.push(`wall pose:${heading}`);
  }
  // A transient hit also preserves the completion of an interrupted opening animation.
  const chest = placement.hammerTargets.find((target) => target.id === 'hammer_treasurechest')!;
  const chestAnimation = chest.model.userData.animationController as TransientSpriteAnimationController;
  let completed = 0;
  chestAnimation.playOnce('open', () => completed++);
  chestAnimation.update(0.1);
  chest.playHit();
  for (let f = 0; f < 30; f++) chestAnimation.update(1 / 30);
  const openingResumed = completed === 1;
  // Work feedback chooses the prefab-specific cooking/full and lit animations.
  const pot = placement.hammerTargets.find((target) => target.id === 'hammer_cookpot')!;
  const potAnimation = pot.model.userData.animationController as TransientSpriteAnimationController;
  for (const [clip, hit] of [['cooking_loop', 'hit_cooking'], ['idle_full', 'hit_full']]) {
    potAnimation.start(clip); pot.playHit();
    if (potAnimation.currentAnimation !== hit) failures.push(`pot:${clip}`);
    for (let f = 0; f < 30; f++) potAnimation.update(1 / 30);
    if (potAnimation.currentAnimation !== clip) failures.push(`pot resume:${clip}`);
  }
  const mushroom = placement.hammerTargets.find((target) => target.id === 'hammer_mushroom_light')!;
  const mushroomAnimation = mushroom.model.userData.animationController as TransientSpriteAnimationController;
  mushroomAnimation.start('idle_on'); mushroom.playHit();
  const litHit = mushroomAnimation.currentAnimation === 'hit_on';

  const target = placement.hammerTargets.find((target) => target.id === 'hammer_firepit')!;
  camera.position.copy(target.position).add(new THREE.Vector3(0, 20, 35));
  camera.lookAt(target.position);
  camera.updateMatrixWorld();
  player.position.copy(target.position).add(new THREE.Vector3(0, 0, 3));
  placement.update(0);
  renderer.render(scene, camera);
  let equipped = true;
  let manual = false;
  const locomotor = new Locomotor(body);
  const action = new HammerActionController(world, animation, locomotor, () => equipped,
    () => placement.hammerTargets, () => manual);
  const click = (button: number) => {
    const centre = new THREE.Box3().setFromObject(target.model).getCenter(new THREE.Vector3()).project(camera);
    const bounds = renderer.domElement.getBoundingClientRect();
    const event = new PointerEvent('pointerdown', { button, cancelable: true,
      clientX: bounds.left + (centre.x + 1) * bounds.width / 2,
      clientY: bounds.top + (1 - centre.y) * bounds.height / 2 });
    renderer.domElement.dispatchEvent(event);
    action.update(0);
    return event.defaultPrevented;
  };
  click(0);
  const ignoredLeft = !animation.isHammering;
  const consumedRight = click(2) && animation.isHammering;
  click(2); // Busy clicks cannot restart the swing.
  for (let f = 0; f < 10; f++) animation.update(1 / 30);
  manual = true; action.update(0);
  const manualCancels = !animation.isHammering;
  for (let f = 0; f < 90; f++) animation.update(1 / 30);
  const missedHit = (target.model.userData.animationController as TransientSpriteAnimationController).currentAnimation !== 'hit';
  manual = false;
  click(2);
  await animation.setCarryItem(null);
  equipped = false; action.update(0);
  const unequipCancels = !animation.isHammering;
  const ignoredUnequipped = !click(2) && !animation.isHammering;
  await animation.setCarryItem('hammer'); equipped = true;
  player.position.copy(target.position).add(new THREE.Vector3(0, 0, 20));
  action.request(target); action.update(0);
  const approaches = !!locomotor.destination && !animation.isHammering;
  player.position.copy(target.position).add(new THREE.Vector3(0, 0, 3));
  action.update(0);
  const reachesTarget = animation.isHammering && !locomotor.destination;
  action.cancel();
  action.dispose();
  renderer.dispose();
  return { failures, skins: skins.length - 1, wornCases, buildingCases, inventoryEquipped,
    maxStack: inventorySpec.maxStack, equippable: inventorySpec.equippable,
    campfireExcluded: !placement.hammerTargets.some((entry) => entry.id === 'hammer_campfire'),
    openingResumed, litHit, ignoredLeft, consumedRight, manualCancels, missedHit,
    unequipCancels, ignoredUnequipped, approaches, reachesTarget, hoverLabel: labels.includes(': 锤击') };
}
