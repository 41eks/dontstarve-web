import definitions from './definitions.json' with { type: 'json' };
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
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

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

function onturnon({ animation }: AnimatedBuildingEventContext): void {
    animation.start('proximity_loop');
}

function onturnoff({ animation }: AnimatedBuildingEventContext): void {
    animation.start('idle');
}

export const RESEARCH_LAB_DEFINITIONS: Readonly<Record<ResearchLabId, AnimatedBuildingDefinition>> = {
    researchlab: { ...definitions.animatedBuildings.researchlab, onbuilt, onturnon, onturnoff },
    researchlab2: { ...definitions.animatedBuildings.researchlab2, onbuilt, onturnon, onturnoff },
    researchlab3: { ...definitions.animatedBuildings.researchlab3, onbuilt, onturnon, onturnoff },
    researchlab4: { ...definitions.animatedBuildings.researchlab4, onbuilt, onturnon, onturnoff },
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
