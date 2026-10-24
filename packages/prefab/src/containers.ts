import definitions from './definitions.json' with { type: 'json' };
import { ItemEntity, PreparedFoodSlot, StorageSlot, type ItemSlot, type InventoryStack } from '@dontstarve-web/inventory';
import { Container } from '../../componets/src/container';
import { IsCookingIngredient } from '../../componets/src/cooking';

export type BuildingContainer = Container<InventoryStack, ItemEntity, ItemSlot>;

export function createBuildingContainer(prefab: StorageBuildingId, inst: object): BuildingContainer {
    const definition = buildingContainerDefinition(prefab);
    const container = new Container<InventoryStack, ItemEntity, ItemSlot>(inst,
        () => definition.singleItems ? new PreparedFoodSlot(null, (_spec, itemId) => prefab !== 'cookpot' || (itemId !== undefined && IsCookingIngredient(itemId))) : new StorageSlot(),
        record => new ItemEntity(record));
    container.SetNumSlots(definition.slotCount);
    return container;
}

export interface BuildingContainerDefinition {
    slotCount: number;
    columns: number;
    singleItems: boolean;
    panelArchive?: string;
}

export const STORAGE_BUILDING_IDS = [
    'treasurechest', 'icebox', 'cookpot', 'dragonflychest', 'saltbox', 'mushroom_light', 'mushroom_light2',
] as const;
export type StorageBuildingId = typeof STORAGE_BUILDING_IDS[number];

export function isStorageBuildingId(value: string): value is StorageBuildingId {
    return STORAGE_BUILDING_IDS.some((id) => id === value);
}

export function buildingContainerDefinition(prefab: StorageBuildingId): BuildingContainerDefinition {
    return definitions.animatedBuildings[prefab].container;
}

export function buildingContainerId(prefab: StorageBuildingId, entityId: string): string {
    return `world:${prefab}:${entityId}`;
}
