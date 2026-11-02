import type { ItemEntity } from '@dontstarve-web/inventory';
import { Deployable, type DeployPlacerArt } from '../../componets/src/deployable';
import { configureBurnableItemEntity } from './burnableItems';
import { TILE_SIZE } from './tile';
import { PlaySound } from './sound';

/** plantables.lua's table: the planted prefab, separate grass bank / monkeytail build, and default or medium spacing. */
const PLANTABLES: Readonly<Record<string, DeployPlacerArt & { prefab: string; spacing?: number }>> = {
  dug_rock_avocado_bush: { prefab: 'rock_avocado_bush', bank: 'rock_avocado', build: 'rock_avocado_build', animation: 'dead1', spacing: 2 * (TILE_SIZE / 4) },
  dug_berrybush: { prefab: 'berrybush', bank: 'berrybush', build: 'berrybush', animation: 'dead', spacing: 2 * (TILE_SIZE / 4) },
  dug_monkeytail: { prefab: 'monkeytail', bank: 'grass', build: 'reeds_monkeytails', animation: 'idle' },
  dug_grass: { prefab: 'grass', bank: 'grass', build: 'grass1', animation: 'idle' },
  dug_sapling: { prefab: 'sapling', bank: 'sapling', build: 'sapling', animation: 'idle' },
  dug_sapling_moon: { prefab: 'sapling_moon', bank: 'sapling_moon', build: 'sapling_moon', animation: 'idle' },
};

/** plantables.lua make_plantable: deployedplant, deployable(PLANT) and its ondeploy. */
export function configurePlantableEntity(entity: ItemEntity): void {
  const data = PLANTABLES[entity.prefab];
  if (!data || entity.components.deployable) return;
  configureBurnableItemEntity(entity);
  entity.addTag('deployedplant');
  entity.components.deployable = entity.component('deployable', () => new Deployable(entity, (point, deployer, map) => {
    // SpawnPrefab(data.name, inst.linked_skinname, inst.skin_id): dug_<skin> links to the plant's <skin>.
    const tree = map.SpawnPrefab(data.prefab, point, entity.skinId?.replace(/^dug_/, ''));
    if (!tree) return false;
    entity.remove();
    tree.components.pickable?.OnTransplant();
    PlaySound('dontstarve/common/plant', deployer.position);
    return true;
  }, { mode: 'PLANT', spacing: data.spacing ?? TILE_SIZE / 4, placer: data }));
}
