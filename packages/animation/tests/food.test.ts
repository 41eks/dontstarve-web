import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FoodActionController, type FoodSource } from '../../stategraphs/src/food';
import { FOOD_EFFECTS } from '../../prefab/src/food';
import { createWilsonPlayer, type WilsonAnimationController } from '../../prefab/src/player';
import { PlaySound, PreloadSounds } from '../../prefab/src/sound';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS, createGroundItemSprite } from '../../prefab/src/groundItems';
import { InventoryStore, InventorySlot, inventorySlotAddress } from '@dontstarve-web/inventory';
import type { WorldContext } from '../../prefab/src/worldContext';
import { applyPlayerFoodEffects, getPlayerStats, playerStats } from '../../../src/playerStats';

vi.mock('../../../src/save/initialSave', () => ({ initialSave: { players: { local: { stats: { health: 140, hunger: 90, sanity: 35 } } } } }));
vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  playerStats.health = 140; playerStats.hunger = 90; playerStats.sanity.set(35);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = player.userData.animationController as WilsonAnimationController;
  const world = { scene: new THREE.Scene(), player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
  const actions = new FoodActionController(world, animation, { stop() {}, goToPoint: () => true, destination: undefined },
    { soilTargets: [], prepareSeedPlant: async () => undefined });
  const slot = inventorySlotAddress(0);
  const store = new InventoryStore([{ address: slot, slot: new InventorySlot() }], {
    bananajuice: { name: '香蕉奶昔', icon: 'bananajuice.tex', atlas: 'images/inventoryimages1.xml', maxStack: 40 },
  });
  store.add('bananajuice', 2);
  const entity = store.getEntity(slot)!;
  const source: FoodSource = {
    foodDrink: FOOD_EFFECTS.bananajuice.foodDrink,
    prepareEat: () => PreloadSounds('dontstarve/wilson/sip'),
    isValid: () => !entity.isRemoved && store.getEntity(slot) === entity,
    take: () => store.applySlotChanges([{ slot, itemId: 'bananajuice', delta: -1 }]),
  };
  return { animation, actions, store, slot, entity, source };
}

it('drinks source bananajuice art, consumes once at frame 12 and restores the remaining item and numerical stats', async () => {
  const { animation, actions, store, slot, entity, source } = await fixture();
  const assets = new GroundItemAssets('/dst/data/anim');
  const ground = await createGroundItemSprite(assets, 'bananajuice');
  const onEaten = vi.fn(() => applyPlayerFoodEffects(FOOD_EFFECTS.bananajuice));
  try {
    expect(GROUND_ITEM_DEFINITIONS.bananajuice).toMatchObject({ atlas: 'images/inventoryimages1.xml', animationArchive: 'cook_pot_food.zip',
      buildArchives: ['cook_pot_food10.zip'], symbolOverrides: { swap_food: { symbol: 'bananajuice' } }, skinArchives: {} });
    const mesh = ground.model.children[0].children[0] as THREE.Mesh;
    expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
    expect(await actions.eat(source, onEaten)).toBe(true);
    expect(animation.stategraph.animationClip.key).toBe('quick_drink_pre');
    for (let frame = 0; frame < 11; frame++) animation.update(1 / 30);
    expect(store.get(slot)?.count).toBe(2);
    expect(onEaten).not.toHaveBeenCalled();
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/sip');
    animation.update(1 / 30);
    expect(store.getEntity(slot)).toBe(entity);
    expect(store.get(slot)?.count).toBe(1);
    expect(getPlayerStats()).toEqual({ health: 148, hunger: 115, sanity: 68 });
    for (let frame = 0; frame < 40; frame++) animation.update(1 / 30);
    expect(onEaten).toHaveBeenCalledOnce();
    const saved = store.exportState();
    store.replaceState(saved, {});
    expect(store.getEntity(slot)).not.toBe(entity);
    expect(store.getEntity(slot)?.id).toBe(entity.id);
    expect(store.get(slot)).toEqual({ itemId: 'bananajuice', count: 1 });
  } finally { actions.dispose(); store.dispose(); ground.dispose(); assets.dispose(); }
});

it('preserves food and stats when cancelled or replaced before commit and clamps a completed drink to the sanity maximum', async () => {
  const { animation, actions, store, slot, source } = await fixture();
  const eat = () => actions.eat(source, () => applyPlayerFoodEffects(FOOD_EFFECTS.bananajuice));
  try {
    await eat(); animation.update(0.1); actions.cancel(); animation.update(1);
    expect(store.get(slot)?.count).toBe(2);
    expect(getPlayerStats()).toEqual({ health: 140, hunger: 90, sanity: 35 });
    const pending = eat(); actions.cancel(); expect(await pending).toBe(false);
    await eat();
    const saved = store.exportState();
    store.replaceState(saved, {});
    for (let frame = 0; frame < 40; frame++) animation.update(1 / 30);
    expect(store.get(slot)?.count).toBe(2);
    expect(playerStats.sanity.peek()).toBe(35);
    playerStats.sanity.set(190);
    const replacement = store.getEntity(slot)!;
    expect(await actions.eat({ ...source, isValid: () => store.getEntity(slot) === replacement }, () => applyPlayerFoodEffects(FOOD_EFFECTS.bananajuice))).toBe(true);
    for (let frame = 0; frame < 40; frame++) animation.update(1 / 30);
    expect(store.get(slot)?.count).toBe(1);
    expect(playerStats.sanity.peek()).toBe(200);
  } finally { actions.dispose(); store.dispose(); }
});
