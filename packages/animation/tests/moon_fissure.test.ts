import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal, type WorldMoonPhase, type WorldMoonState } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { moonFissurePrefabs, MOON_FISSURE_ID, MoonFissureInstance } from '../../prefab/src/moon_fissure';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { executeDebugCommand } from '../../../src/debugCommands';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createPickupInventory } from './pickupFixture';

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(phase: WorldMoonPhase = 'new', playerPosition = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const moon = createSignal<WorldMoonState>({ phase, waxing: true });
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim',
    { tickingarea: () => createMemo(() => awake.get()), scheduler });
  // TheWorld.state.moonphase, as the world's Moon content.
  const definitions = moonFissurePrefabs({ getWatchWorldContent: (() => moon) as never });
  prefabs.register(definitions);
  const registry = new EntityRegistry([], prefabs, () => playerPosition);
  registry.registerPrefabs(PREFAB_DEFINITIONS.moonFissures);
  const spawn = (record: EntitySaveRecord) =>
    prefabs.restoreAs(MoonFissureInstance, MOON_FISSURE_ID, record);
  const records = () => registry.exportRecords().moon_fissure ?? [];
  const requested = (archive: string) =>
    (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => String(url).endsWith(`/dst/data/anim/${archive}`));
  const dispose = () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); };
  return { scene, awake, prefabs, registry, definitions, spawn, records, requested, dispose };
}
const record = (id: string, x: number): EntitySaveRecord => ({ id, transform: { position: [x, 0, 3], rotationY: 0 }, components: {} });
/** The fissure's own Show / Hide layer declarations. */
const layers = (inst: PrefabInstance) => Object.fromEntries([...inst.sprite.sprite.peek().appearance.values()]
  .flatMap(op => op.kind === 'layer' ? [[op.layer, op.hidden]] : []));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads a save record with the clip, tags, bank and component values moon_fissure.lua fn declares', async () => {
  const { spawn, records, definitions, requested, dispose } = setup('new');
  const half = setup('half');
  try {
    const saved = record('saved-fissure', 2);
    const inst = spawn(saved);
    // AddTag, then the inspectable and sanityaura constructors and repairable's repairmaterial setter, in fn's order.
    // workleft 0 of maxwork 1: no CHOP_workable, and repairable derives workrepairable.
    expect(inst.listTags()).toEqual(['antlion_sinkhole_blocker', 'inspectable', 'sanityaura', 'repairable_moon_altar', 'workrepairable']);
    expect(inst.sprite.sprite.peek()).toMatchObject({ clip: { name: 'crack_idle', loop: true }, queue: [], billboard: true, depthOffset: true });
    expect(definitions.moon_fissure).toMatchObject({ assets: { animationArchive: 'moon_fissure.zip', buildArchives: ['moon_fissure.zip'], bank: 'moon_fissure' } });
    expect(inst.getPhysicsRadius()).toBeCloseTo(.4 * 3);
    const { workable, sanityaura, repairable } = inst.components;
    expect([workable.maxwork.peek(), workable.workleft.peek(), workable.savestate]).toEqual([1, 0, false]);
    expect([repairable.repairmaterial, repairable.noannounce]).toEqual(['moon_altar', true]);
    // UpdateState at a new moon: level 1, radius 0, the backing shown and every glow layer hidden on the fissure.
    expect([inst._level, sanityaura.max_distsq]).toEqual([1, 0]);
    expect(layers(inst)).toEqual({ low: true, med: true, high: true, full: true, backing: false });
    expect(records()).toEqual([saved]);
    await prefabDisplay(inst.transform.model)!.artLoaded();
    expect(requested('moon_fissure.zip')).toBe(true);
    expect(inst.sprite.currentAnimation).toBe('crack_idle');
    // A lit phase hides the backing too, and the aura reaches 1.25 times the light radius.
    const lit = half.spawn(record('half-fissure', 4));
    expect([lit._level, lit.components.sanityaura.max_distsq]).toEqual([3, 6 * 6 * 1.25 * 1.25]);
    expect(layers(lit)).toEqual({ low: true, med: true, high: true, full: true, backing: true });
  } finally { dispose(); half.dispose(); }
});

it('rebuilds the declared clip and layers after tile sleep', async () => {
  const { scene, awake, spawn, records, dispose } = setup('full');
  try {
    const saved = record('sleeping-fissure', 1);
    const inst = spawn(saved);
    const model = inst.transform.model, before = inst.sprite.sprite.peek();
    await prefabDisplay(model)!.artLoaded();
    awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep');
    expect(inst.sprite.loaded).toBe(false);
    expect(model.parent).toBeNull();
    awake.set(true); await settle();
    await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(scene);
    expect(inst.sprite.currentAnimation).toBe('crack_idle');
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'crack_idle', loop: true });
    expect(layers(inst)).toEqual({ low: true, med: true, high: true, full: true, backing: true });
    expect(inst.sprite.sprite.peek().appearance).toEqual(before.appearance);
    expect([inst._level, inst.components.workable.workleft.peek()]).toEqual([5, 0]);
    expect(records()).toEqual([saved]);
  } finally { dispose(); }
});

it('keeps a c_spawn fissure through c_save and a reload, and rejects c_give', async () => {
  const first = setup('quarter', new THREE.Vector3(3, 0, -6)), second = setup('quarter'), inventory = createPickupInventory();
  try {
    expect((await executeDebugCommand('c_spawn("moon_fissure")', inventory, prefab => first.registry.spawn(prefab))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("moon_fissure")', inventory)).ok).toBe(false);
    const before = first.registry.exportRecords();
    let json = '';
    expect((await executeDebugCommand('c_save()', inventory, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG),
        { entities: before, inventory: inventory.exportState(), elapsedSeconds: 1, playerTransform: { position: [3, 0, -6], rotationY: 0 } }, SAVE_CATALOG);
    })).ok).toBe(true);
    const saved = deserializeSave(json, SAVE_CATALOG).world.entities.moon_fissure!;
    expect(saved).toEqual(before.moon_fissure);
    // No OnSave and a workable without savestate: the record is the identity and position alone.
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ transform: { position: [3, 0, -6] }, components: {} });
    await second.registry.restoreAll({ moon_fissure: saved });
    const loaded = second.prefabs.get(saved[0]!.id);
    if (!(loaded instanceof MoonFissureInstance)) throw new Error('The saved fissure did not load');
    expect(loaded.sprite.sprite.peek().clip).toMatchObject({ name: 'crack_idle', loop: true });
    expect([loaded.components.workable.maxwork.peek(), loaded.components.workable.workleft.peek(), loaded._level]).toEqual([1, 0, 2]);
    expect(second.records()).toEqual(saved);
  } finally { first.dispose(); second.dispose(); inventory.dispose(); }
});
