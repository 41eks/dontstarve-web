import { advancePlayer } from '../../../tests/fixtures/playerVisual';
import { testPlayer } from '../../../tests/fixtures/testPlayer';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { inventoryUse } from '../../../tests/fixtures/inventoryUseFixture';
import { FOOD_EFFECTS } from '../src/food';
import { playerInst, createPlayer } from '../../../tests/fixtures/playerVisual';
import { PlaySound } from '../src/sound';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../src/groundItems';
import { createGroundItemVisual } from '../../../tests/fixtures/groundItemVisual';
import { inventorySlotAddress } from '@dontstarve-web/inventory';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';
import { playerInstance } from '../../../src/player';
import { createPerishWorld } from '../../../tests/fixtures/perishWorldFixture';
import type { WorldContext } from '../src/worldContext';
import { getPlayerStats, playerStats } from '../../../src/playerStats';

vi.mock('../../../src/save/initialSave', () => ({
  initialSave: { players: { local: { stats: { health: 140, hunger: 90, sanity: 35 } } } },
}));
vi.mock('../../../src/player', async () => {
  const { initialSave } = await import('../../../src/save/initialSave');
  const { playerStatsFixture } = await import('../../../tests/fixtures/playerStatsFixture');
  return { playerInstance: playerStatsFixture(initialSave.players.local.stats!) };
});
vi.mock('../src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true })),
}));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  playerStats.health.SetVal(140);
  playerStats.hunger.SetCurrent(90);
  playerStats.sanity.SetCurrent(35);
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function fixture(itemId = 'bananajuice') {
  const player = await createPlayer('/dst/data/anim');
  const animation = playerInst(player);
  const world = {
    scene: new THREE.Scene(),
    player,
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
  } as unknown as WorldContext;
  const slot = inventorySlotAddress(0),
    store = createPickupInventory();
  const actions = inventoryUse(world, animation.sg, testPlayer({ entity: playerInstance, inventory: store }));
  store.add(itemId, 2);
  const entity = store.getEntity(slot)!;
  return { animation, actions, store, slot, entity };
}

