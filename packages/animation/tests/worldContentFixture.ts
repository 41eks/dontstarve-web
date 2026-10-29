import { Quaternion } from 'three';
import { bindWorldContent, createIdleWeatherSources, createSignal, getWatchWorldContent, type GetWatchWorldContent, type WorldContentEnvironment, type SeasonState, type WorldPhase, type WorldMoonState } from '../../signals/src';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { Object3D } from 'three';
import { prefabDisplay } from '../../display/src/prefabDisplay';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { PickablePlantInstance } from '../../prefab/src/pickablePlant';

export function plantInstance(model: Object3D): PickablePlantInstance {
  const instance = prefabInstance(model);
  if (!(instance instanceof PickablePlantInstance)) throw new Error(`Not a pickable plant: ${model.name}`);
  return instance;
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
    scheduler, season, snowLevel, cycle, moon, playerpositions, camerarotation, temperature: createSignal(20),
    wind: createSignal({ angle: 0, velocity: 0 }), perishTick: createSignal({ time: 0, total: 0 }),
    ...createIdleWeatherSources(),
  } satisfies WorldContentEnvironment;
}

/** Bind representative world sources and provide a getter that stays with this world. */
export function bindTestWorld(scheduler: GameTimeScheduler, tickingarea?: WorldContentEnvironment['tickingarea']) {
  const sources = { ...createTestWorldSources(scheduler), tickingarea };
  const { season, snowLevel, cycle, moon, playerpositions, camerarotation } = sources;
  const unbind = bindWorldContent(sources);
  const getContent: GetWatchWorldContent = (key, registerCleanup, options) => getWatchWorldContent(key, registerCleanup, sources, options);
  return { season, snowLevel, cycle, moon, playerpositions, camerarotation, getWatchWorldContent: getContent, unbind };
}

/** The bound world owns game time, so a frame advances the scheduler before the manager samples it. */
export function tickWorld(scheduler: GameTimeScheduler, manager: { update(dt: number, quaternion: import('three').Quaternion): void },
  dt: number, quaternion: import('three').Quaternion): void {
  scheduler.advance(dt); manager.update(dt, quaternion);
}

/** A spawned entity exists at once; a test that inspects its drawn clips first lets its display load the art. */
export async function drawn<T extends Object3D>(model: T | Promise<T>): Promise<T> {
  const entity = await model;
  await prefabDisplay(entity)?.artLoaded();
  return entity;
}
