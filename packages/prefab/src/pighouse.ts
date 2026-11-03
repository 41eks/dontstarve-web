import { SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { createStructureLootDropper } from './structureLoot';
import type { PrefabWorldContext } from './worldContext';

export const PIG_HOUSE_ID = 'pighouse' as const;
export type PigHouseId = typeof PIG_HOUSE_ID;

const declaration = definitions.animatedBuildings.pighouse;

/** pighouse.lua's MakePlacer. */
export const PIG_HOUSE_PLACER = buildingPlacer(declaration);

function onworked(inst: PrefabInstance): void {
  if (inst.hasTag('burnt')) return;
  inst.sprite.playOnce('hit');
  inst.sprite.pushAnimation('idle', false);
}

function onhammered(inst: PrefabInstance): void {
  if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
  inst.components.lootdropper!.DropLoot();
  inst.worldServices?.fx?.collapse?.('big', inst.position, 'wood');
  inst.remove();
}

function onbuilt(inst: PrefabInstance): void {
  inst.sprite.playOnce('place');
  inst.sprite.pushAnimation('idle', true);
}

/** pighouse.lua fn(), as far as it is ported: the looping idle, the hammer workable and onbuilt. */
export class PigHouseInstance extends PrefabInstance {
  constructor(world: PrefabWorldContext) {
    super(PIG_HOUSE_ID, new SpriteState({ name: 'idle', billboard: true }));
    this.worldServices = world;
    MakeBuildingPersist(this);
    this.addTag('structure');
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(4);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    this.components.lootdropper = createStructureLootDropper(this);
    this.ListenForEvent('onbuilt', () => onbuilt(this));
  }
}

export function pigHousePrefabs(world: PrefabWorldContext) {
  return { [PIG_HOUSE_ID]: buildingPrefab(declaration, 'pig_house', 1, () => new PigHouseInstance(world), world) };
}
