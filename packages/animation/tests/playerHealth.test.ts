import { advancePlayer } from './playerVisual';
import { readFile } from 'node:fs/promises';
import { World } from 'cannon-es';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { inventorySlotAddress } from '../../inventory/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Health } from '../../componets/src/health';
import { createWilsonPlayerPrefab } from './playerVisual';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { actionEntity } from '../../prefab/src/actionEntity';
import { inventoryUse } from './inventoryUseFixture';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import type { WorldContext } from '../../prefab/src/worldContext';
import { createPickupInventory } from './pickupFixture';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

it('eats eight red caps, dies through component events, becomes a ghost and saves the portal resurrection penalty', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scheduler = new GameTimeScheduler(), inventory = createPickupInventory();
  const prefab = await createWilsonPlayerPrefab('/dst/data/anim', new World(), { stats: { health: 150 }, scheduler });
  const { model: player, instance, physics, display } = prefab;
  player.position.set(0, 0, 0);
  const animation = instance.animationController, stats = instance.stats, health = instance.components.health!;
  const world = { scene: new Scene(), player, camera: new PerspectiveCamera(), ground: new Group(),
    renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
  instance.components.inventory = inventory;
  const picker = new PlayerActionPicker(new PointerRaycaster(world));
  const food = inventoryUse({ ...world, mouseActions: picker }, animation.stategraph, instance);
  // The player prefab's own makeplayerghost / respawnfromghost listeners reach these world services on the inst.
  const ghost = instance.ghostMode, death = vi.fn(), hud = { Show: vi.fn(), Hide: vi.fn() };
  const skeleton = { SetSkeletonDescription: vi.fn() };
  const spawned = vi.fn((prefab: string) => prefab === 'skeleton_player' ? skeleton as never : undefined);
  instance.SpawnPrefab = spawned;
  instance.components.playeractionpicker = picker;
  instance.HUD = hud;
  const stopDeath = instance.ListenForEvent('death', death);
  animation.bindDeath({ dropEverything: vi.fn(), isPassableAtPoint: () => true });
  const frames = (count: number) => { for (let i = 0; i < count; i++) advancePlayer(animation, 1 / 30); };
  try {
    expect(stats.health).toBe(health);
    expect(instance.components.hunger).toBe(stats.hunger);
    expect(instance.components.sanity).toBe(stats.sanity);
    expect(health).toBeInstanceOf(Health);
    inventory.add('red_cap', 8);
    const slot = inventorySlotAddress(0), cap = inventory.getEntity(slot)!;
    for (let eaten = 1; eaten <= 8; eaten++) {
      expect(food.use(cap)).toBe(true);
      frames(11);
      expect(health.currenthealth).toBe(Math.max(0, 150 - 20 * (eaten - 1)));
      frames(1);
      expect(health.currenthealth).toBe(Math.max(0, 150 - 20 * eaten));
      if (eaten < 8) frames(40);
    }
    expect(inventory.getEntity(slot)).toBeNull();
    expect(animation.stategraph.stateName).toBe('death');
    expect(death).toHaveBeenCalledOnce();
    expect(death.mock.calls[0][0].cause).toBe('red_cap');
    frames(100);
    expect(ghost.peek()).toBe(true);
    expect(spawned.mock.calls.map(([prefab]) => prefab)).toEqual(['skeleton_player', 'die_fx']);
    expect(skeleton.SetSkeletonDescription).toHaveBeenCalledExactlyOnceWith(instance.prefab, player.name, 'red_cap');
    expect(physics.json.peek()?.mass).toBe(1);
    expect(instance.slipperyfeet).toBeUndefined();
    expect(health.currenthealth).toBe(50);
    expect(health.IsInvincible()).toBe(true);
    expect(stats.hunger.IsPaused()).toBe(true);
    const ghostSanity = stats.sanity.current;
    stats.sanity.DoDelta(-50);
    expect(stats.sanity.current).toBe(ghostSanity);
    expect(health.DoDelta(-20)).toBe(0);
    expect(health.currenthealth).toBe(50);
    const portal = { prefab: 'multiplayer_portal', position: new Vector3(12, 0, 0),
      isValid: () => true, hasTag: (tag: string) => tag === 'multiplayer_portal', PushEvent: vi.fn() };
    instance.PushEvent('respawnfromghost', { source: portal });
    expect(hud.Hide).toHaveBeenCalledOnce(); expect(instance.controllerEnabled).toBe(false);
    scheduler.advance(3);
    expect(ghost.peek()).toBe(false);
    expect(player.position.x).toBe(12);
    expect(portal.PushEvent).toHaveBeenCalledWith('rez_player');
    expect(physics.json.peek()?.mass).toBe(75);
    expect(instance.slipperyfeet).toBeDefined();
    expect(health.penalty).toBe(.25);
    frames(200);
    expect(health.IsInvincible()).toBe(false);
    expect(health.canheal).toBe(true);
    expect(stats.hunger.IsPaused()).toBe(false);
    expect(stats.sanity.ignore).toBe(false);
    expect(instance.components.health).toBe(health);
    health.DoDelta(100);
    expect(health.currenthealth).toBe(112.5);
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const saved = deserializeSave(serializeSave(template, { entities: {}, elapsedSeconds: 3,
      playerTransform: { position: [12, 0, 0], rotationY: 0 }, inventory: inventory.exportState(),
      playerStats: { health: health.currenthealth, penalty: health.penalty, hunger: stats.hunger.current, sanity: stats.sanity.current },
      playerGhost: ghost.peek(),
    }, SAVE_CATALOG), SAVE_CATALOG);
    const restored = new Health(150);
    restored.OnLoad(saved.players.local.stats!);
    expect(restored.currenthealth).toBe(112.5);
    expect(restored.GetMaxWithPenalty()).toBe(112.5);
    expect(saved.players.local.ghost).toBeFalsy();
    restored.dispose();
  } finally {
    food.dispose();
    stopDeath(); inventory.dispose(); instance.remove(); display.dispose();
    scheduler.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it('resurrects a loaded ghost from a haunted amulet, wearing that inst and returning the worn body item', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const scheduler = new GameTimeScheduler(), inventory = createPickupInventory();
  const { model: player, instance, display } = await createWilsonPlayerPrefab('/dst/data/anim', new World(), { stats: { health: 50 }, scheduler });
  player.position.set(0, 0, 0);
  instance.components.inventory = inventory;
  const hud = { Show: vi.fn(), Hide: vi.fn() };
  instance.HUD = hud;
  // A sleeper within ten units of where the amulet raises the player.
  const pig = createEmptyEntity('pigman'), sleeper = { GoToSleep: vi.fn() };
  pig.instance.components.sleeper = sleeper as never;
  pig.instance.setPosition(6, 0, 0);
  actionEntity(pig.display.model, 'pigman');
  try {
    inventory.add('amulet', 2);
    expect(inventory.EquipFromInventory(inventory.getEntity(inventorySlotAddress(0))!)).toBe(true);
    const worn = inventory.GetEquippedItem('body')!;
    // The other amulet lies on the ground, out of the inventory.
    const amulet = inventory.extract(inventorySlotAddress(0), 1, inventory.getEntity(inventorySlotAddress(0))!)!;
    expect(amulet).not.toBe(worn);
    expect(amulet.components.inventoryitem.owner).toBeNull();
    instance.PushEvent('makeplayerghost', { loading: true });
    expect(instance.ghostMode.peek()).toBe(true); expect(instance.hasTag('playerghost')).toBe(true);
    const source = { prefab: 'amulet', entity: amulet, position: new Vector3(4, 0, 0),
      isValid: () => true, hasTag: () => false, PushEvent: vi.fn() };
    instance.PushEvent('respawnfromghost', { source });
    scheduler.advance(3);
    // DoActualRez wore that amulet inst, returning the worn one; amulet_rebirth consumed it on entering.
    expect(inventory.FindItem(item => item === worn)).toBe(worn);
    expect(source.PushEvent).toHaveBeenCalledWith('activateresurrection', player);
    expect(source.PushEvent).not.toHaveBeenCalledWith('rez_player');
    expect(instance.animationController.stategraph.stateName).toBe('amulet_rebirth');
    expect(instance.ghostMode.peek()).toBe(false); expect(instance.hasTag('playerghost')).toBe(false);
    expect(instance.stats.health.penalty).toBe(0);
    // SGwilson amulet_rebirth: the worn amulet leaves the inventory and is removed, the HUD is hidden, and at
    // frame 80 the sleepers nearby go to sleep for 20 seconds.
    expect(inventory.GetEquippedItem('body')).toBeNull();
    expect(amulet.isRemoved).toBe(true);
    expect(hud.Hide).toHaveBeenCalled();
    const graph = instance.animationController.stategraph;
    for (let frame = 0; frame < 81; frame++) advancePlayer(instance.animationController, 1 / 30);
    expect(sleeper.GoToSleep).toHaveBeenCalledExactlyOnceWith(20);
    hud.Show.mockClear();
    for (let frame = 0; frame < 300 && graph.stateName === 'amulet_rebirth'; frame++) advancePlayer(instance.animationController, 1 / 30);
    expect(graph.stateName).toBe('idle');
    expect(hud.Show).toHaveBeenCalled();
    expect(instance.controllerEnabled).toBe(true);
  } finally {
    pig.instance.remove(); pig.display.dispose();
    inventory.dispose(); instance.remove(); display.dispose(); scheduler.dispose(); vi.unstubAllGlobals();
  }
});
