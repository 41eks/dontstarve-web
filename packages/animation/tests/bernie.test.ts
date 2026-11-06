import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { ItemEntity } from '../../inventory/src/entity';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { BERNIE_ACTIVE_ID, BERNIE_BIG_ID, BERNIE_ITEM_ID, berniePrefabs, type BernieInstance, type BerniePlayer, type BernieWorld } from '../../prefab/src/bernie';
import { GroundPrefabRegistry } from '../../prefab/src/groundPrefabRegistry';
import { GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { WORLD_SCALE } from '../../prefab/src/standardcomponents';
import { animationTiming } from '../../prefab/src/animationTimings';
import { EntityRegistry } from '../../../src/entityRegistry';
import { PREFAB_DEFINITIONS } from '../../../src/prefabDefinitions';
import { executeDebugCommand } from '../../../src/debugCommands';
import { serializeSave } from '../../../src/save/serialize';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };

beforeEach(() => {
  // The brains' PriorityNodes scatter their first evaluation with math.random().
  vi.spyOn(Math, 'random').mockReturnValue(0);
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const length = (archive: string, name: string) => { const clip = animationTiming(archive, name); return clip.frames / clip.frameRate; };

function setup() {
  const scheduler = new GameTimeScheduler(), displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', {});
  let crazy = true;
  const tags = new Set(['player']), position = new THREE.Vector3(2, 0, 0);
  const player: BerniePlayer = {
    position,
    hasTag: tag => tags.has(tag),
    components: { sanity: { IsCrazy: () => crazy, GetPercent: () => crazy ? .1 : 1 } },
    IsVisible: () => true,
  };
  const inactive: ItemEntity[] = [];
  const world: BernieWorld = {
    scheduler,
    getPlayers: () => [player],
    spawnPrefab: (prefab, position, skinId) => prefabs.spawn(prefab, position, undefined, skinId),
    spawnInactive: (position, skinId) => {
      const item = new ItemEntity({ itemId: BERNIE_ITEM_ID, count: 1, skinId });
      item.setPosition(position.x, 0, position.z);
      inactive.push(item);
      return item;
    },
  };
  prefabs.register(berniePrefabs(world));
  const registry = new EntityRegistry([], prefabs, () => position);
  registry.registerPrefabs(PREFAB_DEFINITIONS.bernies);
  const records = () => prefabs.exportRecords();
  /** The live Bernie of that prefab, as Ents holds it. */
  const live = (id: string) => prefabs.get(records().find(({ prefabId }) => prefabId === id)!.record.id) as BernieInstance;
  return { scheduler, prefabs, registry, world, player, position, tags, inactive, live,
    bernies: () => records().map(({ prefabId }) => prefabId),
    setCrazy: (value: boolean) => { crazy = value; },
    dispose: () => { registry.dispose(); prefabs.dispose(); displays.dispose(); scheduler.dispose(); } };
}

it('reanimates the item on the ground near a crazy, visible player, carrying its skin to bernie_active', () => {
  const s = setup();
  const ground = new GroundPrefabRegistry({ scene: new THREE.Scene(), animationBaseUrl: '/dst/data/anim', scheduler: s.scheduler,
    bernieWorld: s.world, butterflyWorld: { getThreatPositions: () => [], getFlowers: () => [] }, firefliesWorld: {} });
  const item = new ItemEntity({ itemId: BERNIE_ITEM_ID, count: 1, skinId: 'bernie_cat' });
  item.setPosition(0, 0, 0);
  const visual = ground.get(BERNIE_ITEM_ID)!.create({ ...GROUND_ITEM_DEFINITIONS[BERNIE_ITEM_ID], itemId: BERNIE_ITEM_ID, count: 1, skinId: 'bernie_cat' }, item);
  try {
    expect(item.sprite.currentAnimation).toBe('inactive');
    // A sane player, or one beyond 16 units, leaves it lying; tryreanimate runs once a second.
    s.setCrazy(false);
    s.scheduler.advance(2);
    expect(s.bernies()).toEqual([]);
    s.setCrazy(true);
    s.position.set(17 * WORLD_SCALE, 0, 0);
    s.scheduler.advance(1);
    expect(s.bernies()).toEqual([]);
    // Held, it stops trying (topocket); dropped, it tries again a second later (toground).
    s.position.set(2, 0, 0);
    item.PushEvent('onputininventory', undefined);
    s.scheduler.advance(2);
    expect(s.bernies()).toEqual([]);
    item.PushEvent('ondropped', undefined);
    s.scheduler.advance(.99);
    expect(s.bernies()).toEqual([]);
    s.scheduler.advance(.01);
    expect(s.bernies()).toEqual([BERNIE_ACTIVE_ID]);
    expect(item.isRemoved).toBe(true);
    const active = s.live(BERNIE_ACTIVE_ID);
    expect(active.skinId).toBe('bernie_cat_active');
    expect(active.position.toArray()).toEqual([0, 0, 0]);
    expect(['smallcreature', 'companion', 'soulless'].every(tag => active.hasTag(tag))).toBe(true);
  } finally { visual.dispose(); ground.dispose(); s.dispose(); }
});

it('runs SGbernie: activates, idles, and sits back down as the item once no crazy player is near', () => {
  const s = setup();
  try {
    const active = s.prefabs.spawn(BERNIE_ACTIVE_ID, new THREE.Vector3(1, 0, 1), undefined, 'bernie_dog_active') as BernieInstance;
    expect(active.sg.stateName).toBe('activate');
    expect(active.sprite.currentAnimation).toBe('activate');
    // The crazy player keeps it up; without a Willow it never goes big.
    s.scheduler.advance(length('bernie.zip', 'activate'));
    expect(active.sg.stateName).toBe('idle_nodir');
    s.scheduler.advance(.5);
    expect(active.sprite.currentAnimation).toBe('idle_loop');
    s.scheduler.advance(length('bernie.zip', 'idle_loop_nodir') - .5);
    expect(active.sg.stateName).toBe('idle');
    // The player recovers: the next brain update sends Bernie to deactivate, whose animover leaves the item behind.
    s.setCrazy(false);
    s.scheduler.advance(1);
    expect(active.sg.stateName).toBe('deactivate');
    s.scheduler.advance(length('bernie.zip', 'deactivate'));
    expect(active.isRemoved).toBe(true);
    expect(s.inactive.map(item => [item.skinId, item.position.toArray()])).toEqual([['bernie_dog', [1, 0, 1]]]);
  } finally { s.dispose(); }
});

it('grows next to a crazy Willow, and the big Bernie deactivates straight back to the item once she recovers', () => {
  const s = setup();
  try {
    s.tags.add('bernieowner');
    const active = s.prefabs.spawn(BERNIE_ACTIVE_ID, new THREE.Vector3(1, 0, 0)) as BernieInstance;
    active.components.health.SetPercent(.5);
    // Busy while activating; the brain's first PriorityNode evaluation (scattered to 1.5 seconds) then goes big.
    s.scheduler.advance(1.5);
    expect(active.isRemoved).toBe(false);
    s.scheduler.advance(.1);
    expect(active.isRemoved).toBe(true);
    const big = s.live(BERNIE_BIG_ID);
    expect(big.components.health.GetPercent()).toBe(.5);
    expect(s.player.bigbernies).toEqual(new Set([big]));
    expect(big.bernieleader).toBe(s.player);
    expect(['largecreature', 'crazy', 'bigbernie'].every(tag => big.hasTag(tag))).toBe(true);
    expect(big.sg.stateName).toBe('activate');
    s.scheduler.advance(length('bernie_big.zip', 'activate') + .5);
    expect(big.sprite.currentAnimation).toBe('idle_loop');

    // Once Willow recovers, berniebigbrain waits out MIN_ACTIVE_TIME, then deactivates without returning to bernie_active.
    s.setCrazy(false);
    for (let step = 0; step < 50 && big.sg.stateName !== 'deactivate'; step++) s.scheduler.advance(.1);
    expect(big.sg.stateName).toBe('deactivate');
    expect(big.GetTimeAlive()).toBeGreaterThanOrEqual(4);
    expect(big.GetTimeAlive()).toBeLessThan(4.2);
    expect(big.components.health.IsInvincible()).toBe(true);
    s.scheduler.advance(length('bernie_big.zip', 'deactivate'));
    expect(big.sprite.currentAnimation).toBe('deactivate_pst');
    s.scheduler.advance(length('bernie_big.zip', 'deactivate_pst'));
    expect(big.isRemoved).toBe(true);
    expect(s.player.bigbernies).toBeUndefined();
    expect(s.inactive).toHaveLength(1);
  } finally { s.dispose(); }
});

it('spawns both forms with c_spawn and saves and reloads their health, a loaded big Bernie standing idle', async () => {
  const s = setup(), restored = setup();
  try {
    expect((await executeDebugCommand('c_spawn("bernie_active");c_spawn("bernie_big")', {} as never, id => s.registry.spawn(id))).ok).toBe(true);
    s.live(BERNIE_BIG_ID).components.health.SetPercent(.25);
    let json = '';
    const saved = await executeDebugCommand('c_save()', {} as never, undefined, () => {
      json = serializeSave(deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG), { entities: s.registry.exportRecords(),
        elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 }, inventory: { slots: [], bufferedBuilds: [] } }, SAVE_CATALOG);
    });
    expect(saved, saved.message).toMatchObject({ ok: true });
    const { entities } = deserializeSave(json, SAVE_CATALOG).world;
    expect(entities.bernie_active).toHaveLength(1);
    const [record] = entities.bernie_big!;
    expect(record.components.health).toEqual({ current: 500, maximum: 2000 });
    const reloaded = restored.prefabs.spawn(BERNIE_BIG_ID, new THREE.Vector3(...record.transform.position), record) as BernieInstance;
    expect(reloaded.components.health.currenthealth).toBe(500);
    expect(reloaded.sg.stateName).toBe('idle');
  } finally { s.dispose(); restored.dispose(); }
});
