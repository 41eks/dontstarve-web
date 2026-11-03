import type { PrefabEntityDefinition } from './prefabInstance';
import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn } from './standardcomponents';
import { createEffect, watchSignal, WorldContentKey, type WorldPhase } from '@dontstarve-web/signals';
import { PlaySound } from './sound';
import { plantEntityDefinition, PickablePlantInstance, type PickablePlantContext,
  type PickablePlantWorld, type PickablePlantDefinition, type PickablePlantRecord } from './pickablePlant';

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
export class MushroomPlantInstance extends PickablePlantInstance {
  private readonly data: MushroomData;
  private readonly cleanups: (() => void)[] = [];
  private growTask?: () => void;
  private periodicTask?: () => void;
  private readonly isOpenPhase: () => boolean;
  private rain = 0;

  constructor(prefab: MushroomPlantId, context: PickablePlantContext) {
    super(MUSHROOM_DEFINITIONS[prefab], context);
    const data = this.data = MUSHROOM_DATA[prefab];
    new Pickable(this, data.pickloot, undefined, 1, () => this.picked(), () => this.regen(), context.saved?.components.pickable, {
      scheduler: context.scheduler, growthDuration: context.growthDuration, onEmpty: () => this.empty(),
    });
    this.bindBurnable({ propagator: 'small', burnTime: 10, fxLevel: 2,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, context.world) });
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1); workable.SetOnFinishCallback(inst => {
      if (inst.components.pickable.canBePicked) inst.components.lootdropper.SpawnLootPrefab(data.pickloot, inst.position);
      inst.components.lootdropper.SpawnLootPrefab(data.pickloot, inst.position); inst.remove();
    });
    this.onRemove(() => this.disposeTasks());
    // The phase is watched through this mushroom's own tile key: outside the tickingarea it holds its last value.
    const tracker = this.tileTracker;
    const cycle = context.getWatchWorldContent?.(WorldContentKey.Cycle, cleanup => this.cleanups.push(cleanup), { tile: tracker.tile });
    const rain = context.world.rain ? watchSignal(context.world.rain, cleanup => this.cleanups.push(cleanup)) : undefined;
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
      const { pickable } = this.components;
      if (!pickable.canBePicked && rain?.peek() === 'rain') {
        this.rain -= 1;
        if (this.rain <= 0) pickable.regen();
      }
      this.periodicTask = this.context.scheduler.schedule(SEG_TIME, check);
    };
    this.periodicTask = context.scheduler.schedule(SEG_TIME + Math.random() * SEG_TIME, check);
  }

  override initialize(): void {
    const saved = this.saveRecord as PickablePlantRecord | undefined, { pickable } = this.components;
    // Construction picks the pose for the current phase; OnLoad then only sets rain and, when picked, the empty pose.
    if (this.isOpenPhase()) { pickable.canInteractWith = true; this.play([this.data.animname]); }
    else { pickable.canInteractWith = false; this.play(['inground']); }
    if (saved?.components.mushroom) this.rain = saved.components.mushroom.rain;
    if (saved?.components.pickable?.picked) this.play(['picked']);
  }

  private open(): void {
    if (!this.components.pickable.canBePicked) return;
    this.growTask?.();
    this.growTask = this.context.scheduler.schedule(3 + Math.random() * 6, () => this.openTask());
  }

  private close(): void {
    if (!this.components.pickable.canBePicked) return;
    this.growTask?.();
    this.growTask = this.context.scheduler.schedule(3 + Math.random() * 6, () => this.closeTask());
  }

  private openTask(): void {
    const { pickable } = this.components;
    this.play(['open_inground', `open_${this.data.animname}`, this.data.animname]);
    PlaySound('dontstarve/common/mushroom_up', this.position);
    this.growTask = undefined;
    pickable.canInteractWith = true;
  }

  private closeTask(): void {
    const { pickable } = this.components;
    this.play([`close_${this.data.animname}`, 'inground']);
    this.sinkSound();
    this.growTask = undefined;
    pickable.canInteractWith = false;
  }

  private sinkSound(): void {
    const task = this.context.scheduler.schedule(.25, () => { this.soundTasks.delete(task); PlaySound('dontstarve/common/mushroom_down', this.position); });
    this.soundTasks.add(task);
  }
  private readonly soundTasks = new Set<() => void>();

  /** onpickedfn */
  picked(): void {
    this.growTask?.(); this.growTask = undefined;
    this.play(['picked']);
    this.rain = 10 + 1 + Math.floor(Math.random() * 10);
  }

  /** makeemptyfn */
  empty(): void { this.play(['picked']); }

  /** onregenfn: wait for the mushroom to become visible. */
  regen(): void {
    this.components.pickable.canInteractWith = false;
    if (this.isOpenPhase()) this.open();
    else { this.play(['inground']); this.sinkSound(); }
  }

  override exportState(): PickablePlantRecord['components'] { return this.rain > 0 ? { mushroom: { rain: this.rain } } : {}; }

  private disposeTasks(): void {
    this.growTask?.(); this.periodicTask?.();
    for (const task of this.soundTasks) task();
    this.soundTasks.clear();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
  }
}

function mushroomDefinition(prefab: MushroomPlantId): PickablePlantDefinition {
  const data = MUSHROOM_DATA[prefab];
  return {
    prefab, animArchive: 'mushrooms.zip', buildArchive: 'mushrooms.zip', tags: [],
    archiveSprite: { bank: 'mushrooms', instancedAnimations: 'all' }, idle: { name: data.animname, loop: false }, empty: { name: 'picked', frame: 'last' },
    createInstance: context => new MushroomPlantInstance(prefab, context),
  };
}
const MUSHROOM_DEFINITIONS = Object.fromEntries(MUSHROOM_PLANT_IDS.map(id => [id, mushroomDefinition(id)])) as Record<MushroomPlantId, PickablePlantDefinition>;
export const BLUE_MUSHROOM_DEFINITION = MUSHROOM_DEFINITIONS[BLUE_MUSHROOM_ID];
export function isMushroomPlantPrefab(value: string): value is MushroomPlantId {
  return (MUSHROOM_PLANT_IDS as readonly string[]).includes(value);
}

/** mushrooms.lua: red (day), green (dusk) and blue (night) mushrooms share one prefab function. */
export function mushroomPlantPrefabs(world: PickablePlantWorld): Readonly<Record<MushroomPlantId, PrefabEntityDefinition<PickablePlantInstance>>> {
  return Object.fromEntries(MUSHROOM_PLANT_IDS.map(id => [id, plantEntityDefinition(MUSHROOM_DEFINITIONS[id], world)])) as Record<MushroomPlantId, PrefabEntityDefinition<PickablePlantInstance>>;
}
