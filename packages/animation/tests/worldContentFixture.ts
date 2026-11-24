import { Quaternion } from 'three';
import {
  bindWorldContent,
  createIdleWeatherSources,
  createMemo,
  createSignal,
  getWatchWorldContent,
  type GetWatchWorldContent,
  type WorldContentEnvironment,
  type SeasonState,
  type WorldPhase,
  type WorldNightmarePhase,
  type WorldMoonState,
} from '../../signals/src';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { Object3D } from 'three';
import { prefabDisplay } from '../../display/src/prefabDisplay';
import { prefabInstance, type PrefabInstance } from '../../prefab/src/prefabInstance';
import type { Pickable } from '../../prefab/src/components/pickable';
import type { Burnable } from '../../componets/src/burnable';
import type { Propagator } from '../../componets/src/propagator';
import type { LootDropper } from '../../componets/src/lootdropper';
import type { Witherable } from '../../componets/src/witherable';
import type { Growable } from '../../componets/src/growable';
import type { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';

/** A pickable plant prefab's inst as these tests reach it: the components every one adds, and those only some add. */
export type TestPlantInstance = PrefabInstance & {
  readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
    lootdropper?: LootDropper;
    witherable?: Witherable;
    growable?: Growable;
    simplemagicgrower?: SimpleMagicGrower;
  };
};

export function plantInstance(model: Object3D): TestPlantInstance {
  const instance = prefabInstance(model);
  // A burnt plant has lost its components but is still the plant's inst, so only the inst itself is checked.
  if (!instance) {
    throw new Error(`No inst for ${model.name}`);
  }
  return instance as TestPlantInstance;
}

/** Complete world inputs shared by standalone component fixtures. */
export function createTestWorldSources(scheduler: GameTimeScheduler) {
  const season = createSignal<SeasonState>({ season: 'autumn', progress: 0 });
  const snowLevel = createSignal(0);
  const cycle = createSignal<WorldPhase>('day');
  const moon = createSignal<WorldMoonState>({ phase: 'new', waxing: true });
  const playerpositions = createSignal<import('three').Vector3[]>([]);
  const camerarotation = createSignal(new Quaternion());
  return {
    scheduler,
    season,
    snowLevel,
    cycle,
    nightmarephase: createSignal<WorldNightmarePhase>('none'),
    moon,
    playerpositions,
    camerarotation,
    temperature: createSignal(20),
    wind: createSignal({ angle: 0, velocity: 0 }),
    perishTick: createSignal({ time: 0, total: 0 }),
    ...createIdleWeatherSources(),
    // Weather.snowCovered: weather.lua SNOW_COVERED_THRESHOLD over the level these tests set.
    snowCovered: createMemo(() => snowLevel.get() >= 0.015),
    // worldstate.lua isacidraining, which tests set as a cave weather would.
    isacidraining: createSignal(false),
  } satisfies WorldContentEnvironment;
}

/** Bind representative world sources and provide a getter that stays with this world. */
export function bindTestWorld(scheduler: GameTimeScheduler, tickingarea?: WorldContentEnvironment['tickingarea']) {
  const sources = { ...createTestWorldSources(scheduler), tickingarea };
  const { season, snowLevel, cycle, moon, playerpositions, camerarotation, isacidraining } = sources;
  const release = bindWorldContent(sources);
  boundCamera = camerarotation;
  const unbind = () => {
    if (boundCamera === camerarotation) {
      boundCamera = undefined;
    }
    release();
  };
  const getContent: GetWatchWorldContent = (key, registerCleanup, options) =>
    getWatchWorldContent(key, registerCleanup, sources, options);
  return {
    season,
    snowLevel,
    cycle,
    moon,
    playerpositions,
    camerarotation,
    isacidraining,
    getWatchWorldContent: getContent,
    tickingarea,
    unbind,
  };
}

let boundCamera: ReturnType<typeof createTestWorldSources>['camerarotation'] | undefined;

/**
 * The scene's publishCameraRotation for a test frame: the bound world's camera takes the rotation when it differs, and
 * the billboards following it turn. Without a bound world there is no camera to turn, as in a standalone game context.
 */
export function publishTestCamera(rotation: Quaternion): void {
  if (boundCamera && !boundCamera.peek().equals(rotation)) {
    boundCamera.set(rotation.clone());
  }
}

/**
 * Bind a world for a test that only turns its camera: displays created after this face the rotation `turn` publishes,
 * as the scene publishes TheCamera's rotation when it turns.
 */
export function bindTestCamera() {
  const world = bindTestWorld(new GameTimeScheduler());
  return {
    turn: (rotation: Quaternion) => {
      world.camerarotation.set(rotation.clone());
    },
    unbind: world.unbind,
  };
}

/** The bound world owns game time, so a frame advances the scheduler before the manager samples it. */
export function tickWorld(
  scheduler: GameTimeScheduler,
  displays: { update(dt: number): void },
  dt: number,
  quaternion: import('three').Quaternion,
): void {
  scheduler.advance(dt);
  publishTestCamera(quaternion);
  displays.update(dt);
}

/** A spawned entity exists at once; a test that inspects its drawn clips first lets its display load the art. */
export async function drawn<T extends Object3D>(model: T | Promise<T>): Promise<T> {
  const entity = await model;
  await prefabDisplay(entity)?.artLoaded();
  return entity;
}
