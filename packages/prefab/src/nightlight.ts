import { SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { createStructureLootDropper } from './structureLoot';
import type { PrefabWorldContext } from './worldContext';

export const NIGHT_LIGHT_ID = 'nightlight' as const;
export type NightLightId = typeof NIGHT_LIGHT_ID;

const declaration = definitions.animatedBuildings.nightlight;

/** nightlight.lua MakePlacer("nightlight_placer", "nightmare_torch", "nightmare_torch", "idle"). */
export const NIGHT_LIGHT_PLACER = buildingPlacer(declaration);

function onworked(inst: PrefabInstance): void {
  if (inst.hasTag('burnt')) return;
  inst.sprite.playOnce('hit');
  inst.sprite.pushAnimation('idle', false);
}

function onhammered(inst: PrefabInstance): void {
  inst.components.lootdropper!.DropLoot();
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'stone');
  inst.remove();
}

function onbuilt(inst: PrefabInstance): void {
  inst.sprite.playOnce('place');
  inst.sprite.pushAnimation('idle', false);
}

/** nightlight.lua fn(), as far as it is ported: PlayAnimation("idle", false), the hammer workable and onbuilt. */
export class NightLightInstance extends PrefabInstance {
  constructor(world: PrefabWorldContext) {
    super(NIGHT_LIGHT_ID, new SpriteState({ name: 'idle', held: true, billboard: true }));
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

export function nightLightPrefabs(world: PrefabWorldContext) {
  return { [NIGHT_LIGHT_ID]: buildingPrefab(declaration, 'nightmare_torch', .1, () => new NightLightInstance(world), world) };
}
