import type * as THREE from 'three';
import { createEffect, watchSignal, WorldContentKey, type WorldPhase } from '@dontstarve-web/signals';
import { PlaySound } from './sound';
import { PickablePlantManager, type PickablePlantBehavior, type PickablePlantBehaviorContext,
  type PickablePlantDefinition, type PickablePlantRecord } from './pickablePlant';

export const BLUE_MUSHROOM_ID = 'blue_mushroom' as const;
export const RED_MUSHROOM_ID = 'red_mushroom' as const;
export const GREEN_MUSHROOM_ID = 'green_mushroom' as const;
export const MUSHROOM_PLANT_IDS = [RED_MUSHROOM_ID, GREEN_MUSHROOM_ID, BLUE_MUSHROOM_ID] as const;
export type MushroomPlantId = typeof MUSHROOM_PLANT_IDS[number];
/** tuning.lua SEG_TIME. */
const SEG_TIME = 30;

/** mushrooms.lua data entries: the colour, picked cap and the cave phase in which the mushroom is open. */
interface MushroomData { readonly animname: string; readonly pickloot: string; readonly openTime: WorldPhase }
const MUSHROOM_DATA: Record<MushroomPlantId, MushroomData> = {
  red_mushroom: { animname: 'red', pickloot: 'red_cap', openTime: 'day' },
  green_mushroom: { animname: 'green', pickloot: 'green_cap', openTime: 'dusk' },
  blue_mushroom: { animname: 'blue', pickloot: 'blue_cap', openTime: 'night' },
};

/**
 * mushrooms.lua mushcommonfn: opens in its cave phase (3–9 seconds after the change) and closes otherwise, and a picked
 * mushroom regrows after `rain` rainy periods. The project has no separate cave clock yet, so the world phase is used.
 */
class MushroomPlant implements PickablePlantBehavior {
  private readonly context: PickablePlantBehaviorContext;
  private readonly data: MushroomData;
  private readonly cleanups: (() => void)[] = [];
  private growTask?: () => void;
  private periodicTask?: () => void;
  private readonly isOpenPhase: () => boolean;
  private rain = 0;

  constructor(context: PickablePlantBehaviorContext, data: MushroomData) {
    this.context = context; this.data = data;
    // The phase is watched through this mushroom's own tile key: outside the tickingarea it holds its last value.
    const tracker = context.instance.tileTracker;
    const cycle = context.getWatchWorldContent?.(WorldContentKey.Cycle, cleanup => this.cleanups.push(cleanup), { tile: tracker.tile });
    const rain = context.rain ? watchSignal(context.rain, cleanup => this.cleanups.push(cleanup)) : undefined;
    this.isOpenPhase = () => cycle?.peek() === data.openTime;
    // WatchWorldState("iscave"..open_time, OnIsOpenPhase): only changes notify, not the initial phase.
    if (cycle) {
      let previous: boolean | undefined;
      createEffect(() => {
        const open = cycle.get() === data.openTime;
        const changed = previous !== undefined && previous !== open;
        previous = open;
        if (changed) { if (open) this.open(); else this.close(); }
      });
    }
    // inst:DoPeriodicTask(SEG_TIME, checkregrow, SEG_TIME + math.random() * SEG_TIME)
    const check = () => {
      const { pickable } = this.context;
      if (!pickable.canBePicked && rain?.peek() === 'rain') {
        this.rain -= 1;
        if (this.rain <= 0) pickable.regen();
      }
      this.periodicTask = this.context.scheduler.schedule(SEG_TIME, check);
    };
    this.periodicTask = context.scheduler.schedule(SEG_TIME + Math.random() * SEG_TIME, check);
  }

  initialize(saved?: PickablePlantRecord): void {
    const { pickable, play } = this.context;
    // Construction picks the pose for the current phase; OnLoad then only sets rain and, when picked, the empty pose.
    if (this.isOpenPhase()) { pickable.canInteractWith = true; play([this.data.animname]); }
    else { pickable.canInteractWith = false; play(['inground']); }
    if (saved?.components.mushroom) this.rain = saved.components.mushroom.rain;
    if (saved?.components.pickable?.picked) play(['picked']);
  }

