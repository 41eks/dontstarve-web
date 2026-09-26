import * as THREE from 'three';
import { AnimatedBuildingPlacement } from '@three-roaming/prefab/animatedBuildingPlacement';
import {
    RESEARCH_LAB_DEFINITIONS,
    RESEARCH_LAB_IDS,
    type ResearchLabId,
} from '@three-roaming/prefab/researchlab';

export const TREASURE_CHEST_ID = 'treasurechest' as const;
export const TENT_ID = 'tent' as const;

export type PlaceableBuildingId = ResearchLabId | typeof TREASURE_CHEST_ID | typeof TENT_ID;

const PLACEABLE_BUILDING_IDS: readonly PlaceableBuildingId[] = [
    ...RESEARCH_LAB_IDS,
    TREASURE_CHEST_ID,
    TENT_ID,
];

const PLACEABLE_BUILDING_DEFINITIONS = {
    ...RESEARCH_LAB_DEFINITIONS,
    treasurechest: {
        archive: 'treasure_chest.zip',
        buildLabel: '箱子',
        idleAnimation: 'closed',
        name: 'TreasureChest',
        scale: 0.02,
    },
    tent: {
        archive: 'tent.zip',
        buildLabel: '帐篷',
        name: 'Tent',
        scale: 0.02,
    },
} as const;

export function isPlaceableBuildingId(value: string): value is PlaceableBuildingId {
    return PLACEABLE_BUILDING_IDS.some((buildingId) => buildingId === value);
}

export class PlaceableBuildingPlacement extends AnimatedBuildingPlacement<PlaceableBuildingId> {
    constructor(
        scene: THREE.Scene,
        camera: THREE.Camera,
        renderer: THREE.WebGLRenderer,
        ground: THREE.Object3D,
        player: THREE.Object3D,
        consumeBufferedBuild: (buildId: PlaceableBuildingId) => boolean,
    ) {
        super(
            scene,
            camera,
            renderer,
            ground,
            player,
            PLACEABLE_BUILDING_DEFINITIONS,
            consumeBufferedBuild,
        );
    }
}
