import { addComponent } from './components';
import type { EntityTask, PrefabEntityDefinition } from './prefabInstance';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { SpriteState } from '@dontstarve-web/display';
import { Pickable } from './components/pickable';
import { Workable } from '../../componets/src/workable';
import { LootDropper } from '../../componets/src/lootdropper';
import { BurnableBinding } from './treeFire';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn, MakeNoGrowInWinter } from './standardcomponents';
import { createEffect, watchSignal, WorldContentKey, type ReadonlySignal, type WorldPhase } from '@dontstarve-web/signals';
import { PickablePlantInstance, plantLootSpawner, SpringGrowthMod, type PickablePlantRecord, type PickablePlantWorld } from './pickablePlant';

export const BLUE_MUSHROOM_ID = 'blue_mushroom' as const;
export const RED_MUSHROOM_ID = 'red_mushroom' as const;
export const GREEN_MUSHROOM_ID = 'green_mushroom' as const;
export const MUSHROOM_PLANT_IDS = [RED_MUSHROOM_ID, GREEN_MUSHROOM_ID, BLUE_MUSHROOM_ID] as const;
export type MushroomPlantId = typeof MUSHROOM_PLANT_IDS[number];
/** tuning.lua SEG_TIME. */
const SEG_TIME = 30;

/** mushrooms.lua data entries: the colour, picked cap and the cave phase in which the mushroom is open. */
interface MushroomData { readonly animname: string; readonly pickloot: string; readonly open_time: WorldPhase }
const MUSHROOM_DATA: Record<MushroomPlantId, MushroomData> = {
  red_mushroom: { animname: 'red', pickloot: 'red_cap', open_time: 'day' },
  green_mushroom: { animname: 'green', pickloot: 'green_cap', open_time: 'dusk' },
  blue_mushroom: { animname: 'blue', pickloot: 'blue_cap', open_time: 'night' },
};

/** mushrooms.lua's fields on the inst. */
export class MushroomPlantInstance extends PickablePlantInstance {
  data!: MushroomData;
  rain = 0;
  growtask?: EntityTask;
  opentaskfn!: () => void;
  closetaskfn!: () => void;
  /** TheWorld.state.cavephase; the project has no separate cave clock yet, so the world phase is used. */
  cavephase?: ReadonlySignal<WorldPhase>;
  /** TheWorld.state.israining. */
  raining?: ReadonlySignal<'none' | 'rain' | 'snow'>;
}

function onsave(inst: MushroomPlantInstance, data: PickablePlantRecord['components']): void {
  if (inst.rain > 0) { data.mushroom = { rain: inst.rain }; }
}

function onload(inst: MushroomPlantInstance, data: PickablePlantRecord['components']): void {
  if (data.mushroom) { inst.rain = data.mushroom.rain; }
}

function onpickedfn(inst: MushroomPlantInstance): void {
  inst.growtask?.Cancel();
  inst.growtask = undefined;
  inst.AnimState.PlayAnimation('picked');
  inst.rain = 10 + 1 + Math.floor(Math.random() * 10);
}

function makeemptyfn(inst: MushroomPlantInstance): void {
  inst.AnimState.PlayAnimation('picked');
}

function checkregrow(inst: MushroomPlantInstance): void {
  const { pickable } = inst.components;
  if (!pickable.canBePicked && inst.raining?.peek() === 'rain') {
    inst.rain -= 1;
    if (inst.rain <= 0) { pickable.regen(); }
  }
}

function open(inst: MushroomPlantInstance): void {
  if (!inst.components.pickable.canBePicked) { return; }
  inst.growtask?.Cancel();
  inst.growtask = inst.DoTaskInTime(3 + Math.random() * 6, inst.opentaskfn);
}

function close(inst: MushroomPlantInstance): void {
  if (!inst.components.pickable.canBePicked) { return; }
  inst.growtask?.Cancel();
  inst.growtask = inst.DoTaskInTime(3 + Math.random() * 6, inst.closetaskfn);
}

function onregenfn(inst: MushroomPlantInstance): void {
  inst.components.pickable.canInteractWith = false; // Wait for the mushroom to become visible.
  if (inst.data.open_time === inst.cavephase?.peek()) { open(inst); }
  else {
    inst.AnimState.PushAnimation('inground', false);
    inst.DoTaskInTime(.25, () => inst.SoundEmitter!.PlaySound('dontstarve/common/mushroom_down'));
  }
}

function OnIsOpenPhase(inst: MushroomPlantInstance, isopen: boolean): void {
  if (isopen) { open(inst); } else { close(inst); }
}

/**
 * mushrooms.lua mushcommonfn(data): opens in its cave phase (3–9 seconds after the change) and closes otherwise, and a
 * picked mushroom regrows after `rain` rainy periods. Not ported: inspectable, the regrowth manager and hauntable.
 */
