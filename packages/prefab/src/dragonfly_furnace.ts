import { SpriteState } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { createEffect, watchSignal } from '@dontstarve-web/signals';
import { Hauntable } from '../../componets/src/hauntable';
import { Heater } from '../../componets/src/heater';
import { Incinerator } from '../../componets/src/incinerator';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { animationLengths } from './animationTimings';
import { buildingPlacer, buildingPrefab, MakeBuildingContainer, MakeBuildingPersist } from './building';
import { addComponent } from './components';
import definitions from './definitions.json' with { type: 'json' };
import { PrefabInstance, type EntityTask, type PrefabComponents } from './prefabInstance';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { WORLD_SCALE } from './tile';
import type { PrefabWorldContext } from './worldContext';

export const DRAGONFLY_FURNACE_ID = 'dragonflyfurnace' as const;
export type DragonflyFurnaceId = typeof DRAGONFLY_FURNACE_ID;

const declaration = definitions.animatedBuildings.dragonflyfurnace;

/** dragonfurnace.lua MakePlacer("dragonflyfurnace_placer", "dragonfly_furnace", "dragonfly_furnace", "idle"). */
export const DRAGONFLY_FURNACE_PLACER = buildingPlacer(declaration, 'dragonfly_furnace');

/** dragonfly_furnace.zip's clip lengths: OnIncinerateItems waits out the incinerate clip before the furnace reopens. */
const ANIMATION_LENGTHS = animationLengths('dragonfly_furnace.zip');
const FIRE_LOOP = 'dontstarve/common/together/dragonfly_furnace/fire_LP';
/** fn: inst.components.heater.heat = 115. */
const DRAGONFLY_FURNACE_HEAT = 115;

interface DragonflyFurnaceComponents extends PrefabComponents {
  heater?: Heater;
  incinerator?: Incinerator<DragonflyFurnaceInstance, ItemEntity>;
}

/**
 * dragonfurnace.lua fn: the hammer workable, the incinerating container, the heater, the light and the fire loop.
 * Not ported: the cooker component (cooking on a fire is not ported anywhere; the furnace keeps the cooker tag),
 * SetBloomEffectHandle, the saladfurnace prefab and its `salad` save flag.
 */
export class DragonflyFurnaceInstance extends PrefabInstance<SpriteState, DragonflyFurnaceComponents> {
  /** onbuilt's DoTaskInTime(30 * FRAMES, BuiltTimeLine1). */
  _task1?: EntityTask;
  /** onbuilt's DoTaskInTime(40 * FRAMES, BuiltTimeLine2); while it waits, the fire loop has not started. */
  _task2?: EntityTask;

