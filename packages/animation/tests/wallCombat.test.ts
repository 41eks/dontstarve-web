import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSignal, type HandEquipment } from '@dontstarve-web/signals';
import { WallsPlacement } from '../../prefab/src/walls';
import { WALL_PHYSICS_RADIUS } from '../../prefab/src/wallPlacement';
import { TILE_SIZE } from '../../prefab/src/tile';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { configureHandEquipmentEntity } from '../../prefab/src/handEquipment';
import type { WorldContext } from '../../prefab/src/worldContext';
import { AttackActionController } from '../../stategraphs/src/attack';
import { Combat, type CombatInst } from '../../componets/src/combat';
import { ItemEntity } from '../../inventory/src';
import { PlaySound } from '../../prefab/src/sound';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    const file = String(url).split('dst/data/')[1];
    return new Response(await readFile(new URL(`../../../public/dst/data/${file}`, import.meta.url)));
  });
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

const UNIT = TILE_SIZE / 4;

function setup() {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 12, 40); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  const world = { scene: new THREE.Scene(), camera, ground: new THREE.Group(), player: new THREE.Group(),
    renderer: { domElement: new EventTarget() }, createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
  } as unknown as WorldContext;
  return { world, placement: new WallsPlacement(world, () => false) };
}

function attacker(position: THREE.Vector3, now: () => number, weapon?: ItemEntity) {
  const inst: CombatInst = {
    getPosition: () => new THREE.Vector3(position.x, 0, position.z), getPhysicsRadius: () => .5 * UNIT,
    hasTag: tag => tag === 'player', components: {},
  };
  const combat = new Combat(inst, now, () => weapon?.components.weapon);
  combat.SetDefaultDamage(10); combat.SetAttackPeriod(.4); combat.SetRange(2 * UNIT);
  inst.components.combat = combat;
  return { inst, combat };
}

const pose = (model: THREE.Group) => model.userData.animationController.pose as string | undefined;

it('hammers out a middle wall once, invalidates stale targets and preserves the other walls and their export order', async () => {
  const { world, placement } = setup();
  const dropLoot = vi.fn();
  world.dropLoot = dropLoot;
  try {
    for (const [id, x] of [['first', 3], ['middle', 7], ['last', 11]] as const) {
      await placement.spawnFromSave('wall_stone', { id, transform: { position: [x, 0, -6], rotationY: 0 },
        components: { health: { current: 100, maximum: 400 } } });
    }
    const before = placement.exportRecords();
    const target = placement.hammerTargets[1], combatTarget = placement.combatTargets[1], skinTarget = placement.reskinTargets[1];
    const prepared = await skinTarget.prepareNextSkin();
    const releases = (target.model.userData.ownedSpriteMaterials as THREE.Material[]).map(material => vi.spyOn(material, 'dispose'));
    target.playHit(); target.playHit();
    expect(target.isValid()).toBe(true);
    expect(placement.exportRecords()).toEqual(before);
    target.playHit();
    expect(dropLoot).toHaveBeenCalledExactlyOnceWith([{ itemId: 'rocks', count: 1 }], new THREE.Vector3(7, 0, -6));
    expect(target.isValid()).toBe(false);
    expect(combatTarget.isValid()).toBe(false);
    expect(skinTarget.isValid()).toBe(false);
    expect(target.model.parent).toBeNull();
    expect(releases.every(release => release.mock.calls.length === 1)).toBe(true);
    expect(prepared.apply()).toBe(false);
    prepared.dispose();
    target.playHit();
    expect(dropLoot).toHaveBeenCalledOnce();
    expect(placement.hammerTargets.map(wall => wall.id)).toEqual(['first', 'last']);
    expect(placement.exportRecords()).toEqual([before[0], before[2]]);
    const restored = setup();
    try {
      for (const { prefabId, record } of placement.exportRecords()) await restored.placement.spawnFromSave(prefabId as 'wall_stone', record);
      expect(restored.placement.exportRecords()).toEqual([before[0], before[2]]);
    } finally { restored.placement.dispose(); }
  } finally { placement.dispose(); }
});