function mushcommonfn(prefab: MushroomPlantId, world: PickablePlantWorld, position: ReadonlyVector3): MushroomPlantInstance {
  const data = MUSHROOM_DATA[prefab];
  const inst = new MushroomPlantInstance(prefab, new SpriteState({ name: data.animname, billboard: true }));
  inst.AddSoundEmitter();
  inst.BindScheduler(world.scheduler);
  // The cave phase is watched through this mushroom's own tile, which its position places.
  inst.setPosition(position.x, position.y, position.z);
  inst.AnimState.PlayAnimation(data.animname);

  inst.data = data;

  inst.opentaskfn = () => {
    inst.AnimState.PlayAnimation('open_inground');
    inst.AnimState.PushAnimation(`open_${data.animname}`, false);
    inst.AnimState.PushAnimation(data.animname, false);
    inst.SoundEmitter!.PlaySound('dontstarve/common/mushroom_up');
    inst.growtask = undefined;
    inst.components.pickable.canInteractWith = true;
  };

  inst.closetaskfn = () => {
    inst.AnimState.PlayAnimation(`close_${data.animname}`);
    inst.AnimState.PushAnimation('inground', false);
    inst.DoTaskInTime(.25, () => inst.SoundEmitter!.PlaySound('dontstarve/common/mushroom_down'));
    inst.growtask = undefined;
    inst.components.pickable.canInteractWith = false;
  };

  const pickable = addComponent(inst, 'pickable', Pickable, data.pickloot, undefined, 1, () => onpickedfn(inst), () => onregenfn(inst), undefined, {
    scheduler: world.scheduler, growthDuration: SpringGrowthMod(inst, world.getWatchWorldContent), onEmpty: () => makeemptyfn(inst),
  });
  pickable.picksound = 'dontstarve/wilson/pickup_plants';

  inst.rain = 0;

  addComponent(inst, 'lootdropper', LootDropper, plantLootSpawner(world));
  const workable = addComponent(inst, 'workable', Workable<MushroomPlantInstance>);
  workable.SetWorkAction('DIG');
  workable.SetOnFinishCallback(inst => {
    if (inst.components.pickable.canBePicked) { inst.components.lootdropper!.SpawnLootPrefab(data.pickloot, inst.position); }
    inst.components.lootdropper!.SpawnLootPrefab(data.pickloot, inst.position);
    inst.remove();
  });
  workable.SetWorkLeft(1);

  // MakeSmallBurnable + MakeSmallPropagator.
  const burn = new BurnableBinding(inst, { propagator: 'small', burnTime: 10, fxLevel: 2,
    onIgnite: () => DefaultBurnFn(inst), onExtinguish: () => DefaultExtinguishFn(inst), onBurnt: () => DefaultBurntFn(inst, world) }, world);
  inst.onRemove(() => burn.dispose());
  MakeNoGrowInWinter(inst, world.getWatchWorldContent);

  // WatchWorldState("iscave"..open_time, OnIsOpenPhase): only changes notify, not the initial phase. Outside the
  // tickingarea the mushroom's tile holds the phase it last saw.
  const cavephase = inst.cavephase = world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => inst.onRemove(stop), { tile: inst.tileTracker.tile });
  if (cavephase) {
    let previous: boolean | undefined;
    inst.onRemove(createEffect(() => {
      const isopen = cavephase.get() === data.open_time;
      const changed = previous !== undefined && previous !== isopen;
      previous = isopen;
      if (changed) { OnIsOpenPhase(inst, isopen); }
    }));
  }
  inst.raining = world.rain ? watchSignal(world.rain, stop => inst.onRemove(stop)) : undefined;

  inst.DoPeriodicTask(SEG_TIME, checkregrow, SEG_TIME + Math.random() * SEG_TIME);

  if (data.open_time === cavephase?.peek()) {
    inst.AnimState.PlayAnimation(data.animname);
    pickable.canInteractWith = true;
  } else {
    inst.AnimState.PlayAnimation('inground');
    pickable.canInteractWith = false;
  }

  inst.OnSave = (_inst, saved) => onsave(inst, saved);
  inst.OnLoad = (_inst, saved) => onload(inst, saved);
  return inst;
}

export function isMushroomPlantPrefab(value: string): value is MushroomPlantId {
  return MUSHROOM_PLANT_IDS.some(known => known === value);
}

/** mushrooms.lua MakeMushroom(data): red (day), green (dusk) and blue (night) mushrooms share mushcommonfn. */
export function mushroomPlantPrefabs(world: PickablePlantWorld): Readonly<Record<MushroomPlantId, PrefabEntityDefinition<MushroomPlantInstance>>> {
  const prefab = (id: MushroomPlantId): PrefabEntityDefinition<MushroomPlantInstance> => ({
    fn: position => mushcommonfn(id, world, position),
    assets: { animationArchive: 'mushrooms.zip', buildArchives: ['mushrooms.zip'], bank: 'mushrooms' },
    assetOptions: { instancedAnimations: 'all', staticBillboard: true },
    rayTestOnBB: true,
  });
  return { red_mushroom: prefab(RED_MUSHROOM_ID), green_mushroom: prefab(GREEN_MUSHROOM_ID), blue_mushroom: prefab(BLUE_MUSHROOM_ID) };
}