  constructor(world: PrefabWorldContext) {
    super(DRAGONFLY_FURNACE_ID, new SpriteState({ name: 'hi', billboard: true }));
    const { scheduler } = world;
    if (!scheduler) {
      throw new Error("A dragonfly furnace needs the world's scheduler");
    }
    this.BindWorld(world);
    this.BindScheduler(scheduler);
    this.AddSoundEmitter();
    MakeBuildingPersist(this);

    // SetDeploySmartRadius(1.25): recipe min_spacing / 2.
    this.deploySmartRadius = 1.25 * WORLD_SCALE;
    this.light.set({ radius: 1 * WORLD_SCALE, falloff: 0.9, intensity: 0.5, colour: [235 / 255, 121 / 255, 12 / 255] });
    this.sprite.setLightOverride(0.4);

    for (const tag of ['structure', 'wildfireprotected', 'cooker']) {
      this.addTag(tag);
    }

    const workable = addComponent(this, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(6);
    workable.SetOnFinishCallback(onworkfinished);
    workable.SetOnWorkCallback(onworked);

    // WidgetSetup("dragonflyfurnace"): containers.lua's 2x2 cooker widget, which refuses irreplaceable items.
    MakeBuildingContainer(this, DRAGONFLY_FURNACE_ID, world);

    const incinerator = addComponent(this, 'incinerator', Incinerator<DragonflyFurnaceInstance, ItemEntity>);
    incinerator.SetOnIncinerateFn(OnIncinerateItems);
    incinerator.SetShouldIncinerateItemFn(ShouldIncinerateItem);

    addComponent(this, 'lootdropper', LootDropper, spawnStructureLoot(this), STRUCTURE_LOOT_RECIPES);
    addComponent(this, 'inspectable', Inspectable).getstatus = getstatus;
    const heater = addComponent(this, 'heater', Heater);
    heater.SetHeat(DRAGONFLY_FURNACE_HEAT);

    // MakeHauntableWork: its work attempt is commented out (#HAUNTFIX), so a haunt does nothing.
    addComponent(this, 'hauntable', Hauntable, scheduler).SetOnHauntFn(() => false);

    this.ListenForEvent('onbuilt', () => onbuilt(this));
    // inst.OnEntitySleep / inst.OnEntityWake, as the entity's tile sleeps and wakes.
    let stopStatus: (() => void) | undefined;
    const status = watchSignal(this.status, stop => {
      stopStatus = stop;
    });
    const stopWake = createEffect(() => {
      const value = status.get();
      if (value === 'active') {
        OnEntityWake(this);
      } else if (value === 'asleep') {
        OnEntitySleep(this);
      }
    });
    this.onRemove(() => {
      stopWake();
      stopStatus?.();
    });
  }
}

function getstatus(): string {
  return 'HIGH';
}

function onworkfinished(inst: DragonflyFurnaceInstance): void {
  inst.components.lootdropper!.DropLoot();
  inst.worldServices?.fx?.collapse?.('big', inst.position, 'metal');
  inst.remove();
}

function onworked(inst: DragonflyFurnaceInstance): void {
  if (inst._task2 !== undefined) {
    inst._task2.Cancel();
    inst._task2 = undefined;
    if (!inst.IsAsleep()) {
      inst.SoundEmitter!.PlaySound(FIRE_LOOP, 'loop');
    }
    if (inst._task1 !== undefined) {
      inst._task1.Cancel();
      inst._task1 = undefined;
    }
  }
  inst.sprite.playOnce('hi_hit');
  inst.sprite.pushAnimation('hi', true);

  const container = inst.components.container;
  if (container) {
    container.DropEverything(inst.position);
    container.Close();
  }
}

function BuiltTimeLine1(inst: DragonflyFurnaceInstance): void {
  inst._task1 = undefined;
  inst.SoundEmitter!.PlaySound('dontstarve/common/fireAddFuel');
}

function BuiltTimeLine2(inst: DragonflyFurnaceInstance): void {
  inst._task2 = undefined;
  inst.SoundEmitter!.PlaySound('dontstarve/common/together/dragonfly_furnace/light');
  if (!inst.IsAsleep()) {
    inst.SoundEmitter!.PlaySound(FIRE_LOOP, 'loop');
  }
}

function onbuilt(inst: DragonflyFurnaceInstance): void {
  inst.sprite.playOnce('place');
  inst.sprite.pushAnimation('hi_pre', false);
  inst.sprite.pushAnimation('hi', true);
  inst.SoundEmitter!.KillSound('loop');
  inst.SoundEmitter!.PlaySound('dontstarve/common/together/dragonfly_furnace/place');
  if (inst._task2 !== undefined) {
    inst._task2.Cancel();
    inst._task1?.Cancel();
  }
  inst._task1 = inst.DoTaskInTime(30 * FRAMES, BuiltTimeLine1);
  inst._task2 = inst.DoTaskInTime(40 * FRAMES, BuiltTimeLine2);
}

function OnEntitySleep(inst: DragonflyFurnaceInstance): void {
  inst.SoundEmitter!.KillSound('loop');
}

function OnEntityWake(inst: DragonflyFurnaceInstance): void {
  if (inst._task2 === undefined) {
    inst.SoundEmitter!.PlaySound(FIRE_LOOP, 'loop');
  }
}

function _CanBeOpened(inst: DragonflyFurnaceInstance): void {
  inst.components.container!.canbeopened = true;
}

function OnIncinerateItems(inst: DragonflyFurnaceInstance): void {
  inst.sprite.playOnce('incinerate');
  inst.sprite.pushAnimation('hi', true);

  inst.SoundEmitter!.PlaySound('qol1/dragonfly_furnace/incinerate');

  const container = inst.components.container!;
  container.Close();
  container.canbeopened = false;

  // GetCurrentAnimationLength() - GetCurrentAnimationTime() + FRAMES: the clip has just started.
  const time = ANIMATION_LENGTHS.get('incinerate')! + FRAMES;
  inst.DoTaskInTime(time, _CanBeOpened);
}

function ShouldIncinerateItem(_inst: DragonflyFurnaceInstance, item: ItemEntity): boolean {
  // NOTES(JBK): Fruitcake hack. You think you can escape this so easily?
  if (item.prefab === 'winter_food4') {
    return false;
  }
  if (item.hasTag('irreplaceable')) {
    return false;
  }
  const container = item.components.container;
  if (container !== undefined && !container.IsEmpty()) {
    return false;
  }
  return true;
}

export function dragonflyFurnacePrefabs(world: PrefabWorldContext) {
  return {
    [DRAGONFLY_FURNACE_ID]: {
      ...buildingPrefab(declaration, 'dragonfly_furnace', 0.5, () => new DragonflyFurnaceInstance(world), world),
      // fn: MiniMapEntity:SetIcon("dragonfly_furnace.png").
      minimapIcon: 'dragonfly_furnace.png',
    },
  };
}
