import type * as CANNON from 'cannon-es';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { WorldContentKey, type ReadonlySignal, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import type { Witherable, WitherableSave } from '../../componets/src/witherable';
import type { Burnable } from '../../componets/src/burnable';
import type { Propagator } from '../../componets/src/propagator';
import type { LootDropper, LootSpawn } from '../../componets/src/lootdropper';
import type { Growable, GrowableSave } from '../../componets/src/growable';
import type { SimpleMagicGrower } from '../../componets/src/simplemagicgrower';
import type { Pickable, PickableSaveState } from './components/pickable';
import type { GameTimeScheduler } from './components/gameTimeScheduler';
import type { SpawnGroundItem } from './groundPrefab';
import type { FireFxHost } from './treeFire';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PrefabInstance } from './prefabInstance';

/**
 * The saved record of the pickable plant prefabs: the components' OnSave under their names, then what each prefab's
 * own OnSave adds.
 */
export interface PickablePlantRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { pickable?: PickableSaveState; witherable?: WitherableSave; growable?: GrowableSave;
    /** berrybush: the skin its save record names. */
    plant?: { skinId?: string };
    /** rock_avocado_bush.lua on_save: data.burning. */
    burning?: true;
    /** mushrooms.lua OnSave: the rain days left before a picked mushroom regrows. */
    mushroom?: { rain: number };
    /** cave_fern.lua OnSave: data.anim, the chosen pose clip. */
    variant?: { anim: string } };
}

/** TheWorld and SpawnPrefab as the plant prefabs' fns reach them. */
export interface PickablePlantWorld {
  readonly scheduler: GameTimeScheduler;
  readonly fire: FireFxHost;
  readonly getWatchWorldContent?: GetWatchWorldContent;
  /** Rain belongs to the injected world. */
  rain?: ReadonlySignal<'none' | 'rain' | 'snow'>;
  /** Without it every plant is active. */
  tickingarea?: TileStateQuery;
  physics?: CANNON.World;
  getLocalTemperature?(position: ReadonlyVector3): number;
  /** Loot, ash and dug plants are spawned when they are produced; their displays load the art. */
  spawnGroundItem: SpawnGroundItem;
  isOcean?(position: ReadonlyVector3): boolean;
  /** SpawnPrefab for an inventory item a prefab hands to its picker. */
  spawnItem?(state: InventoryStack): ItemEntity;
  /** inventoryitem:DoDropPhysics at the plant, for pickers without an inventory. */
  dropItem?(entity: ItemEntity, position: ReadonlyVector3): void;
}

/** The components the plant prefabs' fns add; a prefab's own inst fields are declared in its module. */
export class PickablePlantInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    pickable: Pickable;
    burnable: Burnable;
    propagator: Propagator;
    lootdropper?: LootDropper;
    witherable?: Witherable;
    growable?: Growable;
    simplemagicgrower?: SimpleMagicGrower;
  };
}

/** simutil.lua SpringGrowthMod: a growth task set in spring takes TUNING.SPRING_GROWTH_MODIFIER (.75) of its time. */
export function SpringGrowthMod(inst: PrefabInstance, watch: GetWatchWorldContent | undefined): (seconds: number) => number {
  const season = watch?.(WorldContentKey.Season, stop => inst.onRemove(stop));
  return seconds => season?.peek().season === 'spring' ? seconds * .75 : seconds;
}

/** lootdropper:SpawnLootPrefab's SpawnPrefab: the loot is flung from the plant as a ground item. */
export function plantLootSpawner(world: Pick<PickablePlantWorld, 'spawnGroundItem'>): LootSpawn {
  return (prefab, point, skinId) => world.spawnGroundItem(
    { ...GROUND_ITEM_DEFINITIONS[prefab], itemId: prefab, count: 1, ...(skinId ? { skinId } : {}) },
    point, { fling: true });
}
