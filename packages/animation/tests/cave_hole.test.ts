import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { unzipSync, strFromU8 } from 'fflate';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { FACING } from '../src/facing';
import { CAVE_HOLE_ID, caveHolePrefabs, type CaveHoleInstance } from '../../prefab/src/cave_hole';
import { bindPhysics } from '../../componets/src/physicsBinding';
import { PhysicsState } from '../../componets/src/physicsState';
import { staticObstacleTest } from '../../prefab/src/locomotor';
import { isGroundTargetBlocked, placementEntities } from '../../prefab/src/placementEntities';
import { MakeCharacterPhysics } from '../../prefab/src/standardcomponents';
import { setMouseTargetEnabled } from '../../prefab/src/mouseTargets';
import { isMouseTarget } from '../../stategraphs/src/mouseTargets';
import { PrefabEntityManager, prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { createInventoryStore } from '../../../src/inventory';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { createClusterSaveZip } from '../../../src/save/download';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { CLUSTER_SAVE_ZIP_TIMEOUT } from './importedSave';

const turn = () => new Promise(resolve => setTimeout(resolve, 0));
const record = { id: 'saved-hole', transform: { position: [3, 0, 6] as [number, number, number], rotationY: 0 }, components: { allowspawn: false } };

function setup(physics?: CANNON.World) {
  const scene = new THREE.Scene(), awake = createSignal(true);
  const tickingarea = () => createMemo(() => awake.get());
  const displays = new PrefabDisplayGroup(scene);
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { tickingarea, physics });
  prefabs.register(caveHolePrefabs({ spawnPrefab: (id, position) => prefabs.spawn(id, position) }) as never);
  const registry = new EntityRegistry([], prefabs, () => new THREE.Vector3(12, 0, -6)), inventory = createInventoryStore([]);
  registry.registerPrefabs(PREFAB_DEFINITIONS.caveHoles);
  const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
  const instances = () => scene.children.map(model => prefabInstance<PrefabInstance>(model)!);
  return { scene, awake, prefabs, registry, inventory, instances,
    hole: () => instances().find(inst => inst.prefab === CAVE_HOLE_ID) as CaveHoleInstance,
    surface: () => instances().find(inst => inst.prefab === 'cave_hole_surface')!,
    save: () => serializeSave(template, { entities: registry.exportRecords(), inventory: inventory.exportState(), elapsedSeconds: 0,
      playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG),
    dispose() { registry.dispose(); prefabs.dispose(); displays.dispose(); inventory.dispose(); } };
}
const artLoaded = (inst: PrefabInstance) => prefabDisplay(inst.transform.model)!.artLoaded();

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('restores a saved hole with its Lua clips, tags, layers and surface child', async () => {
  const s = setup();
  try {
    const hole = s.prefabs.spawn(CAVE_HOLE_ID, new THREE.Vector3(3, 0, 6), record) as CaveHoleInstance;
    const surface = s.surface();
    expect(hole.allowspawn).toBe(false);
    for (const tag of ['groundhole', 'blocker', 'blinkfocus']) expect(hole.hasTag(tag)).toBe(true);
    for (const tag of ['DECOR', 'NOCLICK']) expect(surface.hasTag(tag)).toBe(true);
    expect(surface.persists).toBe(false);
    expect(surface.entityParent).toBe(hole);
    for (const [inst, hidden] of [[hole, 'surface'], [surface, 'hole']] as const) {
      const json = inst.sprite.sprite.peek();
      expect(json.clip).toMatchObject({ name: 'idle', loop: false });
      expect(json.queue).toEqual([]);
      expect(json.facing).toBe(FACING.LEFT);
      expect(json.ground).toEqual({ renderOrder: 0, flat: true });
      expect(json.appearance.get(`layer:${hidden}`)).toMatchObject({ layer: hidden, hidden: true });
    }
    expect(hole.sprite.sprite.peek().meshOrder!).toBeGreaterThan(surface.sprite.sprite.peek().meshOrder!);
    await Promise.all([artLoaded(hole), artLoaded(surface)]);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/dst/data/anim/cave_hole.zip'));
    expect(hole.sprite.currentAnimation).toBe('idle');
    expect(s.registry.exportRecords().cave_hole).toEqual([record]);
    hole.remove();
    expect(surface.isRemoved).toBe(true);
  } finally { s.dispose(); }
});

it('blocks spheres at both walls, leaves the centre hollow and lets a soul hop land there', () => {
  const world = new CANNON.World(), s = setup(world);
  try {
    const hole = s.prefabs.spawn(CAVE_HOLE_ID, new THREE.Vector3(0, 0, 0)) as CaveHoleInstance;
    expect(hole.physicsBody!.shapes).toEqual([expect.any(CANNON.Trimesh)]);
    // The planners read the mesh as one obstacle; a walk target at the centre is never offered.
    expect(staticObstacleTest([hole.physicsBody!], 0)(new THREE.Vector3(0, 0, 0))).toBe(true);
    expect(staticObstacleTest([hole.physicsBody!], 0)(new THREE.Vector3(9, 0, 0))).toBe(false);

    // wortox.lua CanBlinkTo at world scale 3: the centre and beyond the outer wall are open, the ring between is not.
    const blockers = placementEntities(s.scene), blocked = (x: number) => isGroundTargetBlocked(blockers, new THREE.Vector3(x, 0, 0), 1.5);
    expect([0, 4.4, 4.5, 8.2, 8.25].map(blocked)).toEqual([false, false, true, true, false]);
    // A hit on the hole would leave no ground point for BLINK; the same model is a target whenever it is enabled.
    const { model } = hole.transform;
    expect(isMouseTarget(model)).toBe(false);
    setMouseTargetEnabled(model, true);
    expect(isMouseTarget(model)).toBe(true);
    setMouseTargetEnabled(model, false);

    const player = { physics: new PhysicsState() }, position = new THREE.Vector3(-15, 0, 0), radius = 1.5;
    MakeCharacterPhysics(player, 75, .5);
    const binding = bindPhysics(world, player.physics, () => position), body = binding.body!;
    const runX = (speed: number, steps = 120) => {
      for (let step = 0; step < steps; step++) { body.velocity.set(speed, 0, 0); world.step(1 / 60); }
      return body.position.x;
    };
    const teleport = (x: number) => { position.x = x; player.physics.Teleport(); body.velocity.set(0, 0, 0); };
    // Along +x each wall presents the middle of a face: 16 segments around the outer radius, 8 around the inner.
    const outerFace = 8.25 * Math.cos(Math.PI / 16), innerFace = 4.5 * Math.cos(Math.PI / 8);
    expect(runX(18)).toBeLessThanOrEqual(-outerFace - radius + .15); // Stopped outside the outer wall.
    teleport(0);
    expect(runX(0, 30)).toBeCloseTo(0); // Landing at the centre touches nothing.
    expect(runX(18)).toBeLessThanOrEqual(innerFace - radius + .15); // Walled in from inside.
    teleport(4);
    expect(runX(0)).toBeLessThanOrEqual(innerFace - radius + .15); // A landing against the inner wall is pushed inwards, not through it.
    binding.dispose();
  } finally { s.dispose(); }
});

it('sleeping releases both layers and waking rebuilds their declared clip and hidden layer', async () => {
  const s = setup();
  try {
    const hole = s.prefabs.spawn(CAVE_HOLE_ID, new THREE.Vector3(3, 0, 6), record) as CaveHoleInstance, surface = s.surface();
    await Promise.all([artLoaded(hole), artLoaded(surface)]);
    const before = s.registry.exportRecords();
    s.awake.set(false); await turn();
    for (const inst of [hole, surface]) { expect(inst.status.peek()).toBe('asleep'); expect(inst.sprite.loaded).toBe(false); }
    s.awake.set(true); await turn();
    await Promise.all([artLoaded(hole), artLoaded(surface)]);
    for (const [inst, hidden] of [[hole, 'surface'], [surface, 'hole']] as const) {
      expect(inst.sprite.loaded).toBe(true);
      expect(inst.sprite.currentAnimation).toBe('idle');
      expect(inst.sprite.sprite.peek().appearance.get(`layer:${hidden}`)).toMatchObject({ hidden: true });
    }
    expect(s.registry.exportRecords()).toEqual(before);
  } finally { s.dispose(); }
});

it('c_spawn, c_save and reload keep the id, position, allowspawn and clip, and c_give is refused', async () => {
  const first = setup(); let zip!: Uint8Array, records!: ReturnType<EntityRegistry['exportRecords']>;
  try {
    expect((await executeDebugCommand('c_spawn("cave_hole")', first.inventory, id => first.registry.spawn(id))).ok).toBe(true);
    expect((await executeDebugCommand('c_give("cave_hole")', first.inventory)).ok).toBe(false);
    records = first.registry.exportRecords();
    expect(records.cave_hole).toHaveLength(1);
    expect(records.cave_hole[0].components).toEqual({ allowspawn: true });
    expect(records.cave_hole_surface).toBeUndefined();
    expect((await executeDebugCommand('c_save()', first.inventory, undefined, async () => {
      zip = await createClusterSaveZip(first.save(), 'forest');
    })).ok).toBe(true);
  } finally { first.dispose(); }
  const files = unzipSync(zip), text = strFromU8(files['Cluster_1/Master.json']);
  const exported = JSON.parse(text) as { session: { playerFile: string } };
  const { player } = JSON.parse(strFromU8(files[`Cluster_1/${exported.session.playerFile}`])) as { player: unknown };
  const saved = deserializeSave(text, SAVE_CATALOG, player), second = setup();
  try {
    expect(saved.world.entities).toEqual(records);
    await second.registry.restoreAll(saved.world.entities);
    const hole = second.hole();
    expect(hole.entityId).toBe(records.cave_hole[0].id);
    expect(hole.position.toArray()).toEqual([12, 0, -6]);
    expect(hole.allowspawn).toBe(true);
    expect(hole.sprite.sprite.peek().clip).toMatchObject({ name: 'idle', loop: false });
    await artLoaded(hole);
    expect(hole.sprite.currentAnimation).toBe('idle');
    expect(second.registry.exportRecords()).toEqual(records);
  } finally { second.dispose(); }
}, CLUSTER_SAVE_ZIP_TIMEOUT);
