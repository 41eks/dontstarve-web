import { SpriteState } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import type { PrefabWorldContext } from './worldContext';

export const WARDROBE_ID = 'wardrobe' as const;

const declaration = definitions.animatedBuildings.wardrobe;

/** wardrobe.lua MakePlacer("wardrobe_placer", "wardrobe", "wardrobe", "closed"). */
export const WARDROBE_PLACER = buildingPlacer(declaration);

/** wardrobe.lua fn(), as far as it is ported: bank/build wardrobe, PlayAnimation("closed") and the obstacle. Appearance only. */
export class WardrobeInstance extends PrefabInstance {
  constructor() {
    super(WARDROBE_ID, new SpriteState({ name: declaration.idleAnimation, held: true, billboard: true }));
    MakeBuildingPersist(this);
  }
}

/** The Prefab table wardrobe.lua returns; the placer is the build flow's. */
export function wardrobePrefabs(world: PrefabWorldContext) {
  return { [WARDROBE_ID]: buildingPrefab(declaration, 'wardrobe', .75, () => new WardrobeInstance(), world) };
}
