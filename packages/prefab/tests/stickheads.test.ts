import { prefabInstance } from '../src/prefabInstance';
import { testPlayer } from '../../../tests/fixtures/testPlayer';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { PIG_HEAD_ID, MERM_HEAD_ID, StickHeadInstance } from '../src/stickheads';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { prefabDisplay, type SpriteState } from '../../display/src';
import type { WorldContext } from '../src/worldContext';
import type { Burnable } from '../../componets/src/burnable';
import * as sound from '../src/sound';
import { createMemo, createSignal, type TileStateQuery } from '../../signals/src';
import { bindTestWorld } from '../../../tests/fixtures/worldContentFixture';
import { workTargets } from '../../../tests/fixtures/workTargets';
import { managedBuildings } from '../../../tests/fixtures/managedBuildings';
import { ItemWorldFixture } from '../../../tests/fixtures/itemWorldFixture';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';
import { withEntity } from '../../../tests/fixtures/entityFixture';
import type { ItemEntity } from '../../inventory/src/entity';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const HEADS = [
  {
    id: PIG_HEAD_ID,
    loot: [
      { itemId: 'pigskin', count: 2 },
      { itemId: 'twigs', count: 2 },
    ],
  },
  {
    id: MERM_HEAD_ID,
    loot: [
      { itemId: 'pondfish', count: 1 },
      { itemId: 'spoiled_food', count: 2 },
      { itemId: 'twigs', count: 2 },
    ],
  },
] as const;

async function setup(
  id: (typeof HEADS)[number]['id'] = PIG_HEAD_ID,
  tickingarea?: TileStateQuery,
  services: Partial<WorldContext> = {},
) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() });
  vi.spyOn(sound, 'PreloadSounds').mockResolvedValue(undefined as never);
  const scheduler = new GameTimeScheduler(),
    content = bindTestWorld(scheduler);
  const loot: { itemId: string; count: number }[][] = [];
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
    scheduler,
    getWatchWorldContent: content.getWatchWorldContent,
    tickingarea,
    dropLoot: (items: { itemId: string; count: number }[]) => loot.push(items),
    ...services,
  } as unknown as WorldContext;
  const placement = managedBuildings(world, { consume: () => false });
  placement.spawn(id);
  const model = workTargets('HAMMER')[0].display.model,
    sprite = prefabInstance(model)!.sprite as SpriteState;
  // The display loads the head's art; its clips play once it is drawn.
  await vi.waitFor(() => expect(sprite.loaded).toBe(true));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const finish = () => {
    for (let i = 0; i < 90; i++) {
      placement.displays.update(1 / 30);
    }
  };
  return { placement, scheduler, content, loot, model, sprite, settle, finish };
}

it.each(HEADS)(
  '$id sleeps by default, wakes on a full-moon night, is hit by the hammer and drops fuel with its deconstruct loot',
  async ({ id, loot }) => {
    const s = await setup(id);
    try {
      expect(s.sprite.currentAnimation).toBe('idle_asleep');
      s.content.moon.set({ phase: 'full', waxing: false });
      s.content.cycle.set('night');
      await s.settle();
      expect(s.sprite.currentAnimation).toBe('wake');
      s.finish();
      expect(s.sprite.currentAnimation).toBe('idle_awake');
      const entity = workTargets('HAMMER')[0].entity;
      expect(performToolWork('HAMMER', entity, testPlayer())).toBe(true);
      expect(s.sprite.currentAnimation).toBe('hit');
      s.finish();
      expect(s.sprite.currentAnimation).toBe('idle_awake');
      s.content.cycle.set('day');
      await s.settle();
      expect(s.sprite.currentAnimation).toBe('sleep');
      s.finish();
      expect(s.sprite.currentAnimation).toBe('idle_asleep');
      s.content.cycle.set('night');
      await s.settle();
      s.finish();
      expect(performToolWork('HAMMER', entity, testPlayer())).toBe(true);
      expect(performToolWork('HAMMER', entity, testPlayer())).toBe(true);
      // The deconstruct recipe at the 50% hammer rate, plus nightmarefuel while the moon is full.
      const dropped = s.loot.flat().flatMap(({ itemId, count }) => Array(count).fill(itemId));
      const expected = [...loot, { itemId: 'nightmarefuel', count: 1 }].flatMap(({ itemId, count }) =>
        Array(count).fill(itemId),
      );
      expect(dropped.sort()).toEqual(expected.sort());
      expect(s.placement.exportRecords()).toEqual([]);
    } finally {
      s.placement.dispose();
    }
  },
);

