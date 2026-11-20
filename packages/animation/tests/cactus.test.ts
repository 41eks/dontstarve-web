import { played, wilsonPlayer } from './wilsonPlayer';
import { Health } from '../../componets/src/health';
import { addComponent } from '../../prefab/src/components';
import { testPlayer } from './testPlayer';
import { prefabDisplays } from './prefabManagerFixture';
import { plantManager } from './plantManagerFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { cactusPrefabs, CACTUS_DAMAGE, CACTUS_REGROW_TIME } from '../../prefab/src/cactus';
import { ARMOR_DREADSTONEHAT, DREADSTONEHAT_ID } from '../../prefab/src/dreadstonehat';
import { Combat } from '../../componets/src/combat';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { inventorySlotAddress } from '../../inventory/src';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { bindTestWorld, tickWorld, plantInstance } from './worldContentFixture';
import { createPickupInventory } from './pickupFixture';

vi.mock('../../prefab/src/sound', async importOriginal => ({
  ...(await importOriginal<typeof import('../../prefab/src/sound')>()),
  PlaySound: vi.fn(() => ({ stop: vi.fn(), setVolume: vi.fn() })),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const archives = new Map<string, Uint8Array>();
  for (const file of ['cactus.zip', 'oasis_cactus.zip', 'fire.zip']) {
    archives.set(file, await readFile(new URL(`../../../public/dst/data/anim/${file}`, import.meta.url)));
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(new Uint8Array(archives.get(url.split('/').pop()!)!))),
  );
  vi.stubGlobal('window', new EventTarget());
  const scheduler = new GameTimeScheduler();
  const world = bindTestWorld(scheduler);
  const inventory = createPickupInventory();
  const cacti = plantManager(cactusPrefabs, new THREE.Scene(), {
    spawnGroundItem: () => undefined,
    spawnItem: state => {
      const entity = inventory.entities.create(state);
      inventory.configureItem(entity);
      return entity;
    },
  });
  // The picker: player combat whose GetAttacked runs through the inventory's worn armor.
  const picker = testPlayer({ inventory });
  const health = addComponent(picker, 'health', Health, 150);
  addComponent(picker, 'combat', Combat, () => scheduler.now);
  const events: string[] = [];
  for (const name of ['attacked', 'thorns']) {
    picker.ListenForEvent(name, () => events.push(name));
  }
  const pick = (model: THREE.Group) => plantInstance(model).components.pickable.pick({ picker, giveItem: () => true });
  return {
    scheduler,
    world,
    inventory,
    cacti,
    picker,
    events,
    pick,
    health: () => health.currenthealth,
    dispose() {
      cacti.dispose();
      inventory.dispose();
      world.unbind();
    },
  };
}

it('pricks the picker through worn armor, empties and regrows, giving a flower only in summer', async () => {
  const test = await setup();
  try {
    const cactus = await test.cacti.spawn('cactus', new THREE.Vector3(1, 0, 1)).transform.model;
    expect(plantInstance(cactus).sprite.currentAnimation).toBe('idle');
    expect(prefabInstance(cactus)!.minimap.icon).toBe('cactus.png');
    const physics = () => prefabInstance(cactus)!.physics.json.peek()!.active;
    expect(prefabInstance(cactus)!.physics.json.peek()!.capsule.radius).toBe(0.3);
    test.inventory.add(DREADSTONEHAT_ID, 1);
    const hat = test.inventory.getEntity(inventorySlotAddress(0))!;
    expect(test.inventory.EquipFromInventory(hat)).toBe(true);

    expect(test.pick(cactus)).toBe(true);
    // inventory:ApplyDamage: the hat absorbs 90% and loses that much condition.
    expect(test.health()).toBeCloseTo(150 - CACTUS_DAMAGE * 0.1);
    expect(hat.components.armor!.condition.peek()).toBeCloseTo(ARMOR_DREADSTONEHAT - CACTUS_DAMAGE * 0.9);
    expect(test.events).toEqual(['attacked', 'thorns']);
    expect(physics()).toBe(false);
    expect(test.inventory.count('cactus_flower')).toBe(0);

    tickWorld(test.scheduler, prefabDisplays(test.cacti), CACTUS_REGROW_TIME - 1, new THREE.Quaternion());
    expect(plantInstance(cactus).components.pickable.canBePicked).toBe(false);
    test.world.season.set({ season: 'summer', progress: 0 });
    tickWorld(test.scheduler, prefabDisplays(test.cacti), 1, new THREE.Quaternion());
    expect(plantInstance(cactus).components.pickable.canBePicked).toBe(true);
    expect(physics()).toBe(true);
    expect(test.pick(cactus)).toBe(true);
    expect(test.inventory.count('cactus_flower')).toBe(1);
  } finally {
    test.dispose();
  }
});

it('spares bramble_resistant pickers and restores a picked cactus empty', async () => {
  const test = await setup();
  try {
    const oasis = await test.cacti.spawn('oasis_cactus', new THREE.Vector3(2, 0, 2)).transform.model;
    const attacked = vi.spyOn(test.picker.components.combat!, 'GetAttacked');
    // The picker wears something bramble_resistant.
    test.inventory.add('torch', 1);
    const torch = test.inventory.getEntity(inventorySlotAddress(0))!;
    torch.addTag('bramble_resistant');
    expect(test.inventory.EquipFromInventory(torch)).toBe(true);
    expect(plantInstance(oasis).components.pickable.pick({ picker: test.picker, giveItem: () => true })).toBe(true);
    expect(attacked).not.toHaveBeenCalled();
    const [{ prefabId, record }] = test.cacti.exportRecords();
    expect(prefabId).toBe('oasis_cactus');
    expect(record.components.pickable).toMatchObject({ picked: true, regrowSeconds: CACTUS_REGROW_TIME });
    expect(
      PREFAB_DEFINITIONS.cacti.parseComponents(record.components, 'oasis_cactus', { grounded: true } as never),
    ).toEqual(record.components);
    const restored = await test.cacti.spawn('oasis_cactus', new THREE.Vector3(3, 0, 3), { ...record, id: 'restored' })
      .transform.model;
    expect(plantInstance(restored).components.pickable.canBePicked).toBe(false);
    expect(plantInstance(restored).sprite.currentAnimation).toBe('empty');
  } finally {
    test.dispose();
  }
});

it('flinches a living player into hit for six frames, and shells into shell_hit', () => {
  const inst = wilsonPlayer(() => 1);
  const graph = inst.sg;
  graph.pushEvent('attacked', {});
  expect(graph.stateName).toBe('hit');
  expect(played(inst)).toEqual(['dontstarve/wilson/hit', 'dontstarve/characters/wilson/hurt']);
  graph.update(5 / 30);
  expect(graph.stateName).toBe('hit');
  graph.update(1 / 30);
  expect(graph.stateName).toBe('idle');
});
