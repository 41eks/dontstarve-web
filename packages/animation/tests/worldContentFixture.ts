import { bindWorldContent, createSignal, getWatchWorldContent, type GetWatchWorldContent, type WorldContentEnvironment, type SeasonState, type WorldPhase, type WorldMoonState } from '../../signals/src';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

/** Bind representative world sources and provide a getter that stays with this world. */
export function bindTestWorld(scheduler: GameTimeScheduler) {
  const season = createSignal<SeasonState>({ season: 'autumn', progress: 0 });
  const snowLevel = createSignal(0);
  const cycle = createSignal<WorldPhase>('day');
  const moon = createSignal<WorldMoonState>({ phase: 'new', waxing: true });
  const playerpositions = createSignal<import('three').Vector3[]>([]);
  const sources = {
    scheduler, season, snowLevel, cycle, moon, playerpositions, temperature: createSignal(20),
    wind: createSignal({ angle: 0, velocity: 0 }), perishTick: createSignal({ time: 0, total: 0 }),
  } satisfies WorldContentEnvironment;
  const unbind = bindWorldContent(sources);
  const getContent: GetWatchWorldContent = (key, registerCleanup) => getWatchWorldContent(key, registerCleanup, sources);
  return { season, snowLevel, cycle, moon, playerpositions, getWatchWorldContent: getContent, unbind };
}

/** The bound world owns game time, so a frame advances the scheduler before the manager samples it. */
export function tickWorld(scheduler: GameTimeScheduler, manager: { update(dt: number, quaternion: import('three').Quaternion): void },
  dt: number, quaternion: import('three').Quaternion): void {
  scheduler.advance(dt); manager.update(dt, quaternion);
}
