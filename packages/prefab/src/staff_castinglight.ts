import { SpriteState, type PrefabDisplayGroup } from '@dontstarve-web/display';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabEntityManager, PrefabInstance } from './prefabInstance';
import { WORLD_SCALE } from './tile';

export const STAFF_CASTINGLIGHT_ID = 'staff_castinglight';
export const STAFF_CASTINGLIGHT_SMALL_ID = 'staff_castinglight_small';
export type StaffCastingLightId = typeof STAFF_CASTINGLIGHT_ID | typeof STAFF_CASTINGLIGHT_SMALL_ID;

const FRAMES = 1 / 30;

/** staff_castinglight.lua common_fn: a non-persistent FX entity with only a transform and a light; its caster does not carry it. */
export class StaffCastingLightInstance extends PrefabInstance {
  readonly is_small: boolean;
  private readonly scheduler: GameTimeScheduler;
  private readonly task: ComponentTimer;
  private colour: readonly [number, number, number] = [1, 1, 1];
  private _duration = 0;
  private _value = 0;
  private cancelRemoval?: () => void;

  constructor(prefab: StaffCastingLightId, is_small: boolean, scheduler: GameTimeScheduler) {
    super(prefab, new SpriteState({ name: '' }));
    this.is_small = is_small;
    this.scheduler = scheduler;
    this.addTag('FX');
    this.persists = false;
    this.task = new ComponentTimer(scheduler, () => this.OnUpdate());
    this.onRemove(() => { this.task.stop(); this.cancelRemoval?.(); });
  }

  /** SetUp(colour, duration, delay): DoPeriodicTask(FRAMES, OnUpdate, delay or 0), lit from now at its initial settings. */
  SetUp(colour: readonly [number, number, number], duration: number, delay = 0): void {
    this.colour = colour;
    this._duration = Math.floor(duration / FRAMES + .5);
    this.setLight(.3, .8, .9);
    this.task.start(delay);
  }

  private OnUpdate(): void {
    this._value += 1;
    if (this._value < this._duration) {
      const k = (this._value / this._duration) ** 5;
      if (this.is_small) this.setLight(.3 + 4 * k, .8 - .7 * k, 1.1 + .3 * k);
      else this.setLight(.3 + 10 * k, .8 - .6 * k, .9 - .4 * k);
      this.task.start(FRAMES);
    } else {
      this.light.set(null);
      this.cancelRemoval = this.scheduler.schedule(2 * FRAMES, () => this.remove());
    }
  }

  private setLight(radius: number, intensity: number, falloff: number): void {
    this.light.set({ radius: radius * WORLD_SCALE, intensity, falloff, colour: this.colour });
  }
}

/** The Prefab table staff_castinglight.lua returns; neither prefab has assets. */
export function createStaffCastingLightManager(displays: PrefabDisplayGroup,
  world: { readonly scheduler: GameTimeScheduler; readonly tickingarea?: TileStateQuery }) {
  return new PrefabEntityManager<StaffCastingLightId, StaffCastingLightInstance>(displays, undefined, world, {
    [STAFF_CASTINGLIGHT_ID]: { fn: () => new StaffCastingLightInstance(STAFF_CASTINGLIGHT_ID, false, world.scheduler) },
    [STAFF_CASTINGLIGHT_SMALL_ID]: { fn: () => new StaffCastingLightInstance(STAFF_CASTINGLIGHT_SMALL_ID, true, world.scheduler) },
  });
}
