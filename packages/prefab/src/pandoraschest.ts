import { addComponent } from './components';
import { SpriteState } from '@dontstarve-web/display';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Hauntable } from '../../componets/src/hauntable';
import { LunarHailBuildup, RoseInspectable } from '../../componets/src/pandoraschestSignatures';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingContainer, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { onclose, onopen } from './treasurechest';
import type { PrefabWorldContext } from './worldContext';

export const PANDORAS_CHEST_ID = 'pandoraschest' as const;
export type PandorasChestId = typeof PANDORAS_CHEST_ID;
/** tuning.lua HAUNT_TINY. */
const HAUNT_TINY = 1;

const declaration = definitions.animatedBuildings.pandoraschest;

export const PANDORAS_CHEST_PLACER = buildingPlacer(declaration, 'pandoras_chest');

/**
 * treasurechest.lua MakeChest("pandoraschest", "pandoras_chest", "pandoras_chest", indestructible = true,
 * pandora_master_postinit): a 3 x 3 container with no workable, lootdropper or burnable, and no skins.
 */
export class PandorasChestInstance extends PrefabInstance {
  constructor(world: PrefabWorldContext) {
    super(PANDORAS_CHEST_ID, new SpriteState({ name: 'closed', held: true, billboard: true }));
    this.worldServices = world;
    MakeBuildingPersist(this);
    // MakeChest AddTag("structure"), AddTag("chest"); MakeSnowCoveredPristine AddTag("SnowCovered").
    for (const tag of ['structure', 'chest', 'SnowCovered']) {
      this.addTag(tag);
    }
    const container = MakeBuildingContainer(this, PANDORAS_CHEST_ID, world);
    container.onopenfn = onopen;
    container.onclosefn = onclose;
    addComponent(this, 'inspectable', Inspectable);
    if (world.scheduler) {
      addComponent(this, 'hauntable', Hauntable, world.scheduler).SetHauntValue(HAUNT_TINY);
    }
    // MakeSnowCovered -> MakeLunarHailBuildup; pandora_master_postinit -> MakeRoseTarget_CreateFuel_IncreasedHorror.
    addComponent(this, 'lunarhailbuildup', LunarHailBuildup);
    addComponent(this, 'roseinspectable', RoseInspectable);
  }
}

export function pandorasChestPrefabs(world: PrefabWorldContext) {
  return {
    [PANDORAS_CHEST_ID]: {
      ...buildingPrefab(declaration, 'pandoras_chest', undefined, () => new PandorasChestInstance(world), world),
      minimapIcon: 'pandoraschest.png',
    },
  };
}
