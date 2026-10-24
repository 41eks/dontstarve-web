import type * as CANNON from 'cannon-es';
import * as THREE from 'three';
import type { ActionWorldContext } from '@dontstarve-web/stategraphs/actionContext';
import type { EventEmitter, WorldContentContext } from '@dontstarve-web/signals';

/** Discrete requests emitted by prefabs; the running scene owns the handlers. */
export interface WorldEvents {
    spawnAsh: THREE.Vector3;
    plantkilled: { doer: import('@dontstarve-web/stategraphs/pick').PickActor | undefined; pos: THREE.Vector3 };
}
export type WorldEventEmitter = EventEmitter<WorldEvents>;

/**
 * Everything a prefab needs from the host application to place itself in the
 * running game. The application owns the scene graph, the camera, the renderer
 * and the ground, so prefabs receive them instead of creating their own.
 */
export interface WorldContext extends ActionWorldContext, Partial<WorldContentContext> {
    worldEvents?: WorldEventEmitter;
    /** FACING_* bit that the camera heading gives an eight-faced inst with rotation 0. */
    cameraFacing: import('@dontstarve-web/signals').ReadonlySignal<number>;
    /** TheCamera:GetHeading() in degrees. */
    cameraHeading: import('@dontstarve-web/signals').ReadonlySignal<number>;
    /** The host's physics world, for prefabs that own static obstacle bodies. */
    physics?: CANNON.World;
    itemEntities?: import('@dontstarve-web/inventory').ItemEntityRegistry;
    /** GetLocalTemperature at a DST ground position, in scene units. */
    getLocalTemperature?: (x: number, z: number) => number;
    dynamicMusic?: import('../../componets/src/dynamicmusic').DynamicMusic;
    registerContainer?: (id: string, container: import('./containers').BuildingContainer,
        saved?: { slots: readonly { slotKey: string; item: import('@dontstarve-web/inventory').InventoryStack }[] }) => void;
    unregisterContainer?: (id: string, container: import('./containers').BuildingContainer) => void;
    /** Seconds from `now` (scheduler time) to the next day boundary: the delay of a WatchWorldState("cycles") timer. */
    secondsUntilNextDay?: (now: number) => number;
    /** SpawnPrefab for the transient fx.lua prefabs: prepare loads art and sound, spawn plays them at a ground position. */
    fx?: Pick<import('./world_fx').WorldFx, 'prepare' | 'spawn'>;
    /** TheWorld.state.isnight. */
    isNight?: import('@dontstarve-web/signals').ReadonlySignal<boolean>;
    /** SpawnPrefab for an inventory item: a configured inst that nothing owns yet. */
    spawnItem?: (state: import('@dontstarve-web/inventory').InventoryStack) => import('@dontstarve-web/inventory').ItemEntity;
    /** inventoryitem:OnDropped for an existing inst, placed on the ground at the position. */
    dropItem?: (entity: import('@dontstarve-web/inventory').ItemEntity, position: THREE.Vector3) => void;
    /** Place destruction loot in the application's authoritative ground-item store. */
    dropLoot?: (items: readonly { itemId: string; count: number }[], position: THREE.Vector3,
        launch?: () => import('./lootFling').LootLaunch) => void;
}

/** The subset a prefab needs to turn raw pointer events into raycasts. */
export type PointerContext = Pick<WorldContext, 'camera' | 'renderer'>;
