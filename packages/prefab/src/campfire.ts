import { SpriteState } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { PlaySound } from './sound';
import type { PrefabWorldContext } from './worldContext';

export const CAMPFIRE_ID = 'campfire' as const;
export type CampfireId = typeof CAMPFIRE_ID;

const declaration = definitions.animatedBuildings.campfire;

/** campfire.lua MakePlacer("campfire_placer", "campfire", "campfire", "preview"). */
export const CAMPFIRE_PLACER = buildingPlacer(declaration);

function onbuilt(inst: PrefabInstance): void {
  inst.sprite.playOnce('place');
  inst.sprite.pushAnimation('idle', false);
  PlaySound('dontstarve/common/fireAddFuel', inst.position);
}

/** campfire.lua fn(), as far as it is ported: PlayAnimation("idle", false), the obstacle and onbuilt. */
export class CampfireInstance extends PrefabInstance {
  constructor() {
    super(CAMPFIRE_ID, new SpriteState({ name: 'idle', held: true, billboard: true }));
    MakeBuildingPersist(this);
    this.ListenForEvent('onbuilt', () => onbuilt(this));
  }
}

export function campfirePrefabs(world: PrefabWorldContext) {
  return { [CAMPFIRE_ID]: buildingPrefab(declaration, 'campfire', .2, () => new CampfireInstance(), world) };
}
