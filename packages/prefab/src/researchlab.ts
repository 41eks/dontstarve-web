import * as THREE from 'three';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';

export const RESEARCH_LAB_IDS = [
    'researchlab',
    'researchlab2',
    'researchlab3',
    'researchlab4',
] as const;

export type ResearchLabId = typeof RESEARCH_LAB_IDS[number];

export const RESEARCH_LAB_DEFINITIONS: Readonly<Record<ResearchLabId, AnimatedBuildingDefinition>> = {
    researchlab: {
        archive: 'researchlab.zip',
        buildLabel: '科学机器',
        name: 'ResearchLab',
        proximityAnimation: 'proximity_loop',
        scale: 0.016,
    },
    researchlab2: {
        archive: 'researchlab2.zip',
        buildLabel: '炼金引擎',
        name: 'ResearchLab2',
        proximityAnimation: 'proximity_loop',
        scale: 0.02,
    },
    researchlab3: {
        archive: 'researchlab3.zip',
        buildLabel: '暗影操控器',
        name: 'ResearchLab3',
        proximityAnimation: 'proximity_loop',
        scale: 0.02,
    },
    researchlab4: {
        archive: 'researchlab4.zip',
        buildLabel: '灵子分解器',
        name: 'ResearchLab4',
        proximityAnimation: 'proximity_loop',
        scale: 0.02,
    },
};

export function isResearchLabId(value: string): value is ResearchLabId {
    return RESEARCH_LAB_IDS.some((researchLabId) => researchLabId === value);
}

export class ResearchLabPlacement extends AnimatedBuildingPlacement<ResearchLabId> {
    constructor(
        scene: THREE.Scene,
        camera: THREE.Camera,
        renderer: THREE.WebGLRenderer,
        ground: THREE.Object3D,
        player: THREE.Object3D,
        consumeBufferedBuild: (buildId: ResearchLabId) => boolean,
    ) {
        super(
            scene,
            camera,
            renderer,
            ground,
            player,
            RESEARCH_LAB_DEFINITIONS,
            consumeBufferedBuild,
        );
    }
}