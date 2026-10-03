import definitions from './definitions.json' with { type: 'json' };

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
