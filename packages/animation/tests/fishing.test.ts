import { getActionString } from '../../stategraphs/src/actions';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Fishable } from '../../componets/src/fishable';
import { configureFishingRodEntity, getFishingRod } from '../../prefab/src/fishingrod';
import { ItemEntity } from '../../inventory/src/entity';
import { equipmentSlotAddress } from '../../inventory/src/addresses';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';
import * as CANNON from 'cannon-es';
import { GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { PondManager } from '../../prefab/src/pond';
import { createEquipmentExistenceState, GameTimeScheduler } from '../../signals/src';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { executeDebugCommand } from '../../../src/debugCommands';
import { inventorySlotAddress } from '../../inventory/src';
import { createPickupInventory } from './pickupFixture';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { inventoryStateFromSave } from '../../../src/save/inventoryState';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true, setVolume() {} })) }));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('hooks, releases and removes fish, respawns them on game time and saves the remaining count', () => {
  const scheduler = new GameTimeScheduler(), tags = new Set<string>();
  const fishable = new Fishable({ addTag: tag => tags.add(tag), removeTag: tag => tags.delete(tag) }, scheduler);
  fishable.AddFish('pondfish', 'fish01');
  fishable.SetRespawnTime(160);
  expect(tags.has('fishable')).toBe(true);
  const released = fishable.HookFish()!;
  expect(fishable.fishleft).toBe(9);
  fishable.ReleaseFish(released);
  expect(fishable.fishleft).toBe(10);
  expect(fishable.OnSave()).toBeUndefined();
  const caught = fishable.RemoveFish(fishable.HookFish()!)!;
  expect(caught).toMatchObject({ prefab: 'pondfish', build: 'fish01' });
  expect(fishable.OnSave()).toEqual({ fish: 9 });
  scheduler.advance(159); expect(fishable.fishleft).toBe(9);
  scheduler.advance(1); expect(fishable.fishleft).toBe(10);
  fishable.Freeze(); expect(tags.has('fishable')).toBe(false);
  fishable.Unfreeze(); expect(tags.has('fishable')).toBe(true);
  const restored = new Fishable({ addTag() {}, removeTag() {} }, scheduler);
  restored.SetRespawnTime(160); restored.OnLoad({ fish: 7 });
  scheduler.advance(160); expect(restored.fishleft).toBe(8);
  restored.OnRemoveFromEntity();
  scheduler.advance(160); expect(restored.fishleft).toBe(8);
});

