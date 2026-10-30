import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { PIG_HEAD_DEFINITION, PIG_HEAD_ID, MERM_HEAD_DEFINITION, MERM_HEAD_ID } from '../../prefab/src/stickheads';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { performToolWork } from '../../stategraphs/src/componentactions';
import type { SpriteController } from '../src/sprite';
import type { WorldContext } from '../../prefab/src/worldContext';
import type { Burnable } from '../../componets/src/burnable';
import * as sound from '../../prefab/src/sound';
import { createMemo, createSignal, type TileStateQuery } from '../../signals/src';
import { bindTestWorld } from './worldContentFixture';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const HEADS = [
  { id: PIG_HEAD_ID, definition: PIG_HEAD_DEFINITION, loot: [{ itemId: 'pigskin', count: 2 }, { itemId: 'twigs', count: 2 }] },
  { id: MERM_HEAD_ID, definition: MERM_HEAD_DEFINITION, loot: [{ itemId: 'pondfish', count: 1 }, { itemId: 'spoiled_food', count: 2 }, { itemId: 'twigs', count: 2 }] },
] as const;

async function setup(id: typeof HEADS[number]['id'] = PIG_HEAD_ID, tickingarea?: TileStateQuery) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.spyOn(sound, 'PlaySound').mockReturnValue({ stop: vi.fn(), isPlaying: () => true, setVolume: vi.fn() });
  vi.spyOn(sound, 'PreloadSounds').mockResolvedValue(undefined as never);
  const scheduler = new GameTimeScheduler(), content = bindTestWorld(scheduler);
  const loot: { itemId: string; count: number }[][] = [];
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() }, scheduler,
    getWatchWorldContent: content.getWatchWorldContent, tickingarea, dropLoot: (items: { itemId: string; count: number }[]) => loot.push(items) } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { [id]: HEADS.find(head => head.id === id)!.definition }, () => false);
  placement.spawn(id);
  const model = placement.hammerTargets[0].display.model, sprite = prefabInstance(model)!.sprite as SpriteController;
  // The display loads the head's art; its clips play once it is drawn.
  await vi.waitFor(() => expect(sprite.loaded).toBe(true));
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const finish = () => { for (let i = 0; i < 90; i++) sprite.update(1 / 30); };
  return { placement, scheduler, content, loot, model, sprite, settle, finish };
}

it.each(HEADS)('$id sleeps by default, wakes on a full-moon night, is hit by the hammer and drops fuel with its deconstruct loot', async ({ id, loot }) => {
  const s = await setup(id);
  try {
    expect(s.sprite.currentAnimation).toBe('idle_asleep');
    s.content.moon.set({ phase: 'full', waxing: false }); s.content.cycle.set('night'); await s.settle();
    expect(s.sprite.currentAnimation).toBe('wake'); s.finish();
    expect(s.sprite.currentAnimation).toBe('idle_awake');
    const entity = s.placement.hammerTargets[0].entity;
    expect(performToolWork('HAMMER', entity, {})).toBe(true);
    expect(s.sprite.currentAnimation).toBe('hit'); s.finish();
    expect(s.sprite.currentAnimation).toBe('idle_awake');
    s.content.cycle.set('day'); await s.settle();
    expect(s.sprite.currentAnimation).toBe('sleep'); s.finish();
    expect(s.sprite.currentAnimation).toBe('idle_asleep');
    s.content.cycle.set('night'); await s.settle(); s.finish();
    expect(performToolWork('HAMMER', entity, {})).toBe(true);
    expect(performToolWork('HAMMER', entity, {})).toBe(true);
    // The deconstruct recipe at the 50% hammer rate, plus nightmarefuel while the moon is full.
    expect(s.loot.flat()).toEqual(expect.arrayContaining([...loot, { itemId: 'nightmarefuel', count: 1 }]));
    expect(s.placement.exportRecords()).toEqual([]);
  } finally { s.placement.dispose(); }
});

it.each(HEADS)('$id burns to a burnt head that keeps sleeping, saves only the burnt state and drops reduced loot', async ({ id }) => {
  const s = await setup(id);
  try {
    const entity = s.placement.hammerTargets[0].entity;
    ((findActionEntity(s.model)?.components ?? prefabInstance(s.model)!.components).burnable as Burnable).Ignite(); s.placement.update(11);
    expect(entity.hasTag('burnt')).toBe(true); expect(s.sprite.currentAnimation).toBe('burnt');
    s.content.moon.set({ phase: 'full', waxing: false }); s.content.cycle.set('night'); await s.settle();
    expect(s.sprite.currentAnimation).toBe('burnt');
    expect(s.placement.exportRecords()[0].record.components.building).toMatchObject({ burnt: true });
    for (let i = 0; i < 3; i++) performToolWork('HAMMER', entity, {});
    expect(s.loot.flat().some(item => item.itemId === 'nightmarefuel')).toBe(true);
    expect(s.placement.exportRecords()).toEqual([]);
  } finally { s.placement.dispose(); }
});

it('releases the flies swarm sprite outside the tickingarea and rebuilds it without becoming clickable', async () => {
  const awake = createSignal(true);
  const s = await setup(PIG_HEAD_ID, (() => createMemo(() => awake.get())) as TileStateQuery);
  try {
    const swarm = s.model.children.find(child => child.name === 'flies')!;
    const flies = () => swarm;
    const meshes = () => { let count = 0; flies().traverse(object => { if ((object as THREE.Mesh).isMesh) count++; }); return count; };
    await vi.waitFor(() => expect(meshes()).toBeGreaterThan(0));
    awake.set(false); await s.settle();
    expect(meshes()).toBe(0);
    // The inactive swarm leaves the scene graph and returns to the same parent on wake.
    expect(swarm.parent).toBeNull();
    awake.set(true); await s.settle();
    expect(swarm.parent).toBe(s.model);
    await vi.waitFor(() => expect(meshes()).toBeGreaterThan(0));
    flies().traverse(object => { if ((object as THREE.Mesh).isMesh) expect(object.raycast).not.toBe(THREE.Mesh.prototype.raycast); });
  } finally { s.placement.dispose(); }
});
