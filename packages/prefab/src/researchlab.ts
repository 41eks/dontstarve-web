import definitions from './definitions.json' with { type: 'json' };
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingDefinition,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';

export const RESEARCH_LAB_IDS = [
    'researchlab',
    'researchlab2',
    'researchlab3',
    'researchlab4',
] as const;

export type ResearchLabId = typeof RESEARCH_LAB_IDS[number];

export const RESEARCH_LAB_SKIN_ARCHIVES: Readonly<Record<ResearchLabId, Readonly<Record<string, string>>>> = {
    researchlab: definitions.animatedBuildings.researchlab.skinArchives,
    researchlab2: definitions.animatedBuildings.researchlab2.skinArchives,
    researchlab3: definitions.animatedBuildings.researchlab3.skinArchives,
    researchlab4: definitions.animatedBuildings.researchlab4.skinArchives,
};

export const RESEARCH_LAB_DEFINITIONS: Readonly<Record<ResearchLabId, AnimatedBuildingDefinition>> = {
    researchlab: definitions.animatedBuildings.researchlab,
    researchlab2: definitions.animatedBuildings.researchlab2,
    researchlab3: definitions.animatedBuildings.researchlab3,
    researchlab4: definitions.animatedBuildings.researchlab4,
};

export function isResearchLabId(value: string): value is ResearchLabId {
    return RESEARCH_LAB_IDS.some((researchLabId) => researchLabId === value);
}

export class ResearchLabPlacement extends AnimatedBuildingPlacement<ResearchLabId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: ResearchLabId) => boolean,
    ) {
        super(
            world,
            RESEARCH_LAB_DEFINITIONS,
            consumeBufferedBuild,
        );
    }
}
