import { SpriteState } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import type { BuildingPlacerSpec } from './buildingPlacer';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeDeconstructable, MakeObstaclePhysics } from './standardcomponents';

export const WARDROBE_ID = 'wardrobe' as const;

const { archive, buildLabel, idleAnimation: closed, name, scale } = definitions.animatedBuildings.wardrobe;

/** wardrobe.lua MakePlacer("wardrobe_placer", "wardrobe", "wardrobe", "closed"). */
export const WARDROBE_PLACER: BuildingPlacerSpec = { buildLabel, name, animation: closed,
  art: resources => ({ source: resources.animated(archive, {}, { name, scale }) }) };

/** wardrobe.lua fn(), as far as it is ported: bank/build wardrobe, PlayAnimation("closed") and the obstacle. Appearance only. */
export class WardrobeInstance extends PrefabInstance {
  constructor() {
    super(WARDROBE_ID, new SpriteState({ name: closed, held: true, billboard: true }));
    // The building's save shape: wardrobe.lua's onsave would add `burnt` here.
    this.OnSave = (_inst, data) => { data.building = {}; };
  }
}

/** The Prefab table wardrobe.lua returns; the placer is the build flow's. */
export function wardrobePrefabs(): Record<typeof WARDROBE_ID, PrefabEntityDefinition<WardrobeInstance>> {
  return { [WARDROBE_ID]: {
    fn: () => new WardrobeInstance(),
    assets: { animationArchive: archive, buildArchives: [archive], bank: 'wardrobe' },
    alignBottom: true,
    physics: { make: MakeObstaclePhysics, radius: .75 },
    onSpawned: MakeDeconstructable,
  } };
}