it('casts at a pond, waits for a bite, hooks, reels and lands a pondfish; a strained rod is lost', async () => {
  const scheduler = new GameTimeScheduler();
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 20);
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  await animation.setCarryItem('fishingrod');
  const world = { scene: new THREE.Scene(), player, camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
  const ponds = new PondManager(world.scene, '/dst/data/anim', scheduler);
  const pond = await ponds.spawn(new THREE.Vector3());
  const landed: { prefab: string; position: THREE.Vector3 }[] = [];
  const equipped = createEquipmentExistenceState('HANDS');
  const rodEntity = () => {
    const entity = new ItemEntity({ itemId: 'fishingrod', count: 1 });
    configureFishingRodEntity(entity);
    entity.components.inventoryitem.owner = { address: equipmentSlotAddress('hand'), remove: () => { entity.destroy(); return true; }, changed() {} } as never;
    return entity;
  };
  let tool = rodEntity();
  equipped.set({ itemId: 'fishingrod', EQUIPSLOTS: 'HANDS', entity: tool });
  const locomotor = new Locomotor({ position: player.position, velocity: new THREE.Vector3() } as unknown as CANNON.Body,
    { physicsRadius: .5 * WORLD_SCALE });
  const updates = new ComponentUpdates();
  // The rod's hand lifecycle attaches its fishingrod component with the scene's scheduler, updates and world.
  const rodOf = () => getFishingRod(tool, scheduler, { landFish: (fish, position) => landed.push({ prefab: fish.prefab, position }) }, updates);
  // SGwilson's fishing states reach the held rod, as the application binds them.
  animation.bindFishing({ waitForFish: () => rodOf().WaitForFish(), collect: () => rodOf().Collect(),
    loseRod: () => { rodOf().Release(); tool.remove(); } });
  // The player inst: the rod's events reach its stategraph, whose tags gate the rod.
  const doer = { hasTag: (tag: string) => tag === 'player', getPosition: () => player.position,
    PushEvent: (name: string, data: unknown) => animation.stategraph.pushEvent(name, data),
    sg: { HasStateTag: (tag: string) => animation.stategraph.hasStateTag(tag) } };
  const playerController = new PlayerController(world, animation, locomotor, equipped, () => false, doer as never);
  const pondEntity = () => findActionEntity(pond)!;
  const controller = {
    // EQUIPPED.fishingrod on the left button: FISH a pond, or REEL the one being fished (an instant action).
    request: (target: ReturnType<typeof pondEntity>) => {
      rodOf();
      const [action] = collectEquippedItemActions(tool, doer, target, false);
      return !!action && playerController.DoAction(playerController.createAction({ action, target, invobject: tool })!);
    },
    update: (_dt: number) => { locomotor.update(16, 1 / 30); updates.update(1 / 30); },
    dispose: () => playerController.dispose(),
  };
  const fishable = () => (findActionEntity(pond).components as { fishable: Fishable }).fishable;
  const advance = (frames: number) => { for (let i = 0; i < frames; i++) animation.update(1 / 30); };
  const advanceUntil = (done: () => boolean) => { for (let i = 0; i < 300 && !done(); i++) animation.update(1 / 30); expect(done()).toBe(true); };
  try {
    expect(inventoryItemEquipmentKind('fishingrod')).toBe('hand');
    expect(inventoryItemMaxStack('fishingrod')).toBe(1);
    expect(GROUND_ITEM_DEFINITIONS.fishingrod.skinArchives).toHaveProperty('fishingrod_sword');
    expect(findActionEntity(pond).hasTag('fishable')).toBe(true);

    expect(controller.request(pondEntity())).toBe(true);
    expect(locomotor.bufferedAction).toBeDefined();
    // ARRIVE_STEP plus the pond's 1.95 and the player's .5 radius.
    player.position.set(0, 0, 7); controller.update(0);
    expect(animation.stategraph.stateName).toBe('fishing_pre');
    advanceUntil(() => animation.stategraph.stateName === 'fishing');
    expect(rodOf().IsFishing()).toBe(true);
    expect(animation.stategraph.hasStateTag('fishing')).toBe(true);
    // EQUIPPED.fishingrod offers REEL on the fished pond; REEL.strfn names what it would do.
    const reelString = () => getActionString({ action: 'REEL', doer, invobject: tool, target: pondEntity() });
    expect(collectEquippedItemActions(tool, doer, pondEntity(), false)).toEqual(['REEL']);
    expect(reelString()).toBe('停止钓鱼');

    // 4 s minimum wait with a full pond; a click on the pond while waiting would stop fishing, so wait for the bite.
    scheduler.advance(4);
    expect(animation.stategraph.stateName).toBe('fishing_nibble');
    expect(rodOf().FishIsBiting()).toBe(true);
    expect(reelString()).toBe('上钩');
    controller.request(pondEntity()); // REEL: Hook
    expect(animation.stategraph.stateName).toBe('fishing_strain');
    expect(rodOf().HasHookedFish()).toBe(true);
    expect(reelString()).toBe('收线');
    expect(fishable().fishleft).toBe(9);
    controller.request(pondEntity()); // REEL: Reel
    expect(animation.stategraph.stateName).toBe('catchfish');
    expect(landed).toEqual([]);
    advance(23); expect(landed).toEqual([]);
    advance(2);
    expect(landed).toHaveLength(1);
    expect(landed[0].prefab).toBe('pondfish');
    expect(landed[0].position.z).toBeGreaterThan(7);
    expect(tool.components.finiteuses.remaining).toBe(8);
    advanceUntil(() => animation.stategraph.stateName === 'idle');
    expect(rodOf().IsFishing()).toBe(false);
    expect(fishable().fishleft).toBe(9);
    expect(fishable().OnSave()).toEqual({ fish: 9 });

    // Hook a fish and let the line strain until the rod is lost: the fish returns to the pond.
    expect(controller.request(pondEntity())).toBe(true); controller.update(0);
    advanceUntil(() => animation.stategraph.stateName === 'fishing');
    scheduler.advance(40); // nibble: 4 + (1 - .9) * 36 s
    expect(animation.stategraph.stateName).toBe('fishing_nibble');
    controller.request(pondEntity());
    expect(fishable().fishleft).toBe(8);
    scheduler.advance(5 * (8 / 9) + .01);
    expect(animation.stategraph.stateName).toBe('loserod');
    expect(tool.isRemoved).toBe(true);
    expect(fishable().fishleft).toBe(9);
    expect(landed).toHaveLength(1);
    advanceUntil(() => animation.stategraph.stateName === 'idle');

    // Walking away mid-cast cancels fishing instead of leaving the line out.
    tool = rodEntity();
    equipped.set({ itemId: 'fishingrod', EQUIPSLOTS: 'HANDS', entity: tool });
    expect(controller.request(pondEntity())).toBe(true); controller.update(0);
    advanceUntil(() => animation.stategraph.stateName === 'fishing');
    animation.stategraph.cancelAction('FISH');
    controller.update(0);
    expect(animation.stategraph.hasStateTag('fishing')).toBe(false);
    expect(rodOf().IsFishing()).toBe(false);
  } finally { controller.dispose(); ponds.dispose(); }
});

