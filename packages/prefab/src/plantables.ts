import type { ItemEntity } from '@dontstarve-web/inventory';
import { Deployable, type PlantDeployMap } from '../../componets/src/deployable';
import { configureBurnableItemEntity } from './burnableItems';
import { TILE_SIZE } from './tile';
import type { SoundEventPath } from './sound';

/** plantables.lua: actual inventory prefab, separate grass bank / monkeytail build, medium spacing. */
export const PLANTABLES: Readonly<Record<string, { prefab: string; bank: string; build: string; animation: string;
  animationArchive?: string; spacing?: number; plantSound?: SoundEventPath }>> = {
  rock_avocado_fruit_sprout: { prefab: 'rock_avocado_fruit_sprout_sapling', bank: 'rock_avo_fruit_master',
    build: 'rock_avocado_fruit_build', animationArchive: 'rock_avocado_fruit.zip', animation: 'idle_buried_seed',
    spacing: 2 * (TILE_SIZE / 4), plantSound: 'dontstarve/wilson/plant_tree' },
  // marblebean.lua: MakePlacer("marblebean_placer", "marblebean", "marblebean", "idle_planted"); default deploy spacing.
  marblebean: { prefab: 'marblebean_sapling', bank: 'marblebean', build: 'marblebean', animationArchive: 'marblebean.zip',
    animation: 'idle_planted', spacing: 2 * (TILE_SIZE / 4), plantSound: 'dontstarve/wilson/plant_tree' },
  dug_rock_avocado_bush: { prefab: 'rock_avocado_bush', bank: 'rock_avocado', build: 'rock_avocado_build', animation: 'dead1', spacing: 2 * (TILE_SIZE / 4) },
  dug_berrybush: { prefab: 'berrybush', bank: 'berrybush', build: 'berrybush', animation: 'dead', spacing: 2 * (TILE_SIZE / 4) },
  dug_monkeytail: { prefab: 'monkeytail', bank: 'grass', build: 'reeds_monkeytails', animation: 'idle' },
};
export function configurePlantableEntity(entity: ItemEntity): void {
  if (!PLANTABLES[entity.prefab] || entity.components.deployable) return;
  configureBurnableItemEntity(entity);
  entity.addTag('deployedplant');
  entity.components.deployable = entity.component('deployable', () => new Deployable<PlantDeployMap>(entity, (point, _deployer, map) => {
    if (!map.deployPlant(point, entity)) return false;
    entity.remove();
    return true;
  }, { mode: 'PLANT', spacing: PLANTABLES[entity.prefab].spacing ?? TILE_SIZE / 4 }));
}
