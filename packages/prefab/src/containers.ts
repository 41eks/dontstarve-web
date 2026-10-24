import definitions from './definitions.json' with { type: 'json' };
import { ItemEntity, PreparedFoodSlot, StorageSlot, type ItemSlot, type InventoryStack } from '@dontstarve-web/inventory';
import { Container } from '../../componets/src/container';
import { IsCookingIngredient } from '../../componets/src/cooking';
import { isBookCabinetItem } from './books';
import { setModelTag } from './prefabInstance';
import type { Object3D } from 'three';

export type BuildingContainer = Container<InventoryStack, ItemEntity, ItemSlot>;

export function createBuildingContainer(prefab: StorageBuildingId, inst: object): BuildingContainer {
    if (prefab === 'icebox') {
        const holder = inst as { addTag?(tag: string): void; tags?: Set<string>; userData?: object };
        if (holder.addTag) holder.addTag('fridge');
        else if (holder.userData) setModelTag(holder as Object3D, 'fridge', true);
        else (holder.tags ??= new Set()).add('fridge');
    }
    const definition = buildingContainerDefinition(prefab);
    const container = new Container<InventoryStack, ItemEntity, ItemSlot>(inst,
        () => definition.singleItems ? new PreparedFoodSlot(null, (_spec, itemId) => prefab !== 'cookpot' || (itemId !== undefined && IsCookingIngredient(itemId)))
            // containers.lua params.bookstation.itemtestfn: item:HasTag("bookcabinet_item").
            : new StorageSlot(null, prefab === 'bookstation' ? (_spec, itemId) => itemId !== undefined && isBookCabinetItem(itemId) : undefined),
        record => new ItemEntity(record));
    container.SetNumSlots(definition.slotCount);
    return container;
}

export interface BuildingContainerDefinition {
    slotCount: number;
    columns: number;
    singleItems: boolean;
    panelArchive?: string;
    /** Lua widget.slotpos grid, in source UI pixels with positive Y pointing up. */
    slotGrid?: { x: number; y: number; columnSpacing: number; rowSpacing: number };
}

export const STORAGE_BUILDING_IDS = [
    'treasurechest', 'icebox', 'cookpot', 'dragonflychest', 'saltbox', 'mushroom_light', 'mushroom_light2', 'bookstation',
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