it('gives a fishing rod with c_give and saves worn rods and pond fish through c_save', async () => {
  const scheduler = new GameTimeScheduler(), scene = new THREE.Scene();
  const inventory = createPickupInventory(), restoredInventory = createPickupInventory();
  const ponds = new PondManager(scene, '/dst/data/anim', scheduler), restored = new PondManager(scene, '/dst/data/anim', scheduler);
  try {
    expect((await executeDebugCommand('c_give("fishingrod")', inventory)).ok).toBe(true);
    const rod = inventory.getEntity(inventorySlotAddress(0))!;
    expect(rod.hasTag('fishingrod')).toBe(true);
    expect(rod.components.finiteuses.remaining).toBeUndefined();
    rod.PushEvent('fishingcollect', undefined);
    expect(rod.components.finiteuses.remaining).toBe(8);
    const pond = await ponds.spawn(new THREE.Vector3(30, 0, 0), { id: 'pond-1', transform: { position: [30, 0, 0], rotationY: 0 }, components: { fishable: { fish: 7 } } });
    expect(findActionEntity(pond).components.fishable.fishleft).toBe(7);
    const before = inventory.exportState();
    let json = '';
    const save = () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), {
        entities: { pond: ponds.exportRecords() }, inventory: before, elapsedSeconds: 1, playerTransform: { position: [0, 0, 0], rotationY: 0 },
      }, SAVE_CATALOG);
    };
    expect((await executeDebugCommand('c_save()', inventory, undefined, save)).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG);
    restoredInventory.replaceState(inventoryStateFromSave(saved), SAVE_CATALOG.recipes);
    expect(restoredInventory.exportState()).toEqual(before);
    expect(restoredInventory.getEntity(inventorySlotAddress(0))!.components.finiteuses.remaining).toBe(8);
    const record = saved.world.entities.pond.find(({ id }) => id === 'pond-1')!;
    expect(record.components.fishable).toEqual({ fish: 7 });
    const again = await restored.spawn(new THREE.Vector3(...record.transform.position), record as never);
    expect(findActionEntity(again).components.fishable.fishleft).toBe(7);
    scheduler.advance(160);
    expect(findActionEntity(again).components.fishable.fishleft).toBe(8);
  } finally { ponds.dispose(); restored.dispose(); inventory.dispose(); restoredInventory.dispose(); scheduler.dispose(); }
});
