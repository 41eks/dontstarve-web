import definitions from './definitions.json' with { type: 'json' };
import { restoreWorldItem, spawnWorldItem } from './worldContext';
import { type ItemEntity, PreparedFoodSlot, StorageSlot, type ItemSlot, type InventoryStack } from '@dontstarve-web/inventory';
import { Container } from '../../componets/src/container';
import { IsCookingIngredient } from '../../componets/src/cooking';
import { isBookCabinetItem } from './books';
import { PrefabInstance } from './prefabInstance';
import { addComponent, removeComponent } from './components';

export type BuildingContainer = Container<InventoryStack, ItemEntity, ItemSlot>;

/** AddComponent("container") on a storage building, with containers.lua's widget setup for its prefab. */
export function createBuildingContainer(prefab: StorageBuildingId, inst: PrefabInstance): BuildingContainer {
    if (prefab === 'icebox') inst.addTag('fridge');
    const definition = buildingContainerDefinition(prefab);
    const createSlot = () => definition.singleItems ? new PreparedFoodSlot((_spec, itemId) => prefab !== 'cookpot' || (itemId !== undefined && IsCookingIngredient(itemId)))
            // containers.lua params.bookstation.itemtestfn: item:HasTag("bookcabinet_item").
            : new StorageSlot(prefab === 'bookstation' ? (_spec, itemId) => itemId !== undefined && isBookCabinetItem(itemId) : undefined);
    // SpawnSaveRecord of each content, in the building's world.
    const loadItem = (record: InventoryStack) => spawnWorldItem(inst, record);
    const container = addComponent(inst, 'container', Container<InventoryStack, ItemEntity, ItemSlot>, createSlot, loadItem,
        record => restoreWorldItem(inst, record));
    container.type = definition.type;
    container.SetNumSlots(definition.slotCount);
    return container;
}

/** RemoveComponent("container") for a building, together with the slots registered in the world's inventory. */
export function releaseBuildingContainer(inst: PrefabInstance): void {
    const container: BuildingContainer | undefined = inst.components.container;
    if (!container) return;
    inst.worldServices?.unregisterContainer?.(`world:${inst.prefab}:${String(inst.entityId)}`, container);
    removeComponent(inst, 'container');
}

export interface BuildingContainerDefinition {
    /** containers.lua params[prefab].type. */
    type: string;
    slotCount: number;
    columns: number;
    singleItems: boolean;
    panelArchive?: string;
    /** Lua widget.slotpos grid, in source UI pixels with positive Y pointing up. */
    slotGrid?: { x: number; y: number; columnSpacing: number; rowSpacing: number };
}

/** Where a container's panel sits on screen; this project's layout, with no counterpart in containers.lua. */
export type ContainerPanelAnchor = 'player-top' | 'player-right' | 'building-right';

export const STORAGE_BUILDING_IDS = [
    'treasurechest', 'pandoraschest', 'icebox', 'cookpot', 'dragonflychest', 'saltbox', 'mushroom_light', 'mushroom_light2', 'bookstation',
] as const;
export type StorageBuildingId = typeof STORAGE_BUILDING_IDS[number];

export function isStorageBuildingId(value: string): value is StorageBuildingId {
    return STORAGE_BUILDING_IDS.some((id) => id === value);
}

export function buildingContainerDefinition(prefab: StorageBuildingId): BuildingContainerDefinition {
    return definitions.animatedBuildings[prefab].container;
}

const PANEL_ANCHORS: Partial<Record<StorageBuildingId, ContainerPanelAnchor>> = {
    cookpot: 'player-right', mushroom_light: 'building-right', mushroom_light2: 'building-right',
};

export function containerPanelAnchor(prefab: StorageBuildingId): ContainerPanelAnchor {
    return PANEL_ANCHORS[prefab] ?? 'player-top';
}

export function buildingContainerId(prefab: StorageBuildingId, entityId: string): string {
    return `world:${prefab}:${entityId}`;
}
