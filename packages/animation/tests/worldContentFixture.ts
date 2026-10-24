import { bindWorldContent, createSignal, type SeasonState } from '../../signals/src';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

/** Binds season/snowLevel world content so managers resolve them through getWatchWorldContent. */
export function bindTestWorld(scheduler: GameTimeScheduler) {
  const season = createSignal<SeasonState>({ season: 'autumn', progress: 0 });
  const snowLevel = createSignal(0);
  const unbind = bindWorldContent({
    scheduler, season, snowLevel, cycle: createSignal('day'), temperature: createSignal(20),
    wind: createSignal({ angle: 0, velocity: 0 }), perishTick: createSignal({ time: 0, total: 0 }),
  });
  return { season, snowLevel, unbind };
}

/** The bound world owns game time, so a frame advances the scheduler before the manager samples it. */
export function tickWorld(scheduler: GameTimeScheduler, manager: { update(dt: number, quaternion: import('three').Quaternion): void },
  dt: number, quaternion: import('three').Quaternion): void {
  scheduler.advance(dt); manager.update(dt, quaternion);
}