it('eats raw meat through the long MEAT eat state and commits its edible stats and one item at frame 28', async () => {
  const { animation, actions, store, slot, entity } = await fixture('meat');
  playerStats.hunger.SetCurrent(50);
  const onEaten = vi.fn();
  entity.ListenForEvent('oneaten', onEaten);
  try {
    // componentactions.lua edible INVENTORY: EAT for food in the player's OMNI diet, nothing for an item without edible.
    store.add('log', 1);
    expect(actions.controller.GetInventoryItemAction(store.getEntity(inventorySlotAddress(1))!)).toBeUndefined();
    expect(entity.hasTag('edible_MEAT')).toBe(true);
    expect(entity.hasTag('edible_GENERIC')).toBe(false);
    const picked = actions.controller.GetInventoryItemAction(entity)!;
    expect([picked.action, picked.invobject, picked.target]).toEqual(['EAT', entity, undefined]);
    expect(await actions.use(entity)).toBe(true);
    // SGwilson EAT: FOODTYPE.MEAT that is not a drink goes to "eat", not "quickeat".
    expect(animation.sg.stateName).toBe('eat');
    expect(animation.sg.animationClip.key).toBe('eat_pre');
    for (let frame = 0; frame < 27; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(onEaten).not.toHaveBeenCalled();
    expect(store.get(slot)?.count).toBe(2);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/eat', undefined);
    advancePlayer(animation, 1 / 30);
    expect(store.get(slot)?.count).toBe(1);
    // meats.lua raw: HEALING_TINY, CALORIES_MED, -SANITY_SMALL.
    expect(getPlayerStats()).toMatchObject({ health: 141, hunger: 75, sanity: 25 });
    expect(onEaten).toHaveBeenCalledOnce();
    for (let frame = 0; frame < 120; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(animation.sg.stateName).toBe('idle');
  } finally {
    actions.dispose();
    store.dispose();
  }
});

it('renders source raw/cooked mushroom poses and applies harmful and restorative food values', async () => {
  const assets = new GroundItemAssets();
  const raw = await createGroundItemVisual('green_cap');
  const cooked = await createGroundItemVisual('blue_cap_cooked');
  const { animation, actions, store, slot, entity } = await fixture('green_cap');
  try {
    expect(GROUND_ITEM_DEFINITIONS.green_cap).toMatchObject({
      bank: 'mushrooms',
      animationArchive: 'mushrooms.zip',
      buildArchives: ['mushrooms.zip'],
      animation: 'green_cap',
      atlas: 'images/inventoryimages.xml',
      skinArchives: {},
    });
    expect(GROUND_ITEM_DEFINITIONS.blue_cap_cooked.animation).toBe('blue_cap_cooked');
    for (const sprite of [raw, cooked]) {
      const mesh = sprite.model.children[0].children[0].children[0] as THREE.Mesh;
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    }
    await actions.use(entity);
    for (let frame = 0; frame < 40; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(store.get(slot)?.count).toBe(1);
    expect(getPlayerStats()).toEqual({ health: 140, hunger: 102.5, sanity: 0, sanitySane: false });
    store.add('blue_cap_cooked', 1);
    expect(playerInstance.components.eater!.Eat(store.getEntity(inventorySlotAddress(1))!)).toBe(true);
    expect(getPlayerStats()).toEqual({ health: 137, hunger: 102.5, sanity: 10, sanitySane: false });
  } finally {
    actions.dispose();
    store.dispose();
    raw.dispose();
    cooked.dispose();
    assets.dispose();
  }
});

it('drinks source bananajuice art, consumes once at frame 12 and restores the remaining item and numerical stats', async () => {
  const { animation, actions, store, slot, entity } = await fixture();
  const assets = new GroundItemAssets();
  const ground = await createGroundItemVisual('bananajuice');
  const onEaten = vi.fn();
  entity.ListenForEvent('oneaten', onEaten);
  try {
    expect(GROUND_ITEM_DEFINITIONS.bananajuice).toMatchObject({
      atlas: 'images/inventoryimages1.xml',
      animationArchive: 'cook_pot_food.zip',
      buildArchives: ['cook_pot_food10.zip'],
      symbolOverrides: { swap_food: { symbol: 'bananajuice' } },
      skinArchives: {},
    });
    const mesh = ground.model.children[0].children[0].children[0] as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect(await actions.use(entity)).toBe(true);
    expect(animation.sg.animationClip.key).toBe('quick_drink_pre');
    for (let frame = 0; frame < 11; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(store.get(slot)?.count).toBe(2);
    expect(onEaten).not.toHaveBeenCalled();
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/sip', undefined);
    advancePlayer(animation, 1 / 30);
    expect(store.getEntity(slot)).toBe(entity);
    expect(store.get(slot)?.count).toBe(1);
    expect(getPlayerStats()).toEqual({ health: 148, hunger: 115, sanity: 68 });
    for (let frame = 0; frame < 40; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(onEaten).toHaveBeenCalledOnce();
    const saved = store.exportState();
    store.replaceState(saved, {});
    expect(store.getEntity(slot)).not.toBe(entity);
    expect(store.getEntity(slot)?.id).toBe(entity.id);
    expect(store.get(slot)).toEqual({ itemId: 'bananajuice', count: 1 });
  } finally {
    actions.dispose();
    store.dispose();
    ground.dispose();
    assets.dispose();
  }
});

it('preserves food and stats when cancelled or replaced before commit and clamps a completed drink to the sanity maximum', async () => {
  const { animation, actions, store, slot, entity } = await fixture();
  const eat = () => actions.use(entity);
  try {
    await eat();
    advancePlayer(animation, 0.1);
    window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
    advancePlayer(animation, 1);
    expect(store.get(slot)?.count).toBe(2);
    expect(getPlayerStats()).toEqual({ health: 140, hunger: 90, sanity: 35 });
    expect(eat()).toBe(true);
    actions.cancel();
    advancePlayer(animation, 1);
    expect(store.get(slot)?.count).toBe(2);
    await eat();
    const saved = store.exportState();
    store.replaceState(saved, {});
    for (let frame = 0; frame < 40; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(store.get(slot)?.count).toBe(2);
    expect(playerStats.sanity.current).toBe(35);
    playerStats.sanity.SetCurrent(190);
    const replacement = store.getEntity(slot)!;
    expect(await actions.use(replacement)).toBe(true);
    for (let frame = 0; frame < 40; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(store.get(slot)?.count).toBe(1);
    expect(playerStats.sanity.current).toBe(200);
  } finally {
    actions.dispose();
    store.dispose();
  }
});

it('makes bananapop edible with its source preparedfoods values as a solid VEGGIE food', () => {
  expect(FOOD_EFFECTS.bananapop).toEqual({ health: 20, hunger: 12.5, sanity: 33 });
});

it('keeps the buffered food entity when it moves to another inventory slot', async () => {
  const { animation, actions, store, slot, entity } = await fixture();
  const destination = inventorySlotAddress(1);
  try {
    expect(actions.use(entity)).toBe(true);
    expect(store.transfer(slot, destination, 2)).toBe(true);
    for (let frame = 0; frame < 12; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(store.getEntity(slot)).toBeNull();
    expect(store.getEntity(destination)).toBe(entity);
    expect(store.get(destination)?.count).toBe(1);
    expect(getPlayerStats()).toEqual({ health: 148, hunger: 115, sanity: 68 });
  } finally {
    actions.dispose();
    store.dispose();
  }
});

it('settles the current perish stage at the eat frame and rejects food replaced by rot', async () => {
  const { animation, actions, store, slot, entity } = await fixture('butterflywings');
  const world = createPerishWorld();
  store.entities.bindPerishWorld(world);
  const perish = entity.components.perishable;
  try {
    perish.SetPercent(0.50001);
    expect(actions.use(entity)).toBe(true);
    world.advance(0.5);
    expect(perish.stage.value).toBe('fresh');
    for (let frame = 0; frame < 12; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(perish.stage.value).toBe('stale');
    expect(getPlayerStats()).toEqual({ health: 140 + 8 * 0.333, hunger: 90 + 9.375 * 0.667, sanity: 35 });
    expect(store.get(slot)?.count).toBe(1);
    for (let frame = 0; frame < 40; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    perish.SetPercent(0.00001);
    expect(actions.use(entity)).toBe(true);
    const stats = getPlayerStats();
    world.advance(0.5);
    for (let frame = 0; frame < 12; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(entity.isRemoved).toBe(true);
    expect(store.get(slot)).toMatchObject({ itemId: 'spoiled_food', count: 1 });
    expect(getPlayerStats()).toEqual(stats);
  } finally {
    actions.dispose();
    store.dispose();
  }
});