  private open(): void {
    if (!this.context.pickable.canBePicked) return;
    this.growTask?.();
    this.growTask = this.context.scheduler.schedule(3 + Math.random() * 6, () => this.openTask());
  }

  private close(): void {
    if (!this.context.pickable.canBePicked) return;
    this.growTask?.();
    this.growTask = this.context.scheduler.schedule(3 + Math.random() * 6, () => this.closeTask());
  }

  private openTask(): void {
    const { play, pickable, instance } = this.context;
    play(['open_inground', `open_${this.data.animname}`, this.data.animname]);
    PlaySound('dontstarve/common/mushroom_up', instance.position);
    this.growTask = undefined;
    pickable.canInteractWith = true;
  }

  private closeTask(): void {
    const { play, pickable } = this.context;
    play([`close_${this.data.animname}`, 'inground']);
    this.sinkSound();
    this.growTask = undefined;
    pickable.canInteractWith = false;
  }

  private sinkSound(): void {
    const task = this.context.scheduler.schedule(.25, () => { this.soundTasks.delete(task); PlaySound('dontstarve/common/mushroom_down', this.context.instance.position); });
    this.soundTasks.add(task);
  }
  private readonly soundTasks = new Set<() => void>();

  /** onpickedfn */
  picked(): void {
    this.growTask?.(); this.growTask = undefined;
    this.context.play(['picked']);
    this.rain = 10 + 1 + Math.floor(Math.random() * 10);
  }

  /** makeemptyfn */
  empty(): void { this.context.play(['picked']); }

  /** onregenfn: wait for the mushroom to become visible. */
  regen(): void {
    this.context.pickable.canInteractWith = false;
    if (this.isOpenPhase()) this.open();
    else { this.context.play(['inground']); this.sinkSound(); }
  }

  barren(): void {}
  burnt(): void {}

  exportState(): PickablePlantRecord['components'] { return this.rain > 0 ? { mushroom: { rain: this.rain } } : {}; }

  dispose(): void {
    this.growTask?.(); this.periodicTask?.();
    for (const task of this.soundTasks) task();
    this.soundTasks.clear();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}

function mushroomDefinition(prefab: MushroomPlantId): PickablePlantDefinition {
  const data = MUSHROOM_DATA[prefab];
  return {
    prefab, animArchive: 'mushrooms.zip', buildArchive: 'mushrooms.zip', tags: [], product: data.pickloot,
    archiveSprite: { bank: 'mushrooms', instancedAnimations: 'all' },
    noGrowInWinter: false, idle: { name: data.animname, loop: false }, picked: { clips: ['picked'] }, empty: { name: 'picked', frame: 'last' },
    grow: data.animname, dugLoot: data.pickloot, burnTime: 10, burnFxLevel: 2, propagatorSize: 'small',
    // workable finish: the unpicked mushroom drops its cap, then always one more.
    digLoot: (_model, pickable) => [...pickable.canBePicked ? [{ prefab: data.pickloot }] : [], { prefab: data.pickloot }],
    createBehavior: context => new MushroomPlant(context, data),
  };
}
const MUSHROOM_DEFINITIONS = Object.fromEntries(MUSHROOM_PLANT_IDS.map(id => [id, mushroomDefinition(id)])) as Record<MushroomPlantId, PickablePlantDefinition>;
export const BLUE_MUSHROOM_DEFINITION = MUSHROOM_DEFINITIONS[BLUE_MUSHROOM_ID];
export function isMushroomPlantPrefab(value: string): value is MushroomPlantId {
  return (MUSHROOM_PLANT_IDS as readonly string[]).includes(value);
}

/** mushrooms.lua: red (day), green (dusk) and blue (night) mushrooms share one prefab function. */
export class MushroomPlantManager extends PickablePlantManager {
  spawn(position: THREE.Vector3, saved?: PickablePlantRecord, prefab: MushroomPlantId = BLUE_MUSHROOM_ID): THREE.Group {
    return this.spawnPlant(MUSHROOM_DEFINITIONS[prefab], position, saved);
  }

  exportRecords(): { prefabId: MushroomPlantId; record: PickablePlantRecord }[] {
    return this.exportPlants().map(({ prefab, record }) => ({ prefabId: prefab as MushroomPlantId, record }));
  }
}
