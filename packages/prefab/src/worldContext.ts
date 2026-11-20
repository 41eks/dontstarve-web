import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { ActionWorldContext } from '@dontstarve-web/stategraphs/actionContext';
import type { EventEmitter, WorldContentContext } from '@dontstarve-web/signals';
import type { ToolMouseTargetWorld } from './toolMouseTarget';

/** Discrete requests emitted by prefabs; the running scene owns the handlers. */
export interface WorldEvents {
    spawnAsh: THREE.Vector3;
    itemplanted: { doer: unknown; pos: THREE.Vector3 };
    plantkilled: { doer: import('@dontstarve-web/stategraphs/pick').PickActor | undefined; pos: THREE.Vector3 };
}
export type WorldEventEmitter = EventEmitter<WorldEvents>;

/**
 * Application inputs for placement wiring. The scene is handed directly to display owners during
 * construction; retained prefab services and behavior callbacks use PrefabWorldContext without it.
 */
export interface WorldContext extends ActionWorldContext, Partial<WorldContentContext>, ToolMouseTargetWorld {
    worldEvents?: WorldEventEmitter;
    /** FACING_* bit that the camera heading gives an eight-faced inst with rotation 0. */
    cameraFacing: import('@dontstarve-web/signals').ReadonlySignal<number>;
    /** TheCamera:GetHeading() in degrees. */
    cameraHeading: import('@dontstarve-web/signals').ReadonlySignal<number>;
    /** TheCamera's ground vectors: GetDownVec / GetRightVec. */
    TheCamera: import('./followcamera').TheCamera;
    /** TheWorld.Pathfinder. */
    pathfinder?: import('./pathfinder').Pathfinder;
    /** The host's physics world, for prefabs that own static obstacle bodies. */
    physics?: CANNON.World;
    itemEntities?: import('@dontstarve-web/inventory').ItemEntityRegistry;
    /** GetLocalTemperature at a DST ground position, in scene units. */
    getLocalTemperature?: (x: number, z: number) => number;
    dynamicMusic?: import('../../componets/src/dynamicmusic').DynamicMusic;
    registerContainer?: (id: string, container: import('./containers').BuildingContainer) => void;
    unregisterContainer?: (id: string, container: import('./containers').BuildingContainer) => void;
    /** The application's storage panel follows a building's onopen and onclose. */
    onContainerInteraction?: (change: { buildId: string; isOpen: boolean; model: import('three').Group }) => void;
    /** TheWorld.state.israining / precipitationrate. */
    weather?: { readonly preciptype: import('@dontstarve-web/signals').ReadonlySignal<'none' | 'rain' | 'snow'>; readonly precipitationRate: import('@dontstarve-web/signals').ReadonlySignal<number> };
    /** SpawnPrefab("fire") for what burns; the world's shared fire art and firefx updates. */
    fire?: import('./treeFire').FireFxHost;
    /** Seconds from `now` (scheduler time) to the next day boundary: the delay of a WatchWorldState("cycles") timer. */
    secondsUntilNextDay?: (now: number) => number;
    /** SpawnPrefab for transient fx.lua prefabs; their display loads the art. */
    fx?: Pick<import('./world_fx').WorldFx, 'spawn'> & Partial<Pick<import('./world_fx').WorldFx, 'collapse'>>;
    /** TheWorld.state.isnight. */
    isNight?: import('@dontstarve-web/signals').ReadonlySignal<boolean>;
    /** SpawnPrefab for an inventory item: a configured inst that nothing owns yet. */
    spawnItem?: (state: import('@dontstarve-web/inventory').InventoryStack) => import('@dontstarve-web/inventory').ItemEntity;
    /** SpawnSaveRecord of an item a container or inventory held: a configured inst that nothing owns yet. */
    restoreItem?: (record: import('./saveRecord').HeldEntityRecord) => import('@dontstarve-web/inventory').ItemEntity;
    /** SpawnPrefab for a planted crop; the farm prefab owner creates its logical instance and display. */
    spawnFarmPlant?: import('../../componets/src/farmplantable').FarmPlantWorld['spawnFarmPlant'];
    /** inventoryitem:OnDropped for an existing inst, placed on the ground at the position. */
    dropItem?: (entity: import('@dontstarve-web/inventory').ItemEntity, position: ReadonlyVector3) => void;
    /** Place destruction loot in the application's authoritative ground-item store. */
    dropLoot?: (items: readonly { itemId: string; count: number; skinId?: string }[], position: ReadonlyVector3,
        launch?: () => import('../../componets/src/inventoryphysics').LootLaunch) => void;
}

/** The subset a prefab needs to turn raw pointer events into raycasts. */
export type PointerContext = Pick<WorldContext, 'camera' | 'renderer'>;

/** Long-lived prefab services exclude the application-owned scene. */
export type PrefabWorldContext = Omit<WorldContext, 'scene'>;

/** SpawnPrefab of an item a prefab loads or makes, in the inst's own world; an inst outside a world cannot hold one. */
export function spawnWorldItem(inst: { readonly prefab: string; readonly worldServices?: Pick<WorldContext, 'spawnItem'> },
    state: import('@dontstarve-web/inventory').InventoryStack): import('@dontstarve-web/inventory').ItemEntity {
    const spawn = inst.worldServices?.spawnItem;
    if (!spawn) throw new Error(`${inst.prefab} has no world to spawn ${state.itemId} in`);
    return spawn(state);
}

/** SpawnSaveRecord of an item a prefab loads into a container or inventory, in the inst's own world. */
export function restoreWorldItem(inst: { readonly prefab: string; readonly worldServices?: Pick<WorldContext, 'restoreItem'> },
    record: import('./saveRecord').HeldEntityRecord): import('@dontstarve-web/inventory').ItemEntity {
    const restore = inst.worldServices?.restoreItem;
    if (!restore) throw new Error(`${inst.prefab} has no world to load ${record.prefab} in`);
    return restore(record);
}