it('gives walls source health, player damage reduction, health poses, weapon wear and a saved broken state', async () => {
  const { placement } = setup();
  try {
    const stone = await placement.spawnFromSave('wall_stone', { id: 'stone', transform: { position: [3, 0, -6], rotationY: 0 }, components: {} });
    await placement.spawnFromSave('wall_moonrock', { id: 'moonrock', transform: { position: [6, 0, -6], rotationY: 0 }, components: {} });
    placement.update();
    const [stoneTarget, moonrockTarget] = placement.combatTargets;
    // walls.lua: SetMaxHealth(maxhealth) then SetCurrentHealth(maxhealth * .5); half is the static build image.
    expect(stoneTarget.inst.components.health!.OnSave()).toEqual({ health: 200, maxhealth: 400 });
    expect(pose(stone)).toBeUndefined();
    expect(stoneTarget.inst.getPhysicsRadius()).toBe(WALL_PHYSICS_RADIUS);

    const hammer = new ItemEntity({ itemId: 'hammer', count: 1 });
    hammer.components.finiteuses.setMaxUses(75);
    configureHandEquipmentEntity(hammer);
    const player = attacker(new THREE.Vector3(3 + UNIT, 0, -6), () => 0, hammer);
    expect(player.combat.CanTarget(stoneTarget.inst)).toBe(true);
    expect(player.combat.DoAttack(stoneTarget.inst)).toBe(true);
    expect(stoneTarget.inst.components.health!.currenthealth).toBe(200 - 17);
    expect(hammer.components.finiteuses.remaining).toBe(74);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/common/destroy_stone', stone.position);
    expect(stone.userData.animationController.currentAnimation).toBe('half_hit');

    // Moonrock walls absorb 25% of player damage; out-of-range attacks miss.
    expect(player.combat.DoAttack(moonrockTarget.inst)).toBe(true);
    expect(moonrockTarget.inst.components.health!.currenthealth).toBe(300 - 17 * .75);
    const far = attacker(new THREE.Vector3(40, 0, 40), () => 0);
    expect(far.combat.DoAttack(stoneTarget.inst)).toBe(false);

    // Below 40% the held pose follows the health signal; at zero the wall is broken and no longer a target.
    stoneTarget.inst.components.health!.SetVal(150);
    for (let frame = 0; frame < 30; frame++) placement.update(1 / 30);
    expect(pose(stone)).toBe('onequarter');
    stoneTarget.inst.components.health!.SetVal(5);
    expect(player.combat.DoAttack(stoneTarget.inst)).toBe(true);
    expect(stoneTarget.inst.components.health!.IsDead()).toBe(true);
    expect(pose(stone)).toBe('broken');
    expect(stoneTarget.isValid()).toBe(false);
    expect(player.combat.CanTarget(stoneTarget.inst)).toBe(false);
    expect(placement.hammerTargets.map(target => target.id)).toContain('stone');

    const records = placement.exportRecords();
    expect(records.map(({ record }) => record.components.health)).toEqual([
      { current: 0, maximum: 400 }, { current: 300 - 17 * .75, maximum: 600 }]);
    const restored = setup();
    const full = await restored.placement.spawnFromSave('wall_stone', { ...records[0].record,
      components: { health: { current: 400, maximum: 400 } } });
    const broken = await restored.placement.spawnFromSave('wall_stone', { ...records[0].record, id: 'broken' });
    expect(['fullA', 'fullB', 'fullC']).toContain(pose(full));
    expect(pose(broken)).toBe('broken');
    expect(restored.placement.exportRecords().map(({ record }) => record.components.health))
      .toEqual([{ current: 400, maximum: 400 }, { current: 0, maximum: 400 }]);
    restored.placement.dispose();
  } finally { placement.dispose(); }
});

it('force attacks a wall with Ctrl+F, walks into range, punches on frame 8 and repeats while held', async () => {
  const { world, placement } = setup();
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  (world as { player: THREE.Object3D }).player = player;
  player.position.set(3 + 6 * UNIT, 0, -6);
  let now = 0;
  const { inst, combat } = attacker(player.position, () => now);
  animation.combat = combat;
  let destination: THREE.Vector3 | undefined;
  const locomotor = { get destination() { return destination; }, goToPoint: (point: THREE.Vector3) => { destination = point.clone(); return true; },
    stop: () => { destination = undefined; } };
  const hand = createSignal<HandEquipment | null>(null);
  const controller = new AttackActionController(world, animation, locomotor, hand, { inst, combat }, () => placement.combatTargets, () => false, UNIT);
  const key = (type: string, code: string, ctrlKey: boolean) => {
    const event = Object.assign(new Event(type, { cancelable: true }), { code, ctrlKey, repeat: false });
    window.dispatchEvent(event);
    return event;
  };
  const step = (frames: number) => {
    for (let frame = 0; frame < frames; frame++) { now += 1 / 30; animation.update(1 / 30); controller.update(); }
  };
  try {
    await placement.spawnFromSave('wall_hay', { id: 'hay', transform: { position: [3, 0, -6], rotationY: 0 }, components: {} });
    const health = placement.combatTargets[0].inst.components.health!;
    // Walls are not hostile: F alone finds no target; Ctrl+F force attacks and claims the browser shortcut.
    key('keydown', 'KeyF', false); key('keyup', 'KeyF', false);
    expect(controller.currentTarget).toBeUndefined();
    expect(key('keydown', 'KeyF', true).defaultPrevented).toBe(true);
    expect(controller.currentTarget?.id).toBe('hay');
    controller.update();
    expect(destination).toBeDefined();
    player.position.copy(destination!);
    controller.update();
    expect(animation.stategraph.stateName).toBe('attack');
    expect(animation.stategraph.animationClip.key).toBe('punch');
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/attack_whoosh');
    step(7);
    expect(health.currenthealth).toBe(50);
    step(1);
    expect(health.currenthealth).toBe(40);
    // Holding the keys repeats after the punch; Escape cancels the next one before it lands.
    step(30);
    expect(health.currenthealth).toBe(30);
    key('keyup', 'KeyF', true);
    key('keydown', 'Escape', false);
    step(60);
    expect(health.currenthealth).toBe(30);
  } finally { controller.dispose(); placement.dispose(); }
});
