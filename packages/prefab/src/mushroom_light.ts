import { SpriteState } from '@dontstarve-web/display';
import { Workable, type Worker } from '../../componets/src/workable';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingContainer, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { createStructureLootDropper } from './structureLoot';
import type { PrefabWorldContext } from './worldContext';

/** mushroom_light.lua defines both the white mushroom light and the coloured light. */
export const MUSHROOM_LIGHT_IDS = ['mushroom_light', 'mushroom_light2'] as const;
export type MushroomLightId = typeof MUSHROOM_LIGHT_IDS[number];

/** mushroom_light.lua MakePlacer(name.."_placer", name, name, "idle"). */
export const MUSHROOM_LIGHT_PLACERS = {
  mushroom_light: buildingPlacer(definitions.animatedBuildings.mushroom_light),
  mushroom_light2: buildingPlacer(definitions.animatedBuildings.mushroom_light2),
};

function onworked(inst: PrefabInstance, _worker: Worker, workleft: number): void {
  if (inst.hasTag('burnt')) return;
  if (workleft <= 0) return;
  const on = inst.light.json.peek() !== undefined;
  inst.sprite.playOnce(on ? 'hit_on' : 'hit');
  inst.sprite.pushAnimation(on ? 'idle_on' : 'idle', false);
  inst.components.container?.DropEverything(inst.position);
  inst.components.container?.Close();
}

function onhammered(inst: PrefabInstance): void {
  inst.components.lootdropper!.DropLoot();
  inst.components.container?.DropEverything(inst.position);
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
  inst.remove();
}

function onbuilt(inst: PrefabInstance): void {
  inst.sprite.playOnce('place');
  inst.sprite.pushAnimation('idle', false);
}

/** mushroom_light.lua MakeMushroomLight's fn, as far as it is ported: the container, the hammer workable and onbuilt. */
export class MushroomLightInstance extends PrefabInstance {
  constructor(id: MushroomLightId, world: PrefabWorldContext) {
    super(id, new SpriteState({ name: 'idle', held: true, billboard: true }));
    this.worldServices = world;
    MakeBuildingPersist(this);
    this.addTag('structure');
    this.addTag('lamp');
    MakeBuildingContainer(this, id, world);
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(3);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    this.components.lootdropper = createStructureLootDropper(this);
    this.ListenForEvent('onbuilt', () => onbuilt(this));
  }
}

export function mushroomLightPrefabs(world: PrefabWorldContext) {
  return {
    mushroom_light: buildingPrefab(definitions.animatedBuildings.mushroom_light, 'mushroom_light', .25, () => new MushroomLightInstance('mushroom_light', world), world),
    mushroom_light2: buildingPrefab(definitions.animatedBuildings.mushroom_light2, 'mushroom_light2', .4, () => new MushroomLightInstance('mushroom_light2', world), world),
  };
}
