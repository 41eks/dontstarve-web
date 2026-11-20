import definitions from './definitions.json' with { type: 'json' };
import { restoreWorldItem, spawnWorldItem } from './worldContext';
import { type ItemEntity, PreparedFoodSlot, StorageSlot, type ItemSlot, type InventoryStack } from '@dontstarve-web/inventory';
import { Container } from '../../componets/src/container';
import { IsCookingIngredient } from '../../componets/src/cooking';
import { isBookCabinetItem } from './books';
import itemCatalog from './groundItems.json' with { type: 'json' };
import { PrefabInstance } from './prefabInstance';
import { addComponent, removeComponent } from './components';

export type BuildingContainer = Container<InventoryStack, ItemEntity, ItemSlot>;

/** AddComponent("container") on a storage building, with containers.lua's widget setup for its prefab. */
export function createBuildingContainer(prefab: StorageBuildingId, inst: PrefabInstance): BuildingContainer {
    if (prefab === 'icebox') { inst.addTag('fridge'); }
    const definition = buildingContainerDefinition(prefab);
    const createSlot = () => definition.singleItems ? new PreparedFoodSlot((_spec, itemId) => prefab !== 'cookpot' || (itemId !== undefined && IsCookingIngredient(itemId)))
            // containers.lua params.bookstation.itemtestfn: item:HasTag("bookcabinet_item").
            : new StorageSlot(prefab === 'bookstation' ? (_spec, itemId) => itemId !== undefined && isBookCabinetItem(itemId)
                // params.dragonflyfurnace.itemtestfn: not item:HasTag("irreplaceable").
                : prefab === 'dragonflyfurnace' ? (_spec, itemId) => itemId === undefined || !isIrreplaceable(itemId) : undefined);
    // SpawnSaveRecord of each content, in the building's world.
    const loadItem = (record: InventoryStack) => spawnWorldItem(inst, record);
    const container = addComponent(inst, 'container', Container<InventoryStack, ItemEntity, ItemSlot>, createSlot, loadItem,
        record => restoreWorldItem(inst, record));
    container.type = definition.type;
    container.SetNumSlots(definition.slotCount);
    return container;
}

/** The item prefabs whose catalog entry declares the "irreplaceable" tag. */
const IRREPLACEABLE_ITEMS: ReadonlySet<string> = new Set(Object.entries({ ...itemCatalog.items, ...itemCatalog.staticItems })
    .filter(([, item]) => 'tags' in item && (item.tags as readonly string[]).includes('irreplaceable')).map(([id]) => id));
const isIrreplaceable = (itemId: string) => IRREPLACEABLE_ITEMS.has(itemId);

/** RemoveComponent("container") for a building, together with the slots registered in the world's inventory. */
export function releaseBuildingContainer(inst: PrefabInstance): void {
    const container: BuildingContainer | undefined = inst.components.container;
    if (!container) { return; }
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
    /** widget.slotbg: every slot's background image. */
    slotBackground?: { asset: string; atlas: string };
    /** widget.buttoninfo: the panel button's action, its STRINGS.ACTIONS text and which validfn enables it. */
    button?: ContainerButtonInfo;
}

/** The actions a container widget's button performs. */
export type ContainerButtonAction = 'COOK' | 'INCINERATE';

/**
 * containers.lua widget.buttoninfo. validfn: `full` is the cooker's container:IsFull(), `notempty` the furnace's
 * not container:IsEmpty().
 */
export interface ContainerButtonInfo {
    action: ContainerButtonAction;
    text: string;
    validfn: 'full' | 'notempty';
    /** buttoninfo.position.y, in source UI pixels with positive Y pointing up. */
    y: number;
}

/** Where a container's panel sits on screen; this project's layout, with no counterpart in containers.lua. */
export type ContainerPanelAnchor = 'player-top' | 'player-right' | 'building-right';

export const STORAGE_BUILDING_IDS = [
    'treasurechest', 'pandoraschest', 'icebox', 'cookpot', 'dragonflychest', 'saltbox', 'mushroom_light', 'mushroom_light2', 'bookstation',
    'dragonflyfurnace',
] as const;
export type StorageBuildingId = typeof STORAGE_BUILDING_IDS[number];

export function isStorageBuildingId(value: string): value is StorageBuildingId {
    return STORAGE_BUILDING_IDS.some((id) => id === value);
}

export function buildingContainerDefinition(prefab: StorageBuildingId): BuildingContainerDefinition {
    const { button, ...container }: Omit<BuildingContainerDefinition, 'button'> & { button?: RawButtonInfo } =
        definitions.animatedBuildings[prefab].container;
    return button ? { ...container, button: containerButtonInfo(prefab, button) } : container;
}

interface RawButtonInfo { action: string; text: string; validfn: string; y: number }

function containerButtonInfo(prefab: string, { action, text, validfn, y }: RawButtonInfo): ContainerButtonInfo {
    if ((action !== 'COOK' && action !== 'INCINERATE') || (validfn !== 'full' && validfn !== 'notempty')) {
        throw new Error(`${prefab}: unsupported container button ${action} / ${validfn}`);
    }
    return { action, text, validfn, y };
}

const PANEL_ANCHORS: Partial<Record<StorageBuildingId, ContainerPanelAnchor>> = {
    cookpot: 'player-right', dragonflyfurnace: 'player-right', mushroom_light: 'building-right', mushroom_light2: 'building-right',
};

export function containerPanelAnchor(prefab: StorageBuildingId): ContainerPanelAnchor {
    return PANEL_ANCHORS[prefab] ?? 'player-top';
}

export function buildingContainerId(prefab: StorageBuildingId, entityId: string): string {
    return `world:${prefab}:${entityId}`;
}
