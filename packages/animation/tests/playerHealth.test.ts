import { readFile } from 'node:fs/promises';
import { World } from 'cannon-es';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { expect, it, vi } from 'vitest';
import { createSignal } from '@dontstarve-web/signals';
import { inventorySlotAddress } from '../../inventory/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Health } from '../../componets/src/health';
import { createWilsonPlayerPrefab } from './playerVisual';
import { OnMakePlayerGhost, OnRespawnFromGhost, type PlayerGhostOwner } from '../../prefab/src/player_common';
import { FoodActionController } from '../../stategraphs/src/eat';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { getFoodEffects } from '../../prefab/src/food';
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
  const prefab = await createWilsonPlayerPrefab('/dst/data/anim', new World(), { stats: { health: 150 } });
  const { model: player, instance, physics, display } = prefab;
  player.position.set(0, 0, 0);
  const animation = instance.animationController, stats = instance.stats, health = instance.components.health!;
  const world = { scene: new Scene(), player, camera: new PerspectiveCamera(), ground: new Group(),
    renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
  const picker = new PlayerActionPicker(new PointerRaycaster(world));
  const food = new FoodActionController({ ...world, mouseActions: picker }, animation,
    { stop() {}, goToPoint: () => true, destination: undefined }, { soilTargets: [], plantSeed: () => false });
  const ghost = createSignal(false), skeleton = vi.fn(), death = vi.fn();
  const owner: PlayerGhostOwner = {
    model: player, animation, physics, stats, sanity: { ignore: false }, ghostMode: ghost,
    spawnDeathProduct: skeleton, spawnDieFx() {}, schedule: (seconds, fn) => scheduler.schedule(seconds, fn),
    addSlipperyFeet() {}, removeSlipperyFeet() {}, setHidden: hidden => instance.sprite.setVisible(!hidden),
    setGhostLight() {}, teleport: position => { player.position.copy(position); physics.Teleport(); },
    setControllerEnabled: enabled => { instance.controllerEnabled = enabled; }, showHUD() {}, actionPicker: picker,
    equipRezSource: async () => false,
  };
  const makeGhost = (event: { data?: unknown }) => OnMakePlayerGhost(owner, event.data as { skeleton?: boolean });
  player.addEventListener('makeplayerghost' as never, makeGhost);
  player.addEventListener('death' as never, death);
  animation.bindDeath({ dropEverything: vi.fn(), isPassableAtPoint: () => true });
  const frames = (count: number) => { for (let i = 0; i < count; i++) animation.update(1 / 30); };
  try {
    expect(stats.health).toBe(health);
    expect(health).toBeInstanceOf(Health);
    inventory.add('red_cap', 8);
    const slot = inventorySlotAddress(0), cap = inventory.getEntity(slot)!;
    const source = { isValid: () => inventory.getEntity(slot) === cap && !cap.isRemoved,
      take: () => inventory.applySlotChanges([{ slot, itemId: 'red_cap', delta: -1 }]) };
    for (let eaten = 1; eaten <= 8; eaten++) {
      const effects = getFoodEffects(cap)!;
      expect(food.eat(source, () => health.DoDelta(effects.health, false, cap.prefab))).toBe(true);
      frames(11);
      expect(health.currenthealth).toBe(Math.max(0, 150 - 20 * (eaten - 1)));
      frames(1);
      expect(health.currenthealth).toBe(Math.max(0, 150 - 20 * eaten));
      if (eaten < 8) frames(40);
    }
    expect(inventory.getEntity(slot)).toBeNull();
    expect(animation.stategraph.stateName).toBe('death');
    expect(death).toHaveBeenCalledOnce();
    expect(death.mock.calls[0][0].data.cause).toBe('red_cap');
    frames(100);
    expect(ghost.peek()).toBe(true);
    expect(skeleton).toHaveBeenCalledOnce();
    expect(health.currenthealth).toBe(50);
    expect(health.IsInvincible()).toBe(true);
    expect(health.DoDelta(-20)).toBe(0);
    expect(health.currenthealth).toBe(50);
    const portal = { prefab: 'multiplayer_portal', position: new Vector3(12, 0, 0),
      isValid: () => true, hasTag: (tag: string) => tag === 'multiplayer_portal', PushEvent: vi.fn() };
    OnRespawnFromGhost(owner, { source: portal });
    scheduler.advance(3);
    expect(ghost.peek()).toBe(false);
    expect(health.penalty).toBe(.25);
    frames(200);
    expect(health.IsInvincible()).toBe(false);
    expect(health.canheal).toBe(true);
    expect(instance.components.health).toBe(health);
    health.DoDelta(100);
    expect(health.currenthealth).toBe(112.5);
    const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
    const saved = deserializeSave(serializeSave(template, { entities: {}, elapsedSeconds: 3,
      playerTransform: { position: [12, 0, 0], rotationY: 0 }, inventory: inventory.exportState(),
      playerStats: { health: health.currenthealth, penalty: health.penalty, hunger: stats.hunger.peek(), sanity: stats.sanity.peek() },
      playerGhost: ghost.peek(),
    }, SAVE_CATALOG), SAVE_CATALOG);
    const restored = new Health(150);
    restored.OnLoad(saved.players.local.stats!);
    expect(restored.currenthealth).toBe(112.5);
    expect(restored.GetMaxWithPenalty()).toBe(112.5);
    expect(saved.players.local.ghost).toBeFalsy();
    restored.dispose();
  } finally {
    food.dispose(); player.removeEventListener('makeplayerghost' as never, makeGhost);
    player.removeEventListener('death' as never, death); inventory.dispose(); instance.remove(); display.dispose();
    scheduler.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
