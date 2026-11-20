import { createTestWorldSources } from './worldContentFixture';
import { readFile } from 'node:fs/promises';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIGHTNING_GOAT_BUILD, LIGHTNING_GOAT_HEALTH, LIGHTNING_GOAT_SHOCKED_BUILD, LightningGoatInstance, lightningGoatPrefabs,
  type LightningGoatWorld } from '../../prefab/src/lightninggoat';
import { SendLightningStrike } from '../../prefab/src/lightning';
import { createSignal, getWatchWorldContent, type WorldPhase, type WorldContentEnvironment } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentUpdates } from '../../componets/src/componentUpdates';
import { PrefabEntityManager, PrefabInstance } from '../../prefab/src/prefabInstance';
import { PrefabDisplayGroup, SpriteState } from '../../display/src';
import { Pathfinder } from '../../prefab/src/pathfinder';
import type { EntitySaveRecord } from '../../prefab/src/saveRecord';
import initialWorld from '../../../public/saves/initial-world.json' with { type: 'json' };
import { SAVE_CATALOG } from '../../../src/save/catalog';
import { deserializeSave } from '../../../src/save/deserialize';
import { serializeSave } from '../../../src/save/serialize';
import { createInventoryStore } from './testInventory';

vi.mock('../../prefab/src/sound', async importOriginal => ({ ...await importOriginal<object>(), PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => false })) }));

const OPEN_GROUND = { isPassableAtPoint: () => true, isOceanAtWorld: () => false };
const DAY = 480;
const UNIT = 3;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** lightninggoat as the application wires it: its world services, the shared PrefabEntityManager and component updates. */
function setup(random: () => number = () => 0) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    new Response(await readFile(new URL(`../../../public/dst/data/anim/${url.split('/').at(-1)}`, import.meta.url)))));
  const scheduler = new GameTimeScheduler(), componentUpdates = new ComponentUpdates();
  const clock = createSignal<{ phase: WorldPhase }>({ phase: 'day' }), cycle = createSignal<WorldPhase>('day');
  const sources: WorldContentEnvironment = { ...createTestWorldSources(scheduler), playerpositions: createSignal<THREE.Vector3[]>([]),
    snowLevel: createSignal(0), wind: createSignal({ angle: 0, velocity: 1 }), perishTick: createSignal({ time: 0, total: 0 }), scheduler,
    temperature: createSignal(30), cycle, season: createSignal({ season: 'spring', progress: .5 }) };
  const world: LightningGoatWorld = { scheduler, componentUpdates, clock, random,
    getWatchWorldContent: (key, register) => getWatchWorldContent(key, register, sources),
    secondsUntilNextDay: now => DAY - now % DAY, pathfinder: new Pathfinder(OPEN_GROUND), isWalkable: () => true,
    constrainPosition: vi.fn(), spawnLoot: vi.fn() };
  const physics = new CANNON.World(), displays = new PrefabDisplayGroup(new THREE.Scene());
  const prefabs = new PrefabEntityManager<string, PrefabInstance>(displays, '/dst/data/anim', { physics }, lightningGoatPrefabs(world));
  const inst = prefabs.spawnAs(LightningGoatInstance, 'lightninggoat', new THREE.Vector3());
  const body = inst.physicsBody!;
  return { world, prefabs, scheduler, inst,
    /** AnimState:SetBuild and AnimState:Show/Hide("fx") as the entity declares them to its display. */
    build: () => { const build = inst.sprite.sprite.peek().appearance.get('archive-build'); return build?.kind === 'archive-build' ? build.archive : undefined; },
    fxShown: () => { const layer = inst.sprite.sprite.peek().appearance.get('layer:fx'); return layer?.kind === 'layer' && !layer.hidden; },
    record: () => prefabs.exportRecords().find(({ record }) => record.id === inst.entityId)!.record,
    restore: (record: EntitySaveRecord) => prefabs.restore('lightninggoat', record) as LightningGoatInstance,
    strike: (position: THREE.Vector3) => SendLightningStrike({ root: new THREE.Scene(), sim: prefabs, fx: { spawn: vi.fn() } }, position),
    endDay: () => { scheduler.advance(world.secondsUntilNextDay(scheduler.now)); },
    tick: (seconds: number) => {
      for (let i = 0; i < Math.round(seconds * 10); i++) {
        scheduler.advance(0.1);
        body.position.x += body.velocity.x * 0.1;
        body.position.z += body.velocity.z * 0.1;
        componentUpdates.update(0.1);
      }
    },
    addPlayer: (position: THREE.Vector3) => {
      const player = new PrefabInstance('wilson', new SpriteState({ name: 'idle_loop', billboard: true }));
      for (const tag of ['player', 'character']) player.addTag(tag);
      player.setPosition(position.x, position.y, position.z); prefabs.track(player);
      return player;
    },
    dispose: () => { prefabs.dispose(); displays.dispose(); scheduler.dispose(); },
  };
}

