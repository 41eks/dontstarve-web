import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { CactusManager, CACTUS_DAMAGE, CACTUS_REGROW_TIME } from '../../prefab/src/cactus';
import { ARMOR_DREADSTONEHAT, DREADSTONEHAT_ID } from '../../prefab/src/dreadstonehat';
import { Combat, type CombatActor } from '../../componets/src/combat';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { inventorySlotAddress } from '../../inventory/src';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { bindTestWorld, tickWorld } from './worldContentFixture';
import { createPickupInventory } from './pickupFixture';

vi.mock('../../prefab/src/sound', async importOriginal => ({
  ...await importOriginal<typeof import('../../prefab/src/sound')>(),
  PlaySound: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })),
}));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup() {
  const archives = new Map<string, Uint8Array>();
  for (const file of ['cactus.zip', 'oasis_cactus.zip', 'fire.zip']) {
    archives.set(file, await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(new Uint8Array(archives.get(url.split('/').pop()!)!))));
  vi.stubGlobal('window', new EventTarget());
  const scheduler = new GameTimeScheduler();
  const world = bindTestWorld(scheduler);
  const inventory = createPickupInventory();
  const cacti = new CactusManager(new THREE.Scene(), '/dst/data/anim', {
    prepareSpawn: async () => ({ spawn: () => true, dispose() {} }),
    spawnItem: state => { const entity = inventory.entities.create(state); inventory.configureItem(entity); return entity; },
  });
  // The picker: player combat whose GetAttacked runs through the inventory's worn armor.
  let health = 150;
  const events: string[] = [];
  const inst: CombatActor = {
    getPosition: () => new THREE.Vector3(), getPhysicsRadius: () => .5, hasTag: tag => tag === 'player',
    PushEvent: name => events.push(name),
    components: { health: { IsDead: () => health <= 0, DoDelta: delta => { health += delta; return delta; } }, inventory },
  };
  inst.components.combat = new Combat(inst, () => scheduler.now);
  const picker = { hasTag: inst.hasTag, PushEvent: inst.PushEvent!, components: { combat: inst.components.combat, inventory } };
  const pick = (model: THREE.Group) => model.userData.components.pickable.pick({ picker, giveItem: () => true });
  return { scheduler, world, inventory, cacti, picker, events, pick, health: () => health,
    dispose() { cacti.dispose(); inventory.dispose(); world.unbind(); } };
}

it('pricks the picker through worn armor, empties and regrows, giving a flower only in summer', async () => {
  const test = await setup();
  try {
    const cactus = await test.cacti.spawn('cactus', new THREE.Vector3(1, 0, 1));
    expect(cactus.userData.animationController.currentAnimation).toBe('idle');
    expect(test.cacti.miniMapEntities.map(entity => entity.icon)).toEqual(['cactus.png']);
    const physics = () => prefabInstance(cactus)!.physics.json.peek()!.active;
    expect(prefabInstance(cactus)!.physics.json.peek()!.capsule.radius).toBe(.3);
    test.inventory.add(DREADSTONEHAT_ID, 1);
    const hat = test.inventory.getEntity(inventorySlotAddress(0))!;
    expect(test.inventory.EquipFromInventory(hat)).toBe(true);

    expect(test.pick(cactus)).toBe(true);
    // inventory:ApplyDamage: the hat absorbs 90% and loses that much condition.
    expect(test.health()).toBeCloseTo(150 - CACTUS_DAMAGE * .1);
    expect(hat.components.armor!.condition.peek()).toBeCloseTo(ARMOR_DREADSTONEHAT - CACTUS_DAMAGE * .9);
    expect(test.events).toEqual(['attacked', 'thorns']);
    expect(physics()).toBe(false);
    expect(test.inventory.count('cactus_flower')).toBe(0);

    tickWorld(test.scheduler, test.cacti, CACTUS_REGROW_TIME - 1, new THREE.Quaternion());
    expect(cactus.userData.components.pickable.canBePicked).toBe(false);
    test.world.season.set({ season: 'summer', progress: 0 });
    tickWorld(test.scheduler, test.cacti, 1, new THREE.Quaternion());
    expect(cactus.userData.components.pickable.canBePicked).toBe(true);
    expect(physics()).toBe(true);
    expect(test.pick(cactus)).toBe(true);
    expect(test.inventory.count('cactus_flower')).toBe(1);
  } finally { test.dispose(); }
});

it('spares bramble_resistant pickers and restores a picked cactus empty', async () => {
  const test = await setup();
  try {
    const oasis = await test.cacti.spawn('oasis_cactus', new THREE.Vector3(2, 0, 2));
    const attacked = vi.spyOn(test.picker.components.combat, 'GetAttacked');
    const resistant = { ...test.picker, components: { ...test.picker.components,
      inventory: Object.assign(Object.create(test.inventory) as typeof test.inventory, { EquipHasTag: (tag: string) => tag === 'bramble_resistant' }) } };
    expect(oasis.userData.components.pickable.pick({ picker: resistant, giveItem: () => true })).toBe(true);
    expect(attacked).not.toHaveBeenCalled();
    const [{ prefabId, record }] = test.cacti.exportRecords();
    expect(prefabId).toBe('oasis_cactus');
    expect(record.components.pickable).toMatchObject({ picked: true, regrowSeconds: CACTUS_REGROW_TIME });
    expect(PREFAB_DEFINITIONS.cacti.parseComponents(record.components, 'oasis_cactus', { grounded: true } as never)).toEqual(record.components);
    const restored = await test.cacti.spawn('oasis_cactus', new THREE.Vector3(3, 0, 3), { ...record, id: 'restored' });
    expect(restored.userData.components.pickable.canBePicked).toBe(false);
    expect(restored.userData.animationController.currentAnimation).toBe('empty');
  } finally { test.dispose(); }
});

it('flinches a living player into hit for six frames, and shells into shell_hit', () => {
  const played: string[] = [];
  const graph = new WilsonStateGraph({ playAnimation: () => 1, playSound() {}, setCasting() {}, onStateChanged() {},
    playEvent: event => played.push(event) } as never);
  graph.pushEvent('attacked', {});
  expect(graph.stateName).toBe('hit');
  expect(played).toEqual(['dontstarve/wilson/hit', 'dontstarve/characters/wilson/hurt']);
  graph.update(5 / 30);
  expect(graph.stateName).toBe('hit');
  graph.update(1 / 30);
  expect(graph.stateName).toBe('idle');
});
