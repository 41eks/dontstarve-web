import { plantManager } from './plantManagerFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { prefabDisplay } from '@dontstarve-web/display';
import { executeDebugCommand } from '../../../src/debugCommands';
import { createInventoryStore } from '../../../src/inventory';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { lichenPrefabs, LICHEN_ID, type LichenRecord } from '../../prefab/src/lichen';
import { bindTestWorld, tickWorld, plantInstance } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(player = new THREE.Vector3()) {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
  const scene = new THREE.Scene(), scheduler = new GameTimeScheduler(), awake = createSignal(true);
  const world = bindTestWorld(scheduler);
  const loot: string[] = [];
  const lichens = plantManager(lichenPrefabs, scene, { tickingarea: () => createMemo(() => awake.get()),
    spawnGroundItem: definition => { loot.push(definition.itemId); return undefined; } });
  const registry = new EntityRegistry(), inventory = createInventoryStore([]);
  registry.register(PREFAB_DEFINITIONS.lichens, {
    restore: (_, record) => lichens.spawn('lichen', new THREE.Vector3(...record.transform.position), { id: record.id, transform: record.transform, components: { pickable: record.components.pickable } }).transform.model,
    debugSpawn: () => lichens.spawn('lichen', player.clone()).transform.model,
    exportRecords: () => lichens.exportRecords(),
    update: (dt, quaternion) => tickWorld(scheduler, lichens, dt, quaternion),
    renderEntities: () => lichens.renderEntities,
    dispose: () => lichens.dispose(),
  });
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const save = () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
    playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
  return { scene, scheduler, awake, lichens, registry, inventory, save, loot,
    dispose: () => { registry.dispose(); inventory.dispose(); world.unbind(); scheduler.dispose(); } };
}

// Imported Caves records: pickable={caninteractwith=true} is pickable's default, so a ready lichen saves no components.
const READY: LichenRecord = { id: 'dst_04E26ADB66396E8D_lichen_id_114188', transform: { position: [447, 0, 151.26], rotationY: 0 }, components: {} };
const PICKED: LichenRecord = { id: 'picked-lichen', transform: { position: [450, 0, 151], rotationY: 0 },
  components: { pickable: { picked: true, regrowSeconds: 600 } } };

it('loads ready and picked lichen with the lichen.lua clips, tag and tint, and picks cutlichen', async () => {
  const s = setup();
  try {
    const ready = s.lichens.spawn('lichen', new THREE.Vector3(...READY.transform.position), READY).transform.model;
    const inst = plantInstance(ready);
    // fn: PlayAnimation("idle", true) on a random frame, SetMultColour(c, c, c, 1) with c in [.75, 1].
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: true });
    const [grey] = inst.sprite.sprite.peek().colour!;
    expect(grey).toBeGreaterThanOrEqual(.75); expect(grey).toBeLessThanOrEqual(1);
    expect(inst.sprite.sprite.peek().colour).toEqual([grey, grey, grey]);
    expect(inst.hasTag('lichen')).toBe(true);
    expect(inst.minimap.icon).toBe('lichen.png');
    expect(inst.components.workable).toBeUndefined();
    await prefabDisplay(ready)!.artLoaded();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/algae_bush.zip'));

    // Pickable:OnLoad -> makeemptyfn: PlayAnimation("picked"), resting on its last frame, with the saved regrow time.
    const picked = plantInstance(s.lichens.spawn('lichen', new THREE.Vector3(...PICKED.transform.position), PICKED).transform.model);
    expect(picked.sprite.currentAnimation).toBe('picked');
    expect(picked.components.pickable.state.phase.peek()).toBe('picked');
    expect(picked.components.pickable.remainingSeconds).toBeCloseTo(600);

    // onpickedfn: picking -> picked; the product is cutlichen.
    expect(inst.components.pickable.pick({ giveItem: (id: string, count: number) => id === 'cutlichen' && count === 1 })).toBe(true);
    expect(inst.sprite.currentAnimation).toBe('picking');
    expect(s.lichens.exportRecords().map(({ record }) => record).map(record => record.components)).toEqual([
      { pickable: { picked: true, regrowSeconds: expect.any(Number) } }, { pickable: { picked: true, regrowSeconds: expect.any(Number) } }]);
    expect(PREFAB_DEFINITIONS.lichens.parseComponents(PICKED.components, 'lichen', { grounded: true } as never)).toEqual(PICKED.components);
  } finally { s.dispose(); }
});

it('releases a lichen while its tile sleeps and redraws the declared idle with its tint when it wakes', async () => {
  const s = setup();
  try {
    const model = s.lichens.spawn('lichen', new THREE.Vector3(...READY.transform.position), READY).transform.model;
    const inst = plantInstance(model);
    await prefabDisplay(model)!.artLoaded();
    const declared = inst.sprite.sprite.peek();
    s.awake.set(false); await settle();
    expect(inst.status.peek()).toBe('asleep'); expect(inst.sprite.loaded).toBe(false); expect(model.parent).toBeNull();
    s.awake.set(true); await settle(); await prefabDisplay(model)!.artLoaded();
    expect(model.parent).toBe(s.scene);
    expect(inst.sprite.sprite.peek().clip).toMatchObject({ name: declared.clip.name, loop: true });
    expect(inst.sprite.sprite.peek().colour).toEqual(declared.colour);
    expect(inst.sprite.currentAnimation).toBe('idle');
  } finally { s.dispose(); }
});

it('c_spawn then c_save exports a lichen and a given cutlichen stack, and the exported save restores them', async () => {
  const first = setup(new THREE.Vector3(12, 0, -6));
  let json = '';
  try {
    expect((await executeDebugCommand(`c_spawn("${LICHEN_ID}")`, first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    const [model] = first.scene.children;
    expect(plantInstance(model).components.pickable.pick({ giveItem: () => true })).toBe(true);
    // cutlichen.lua: the picked product is an ordinary stackable item (STACK_SIZE_SMALLITEM).
    expect((await executeDebugCommand('c_give("cutlichen", 3)', first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, () => { json = first.save(); })).ok).toBe(true);
  } finally { first.dispose(); }
  const saved = deserializeSave(json, SAVE_CATALOG);
  expect(JSON.stringify(saved.players.local.inventory)).toMatch(/"itemId":"cutlichen","count":3/);
  const records = saved.world.entities[LICHEN_ID];
  expect(records).toHaveLength(1);
  expect(records[0]).toMatchObject({ transform: { position: [12, 0, -6], rotationY: 0 },
    components: { pickable: { picked: true, regrowSeconds: expect.any(Number) } } });

  const second = setup();
  try {
    await second.registry.restoreAll({ [LICHEN_ID]: records });
    const [model] = second.scene.children;
    const inst = plantInstance(model);
    expect(inst.entityId).toBe(records[0].id);
    expect(inst.position.toArray()).toEqual([12, 0, -6]);
    expect(inst.sprite.currentAnimation).toBe('picked');
    expect(second.registry.exportRecords()[LICHEN_ID]).toEqual(records);
  } finally { second.dispose(); }
});