describe('lightninggoat', () => {
  it('is an uncharged lightning rod that grazes and bleats on the source idle timeout', () => {
    const s = setup();
    try {
      expect(['lightninggoat', 'animal', 'lightningrod', 'herdmember', 'saltlicker', 'locomotor'].every(tag => s.inst.hasTag(tag))).toBe(true);
      expect(s.inst.hasTag('charged')).toBe(false);
      expect([s.inst.components.health.maxhealth, s.inst.components.herdmember.herdprefab]).toEqual([LIGHTNING_GOAT_HEALTH, 'lightninggoatherd']);
      expect([s.build(), s.fxShown(), s.inst.light.peek(), s.inst.stategraph.stateName]).toEqual([undefined, false, undefined, 'idle']);
      // idle: SetTimeout(math.random() * 4 + 2) → bleet, with the brain stopped so Wander does not start a walk.
      s.inst.brain?.Stop();
      s.tick(2.1);
      expect(s.inst.stategraph.stateName).toBe('bleet');
    } finally { s.dispose(); }
  });

  it('is charged by a lightning strike it draws, and discharges after three day boundaries', () => {
    const s = setup();
    try {
      // weather.lua: the nearest lightningrod within 40 draws the strike and receives "lightningstrike".
      expect(s.strike(new THREE.Vector3(30 * UNIT, 0, 0)).x).toBe(0);
      expect(s.inst.stategraph.stateName).toBe('shocked');
      expect(['charged', 'electricdamageimmune'].every(tag => s.inst.hasTag(tag))).toBe(true);
      expect([s.build(), s.fxShown(), !!s.inst.light.peek(), s.inst.components.electricattacks?.HasSources()])
        .toEqual([LIGHTNING_GOAT_SHOCKED_BUILD, true, true, true]);
      expect(s.inst.components.inspectable.getstatus?.()).toBe('CHARGED');
      expect(s.record().components.lightninggoat).toEqual({ charged: true, chargeleft: 3 });
      s.endDay(); s.endDay();
      expect([s.inst.charged, s.inst.chargeleft]).toEqual([true, 1]);
      s.endDay();
      expect([s.inst.charged, s.inst.chargeleft, s.inst.light.peek(), s.inst.stategraph.stateName]).toEqual([false, undefined, undefined, 'discharge']);
      expect(s.inst.hasTag('charged') || s.inst.components.electricattacks !== undefined).toBe(false);
      // discharge's frame 18 restores the plain build and hides the fx layer.
      expect(s.build()).toBe(LIGHTNING_GOAT_SHOCKED_BUILD);
      s.tick(.7);
      expect([s.build(), s.fxShown()]).toEqual([LIGHTNING_GOAT_BUILD, false]);
      expect(s.record().components.lightninggoat).toBeUndefined();
    } finally { s.dispose(); }
  });

  it('saves its health, herd location and charge through c_save, and loads a charge without the shocked state', () => {
    const s = setup();
    try {
      s.inst.components.health.SetVal(460);
      s.inst.components.knownlocations.RememberLocation('herd', new THREE.Vector3(30, 0, 60));
      s.strike(s.inst.position.clone());
      s.endDay();
      const template = deserializeSave(JSON.stringify(initialWorld), SAVE_CATALOG);
      const json = serializeSave(template, { entities: { lightninggoat: [s.record()] } as never, inventory: createInventoryStore([]).exportSaved(),
        elapsedSeconds: 0, playerTransform: { position: [0, 0, 0], rotationY: 0 } }, SAVE_CATALOG);
      const [saved] = deserializeSave(json, SAVE_CATALOG).world.entities.lightninggoat;
      expect(saved.components).toMatchObject({ health: { health: 460, maxhealth: LIGHTNING_GOAT_HEALTH },
        lightninggoat: { charged: true, chargeleft: 2 } });
      const restored = s.restore({ ...saved, id: 'restored' });
      expect([restored.charged, restored.chargeleft, restored.components.health.currenthealth]).toEqual([true, 2, 460]);
      expect(restored.components.knownlocations.GetLocation('herd')).toMatchObject({ x: 30, z: 60 });
      expect(restored.stategraph.stateName).toBe('idle');
      expect(!!restored.light.peek()).toBe(true);
    } finally { s.dispose(); }
  });

  it('faces a player within 10 units and then runs from it', () => {
    const s = setup();
    try {
      const player = s.addPlayer(new THREE.Vector3(5 * UNIT, 0, 0));
      s.tick(1);
      expect(s.inst.sg?.hasStateTag('moving') || s.inst.stategraph.stateName === 'idle').toBe(true);
      s.tick(6);
      expect(s.inst.position.distanceTo(player.position)).toBeGreaterThan(8 * UNIT);
    } finally { s.dispose(); }
  });
});
