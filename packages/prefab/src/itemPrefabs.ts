import type { ItemEntity, InventoryStack } from '@dontstarve-web/inventory';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { LootLaunch } from '../../componets/src/inventoryphysics';
import { bernieItemPrefabs } from './bernie';
import { burnableItemPrefabs } from './burnableItems';
import { butterflyPrefabs } from './butterfly';
import { firefliesPrefabs } from './fireflies';
import { GROUND_ART_DEFINITIONS, groundItemPrefab, iconItemPrefab, type ItemPrefabDefinition } from './groundItems';
import type { GroundItemDefinition, GroundSpawnOptions, ItemPrefabWorld } from './groundPrefab';
import { gunpowderPrefabs, GUNPOWDER_ID } from './gunpowder';
import { hatPrefabs } from './hats';
import { declareHeatRockSprite, HEATROCK_ID } from './heatrock';
import { lanternPrefabs } from './lantern';
import { lightbulbPrefabs } from './lightbulb';
import { lightflierPrefabs } from './lightflier';
import { molePrefabs } from './mole';
import { declareNightmareTimepieceSprite, NIGHTMARE_TIMEPIECE_ID } from './nightmare_timepiece';
import { phonographPrefabs } from './phonograph';
import { poopPrefabs, POOP_ID } from './poop';
import { rockAvocadoFruitPrefabs } from './rock_avocado_fruit';
import { torchPrefabs } from './torch';

/**
 * The item prefabs: every inventory item and piece of ground art, each from its own module where it has one, else drawn
 * from its ground art, else from its inventory image (`icons`).
 */
export function itemPrefabs(world: ItemPrefabWorld,
  icons: Readonly<Record<string, { readonly atlas: string; readonly image: string }>>): Record<string, ItemPrefabDefinition> {
  const prefabs: Record<string, ItemPrefabDefinition> = {};
  for (const [id, icon] of Object.entries(icons)) { prefabs[id] = iconItemPrefab(id, icon, world); }
  for (const id of Object.keys(GROUND_ART_DEFINITIONS)) { prefabs[id] = groundItemPrefab(id, world); }
  return Object.assign(prefabs,
    burnableItemPrefabs(world, [GUNPOWDER_ID, POOP_ID, 'rock_avocado_fruit_ripe']),
    { [HEATROCK_ID]: groundItemPrefab(HEATROCK_ID, world, { configure: inst => declareHeatRockSprite(inst, inst.sprite) }) },
    { [NIGHTMARE_TIMEPIECE_ID]: groundItemPrefab(NIGHTMARE_TIMEPIECE_ID, world, { configure: inst => declareNightmareTimepieceSprite(inst, inst.sprite) }) },
    hatPrefabs(world), bernieItemPrefabs(world), firefliesPrefabs(world), butterflyPrefabs(world), molePrefabs(world),
    lightflierPrefabs(world), lightbulbPrefabs(world), lanternPrefabs(world), phonographPrefabs(world), torchPrefabs(world),
    poopPrefabs(world), rockAvocadoFruitPrefabs(world), gunpowderPrefabs(world));
}

/** The stack a ground item definition describes, without its display metadata or saved prefab records. */
function definitionStack(definition: GroundItemDefinition): InventoryStack {
  const { entity: _entity, name: _name, icon: _icon, atlas: _atlas, torchLit: _torchLit, lanternOn: _lanternOn,
    playbackRemaining: _playback, ...stack } = definition;
  return stack;
}

/**
 * SpawnPrefab of a stack, set down at `position` as inventoryitem:OnDropped does: lootdropper FlingItem throws it
 * (`fling`), `launch` gives its exact flight, otherwise it lands where it is put. A given `entity` is that inst itself.
 */
export function spawnGroundStack(world: Pick<ItemPrefabWorld, 'spawnItem'>, definition: GroundItemDefinition, position: ReadonlyVector3,
  { fling = false, launch }: GroundSpawnOptions = {}): ItemEntity {
  if (!Number.isSafeInteger(definition.count) || definition.count < 1) { throw new RangeError('Invalid ground item count'); }
  const inst = definition.entity ?? world.spawnItem(definitionStack(definition));
  inst.setPosition(position.x, 0, position.z);
  inst.components.inventoryitem.OnDropped(launch);
  if (fling && !launch) { inst.components.inventoryphysics?.Launch(); }
  return inst;
}

/** lootdropper DropLoot: each piece of each stack is spawned on its own and flung. */
export function flingLoot(world: Pick<ItemPrefabWorld, 'spawnItem'>, definitions: readonly GroundItemDefinition[], position: ReadonlyVector3,
  launch?: () => LootLaunch): void {
  const origin = position.clone();
  for (const definition of definitions) {
    if (!Number.isSafeInteger(definition.count) || definition.count < 1) { throw new RangeError('Invalid loot count'); }
    for (let index = 0; index < definition.count; index++) {
      spawnGroundStack(world, { ...definition, entity: undefined, count: 1 }, origin, { fling: true, launch: launch?.() });
    }
  }
}
