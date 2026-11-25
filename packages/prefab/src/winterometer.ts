import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { Workable } from '../../componets/src/workable';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance, type EntityTask } from './prefabInstance';
import type { ReadonlyVector3 } from './transform';
import definitions from './definitions.json' with { type: 'json' };
import { OVERHEAT_TEMP } from '../../componets/src/temperatureoverrider';
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import { PlaySound } from './sound';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt } from './standardcomponents';
import { BurnableBinding } from './treeFire';
import type { PrefabWorldContext } from './worldContext';

export const WINTEROMETER_ID = 'winterometer' as const;
export type WinterometerId = typeof WINTEROMETER_ID;
const declaration: BuildingDeclaration = definitions.animatedBuildings.winterometer;
export const WINTEROMETER_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives!;

/** winterometer.lua MakePlacer("winterometer_placer", "winter_meter", "winter_meter", "idle"). */
export const WINTEROMETER_PLACER = buildingPlacer(declaration, 'winter_meter');

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** DoCheckTemp: the meter reads GetLocalTemperature(inst), clamped to [0, OVERHEAT_TEMP]. */
function DoCheckTemp(inst: WinterometerInstance): void {
  const world = inst.worldServices;
  if (inst.hasTag('burnt') || !world?.getLocalTemperature) {
    return;
  }
  const temperature = world.getLocalTemperature(inst.position.x, inst.position.z);
  inst.sprite.setPercent('meter', 1 - clamp(temperature, 0, OVERHEAT_TEMP) / OVERHEAT_TEMP);
}

function StartCheckTemp(inst: WinterometerInstance): void {
  if (!inst.task && !inst.hasTag('burnt')) {
    inst.task = inst.DoPeriodicTask(1, DoCheckTemp, 0);
  }
}

/** onhit, onbuilt and makeburnt's inst.task:Cancel(). */
function StopCheckTemp(inst: WinterometerInstance): void {
  inst.task?.Cancel();
  inst.task = undefined;
}

function onbuilt(inst: WinterometerInstance): void {
  StopCheckTemp(inst);
  // The global animover handler restarts the check task.
  inst.sprite.playOnce('place', () => StartCheckTemp(inst));
  PlaySound('dontstarve/common/winter_meter_craft', inst.position);
}

function onhit(inst: WinterometerInstance): void {
  if (inst.hasTag('burnt')) {
    return;
  }
  StopCheckTemp(inst);
  inst.sprite.playOnce('hit', () => StartCheckTemp(inst));
}

function onhammered(inst: PrefabInstance): void {
  if (inst.components.burnable?.IsBurning()) {
    inst.components.burnable.Extinguish();
  }
  inst.components.lootdropper!.DropLoot();
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
  inst.remove();
}

/** winterometer.lua fn(), as far as it is ported: the temperature check, the hammer workable and MakeSmallBurnable. */
export class WinterometerInstance extends PrefabInstance {
  task?: EntityTask;

  constructor(world: PrefabWorldContext, position: ReadonlyVector3) {
    super(WINTEROMETER_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
    const { fire, scheduler } = world;
    if (!fire || !scheduler) {
      throw new Error("A winterometer needs the world's fire effects and scheduler");
    }
    this.BindWorld(world);
    // The first reading in fn is taken where the meter stands.
    this.setPosition(position.x, 0, position.z);
    MakeBuildingPersist(this);
    const { OnSave: saveBuilding } = this;
    this.OnSave = (inst, data) => {
      saveBuilding!(inst, data);
      onsaveBurnt(inst, data);
    };
    this.OnLoad = onloadBurnt;
    this.addTag('structure');
    const workable = addComponent(this, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(4);
    workable.SetOnWorkCallback(onhit);
    workable.SetOnFinishCallback(onhammered);
    addComponent(this, 'lootdropper', LootDropper, spawnStructureLoot(this), STRUCTURE_LOOT_RECIPES);
    this.ListenForEvent('burntup', StopCheckTemp);
    this.ListenForEvent('onbuilt', () => onbuilt(this));
    // MakeSmallBurnable(inst, nil, nil, true): SMALL_BURNTIME, fire level 2, small propagator, burnt structure.
    const burn = new BurnableBinding(
      this,
      {
        burnTime: 10,
        fxLevel: 2,
        propagator: 'small',
        onExtinguish: () => {
          PlaySound('dontstarve/common/fireOut', this.position);
        },
        onBurnt: () => {
          DefaultBurntStructureFn(this);
          burn.dispose();
        },
      },
      { fire, scheduler },
    );
    this.onRemove(() => burn.dispose());
    DoCheckTemp(this);
    StartCheckTemp(this);
  }
}

export function winterometerPrefabs(world: PrefabWorldContext) {
  return {
    [WINTEROMETER_ID]: {
      ...buildingPrefab(declaration, 'winter_meter', 0.4, position => new WinterometerInstance(world, position), world),
      minimapIcon: 'winterometer.png',
    },
  };
}