it('flings each piece of hammered loot apart, as FlingItem does, through the scene item spawn', async () => {
  // The application's item wiring: spawnItem, then the inventory's DropItem onto the ground.
  const items = new ItemWorldFixture(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    undefined,
    '/dst/data/databundles/images.zip',
    createPickupInventory(),
    '/dst/data/anim',
    withEntity(new THREE.Group(), 'wilson'),
  );
  const s = await setup(PIG_HEAD_ID, undefined, {
    spawnItem: items.world.spawnItem,
    dropItem: items.world.dropItem,
  });
  try {
    const head = workTargets('HAMMER')[0].entity,
      origin = head.getPosition().clone();
    for (let i = 0; i < 3; i++) {
      expect(performToolWork('HAMMER', head, testPlayer())).toBe(true);
    }
    expect(s.loot).toEqual([]);
    const dropped = ['pigskin', 'twigs'].flatMap(id => [...items.prefabs.instances(id)]) as ItemEntity[];
    expect(dropped.map(item => item.prefab).sort()).toEqual(['pigskin', 'pigskin', 'twigs', 'twigs']);
    // Each piece leaves the head's point in its own direction and flies until it rests on the ground.
    for (const item of dropped) {
      expect(item.components.inventoryphysics?.flying).toBe(true);
      expect(item.position.distanceTo(origin)).toBeGreaterThan(0);
    }
    for (let frame = 0; frame < 120 && dropped.some(item => item.components.inventoryphysics?.flying); frame++) {
      items.update(1 / 30);
    }
    expect(dropped.some(item => item.components.inventoryphysics?.flying)).toBe(false);
    const landed = new Set(dropped.map(item => `${item.position.x},${item.position.z}`));
    expect(landed.size).toBe(dropped.length);
  } finally {
    s.placement.dispose();
    items.dispose();
  }
});

it.each(HEADS)(
  '$id burns to a burnt head that keeps sleeping, saves only the burnt state and drops reduced loot',
  async ({ id }) => {
    const s = await setup(id);
    try {
      const entity = workTargets('HAMMER')[0].entity;
      (prefabInstance(s.model)!.components.burnable as Burnable).Ignite();
      s.placement.update(11);
      expect(entity.hasTag('burnt')).toBe(true);
      expect(s.sprite.currentAnimation).toBe('burnt');
      s.content.moon.set({ phase: 'full', waxing: false });
      s.content.cycle.set('night');
      await s.settle();
      expect(s.sprite.currentAnimation).toBe('burnt');
      expect(s.placement.exportRecords()[0].record.components.building).toMatchObject({ burnt: true });
      for (let i = 0; i < 3; i++) {
        performToolWork('HAMMER', entity, testPlayer());
      }
      expect(s.loot.flat().some(item => item.itemId === 'nightmarefuel')).toBe(true);
      expect(s.placement.exportRecords()).toEqual([]);
    } finally {
      s.placement.dispose();
    }
  },
);

it('wakes when haunted and sleeps after four seconds unless the moon is full', async () => {
  const s = await setup();
  try {
    const inst = prefabInstance(s.model);
    if (!(inst instanceof StickHeadInstance)) {
      throw new Error('Expected a stick head instance');
    }
    const hauntable = inst.components.hauntable!;
    hauntable.DoHaunt(testPlayer());
    expect(inst.awake).toBe(true);
    expect(s.sprite.currentAnimation).toBe('wake');
    s.placement.update(3);
    expect(inst.awake).toBe(true);
    s.placement.update(1);
    expect(inst.awake).toBeUndefined();
    expect(s.sprite.currentAnimation).toBe('sleep');

    s.placement.update(1);
    expect(hauntable.IsHaunted()).toBe(false);
    hauntable.DoHaunt(testPlayer());
    s.content.moon.set({ phase: 'full', waxing: false });
    s.content.cycle.set('night');
    await s.settle();
    s.placement.update(4);
    expect(inst.awake).toBe(true);
  } finally {
    s.placement.dispose();
  }
});

it('draws the flies swarm from shared frames at the head, not outside the tickingarea, without becoming clickable', async () => {
  const awake = createSignal(true);
  const s = await setup(PIG_HEAD_ID, (() => createMemo(() => awake.get())) as TileStateQuery);
  try {
    // The swarm only plays clips: the head draws it as a shared-batch instance at its origin, with no model of its own.
    const display = prefabDisplay(s.model)!;
    await vi.waitFor(() => expect(display.batchedEffects).toHaveLength(1));
    expect(s.model.children.some(child => child.name === 'flies')).toBe(false);
    awake.set(false);
    await s.settle();
    expect(display.batchedEffects).toEqual([]);
    awake.set(true);
    await s.settle();
    await vi.waitFor(() => expect(display.batchedEffects).toHaveLength(1));
  } finally {
    s.placement.dispose();
  }
});
