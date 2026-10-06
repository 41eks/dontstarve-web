import definitions from './definitions.json' with { type: 'json' };
import recipes from '@dontstarve-web/animation/recipes.json' with { type: 'json' };
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
    type AnimatedBuildingHammerContext,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { PlaySound, PreloadSounds } from './sound';

export const RESEARCH_LAB_IDS = [
    'researchlab',
    'researchlab2',
    'researchlab3',
    'researchlab4',
] as const;

export type ResearchLabId = typeof RESEARCH_LAB_IDS[number];

// lootdropper:GetRecipeLoot() rounds each ingredient up after applying
// tuning.lua's HAMMER_LOOT_PERCENT = 0.5. These four recipes do not deconstruct.
function researchLabLoot(id: ResearchLabId) {
    const recipe = recipes.recipes.find((recipe) => recipe.name === id);
    if (!recipe) throw new Error(`Missing recipe for ${id}`);
    return recipe.ingredients.map((ingredient) => {
        if (typeof ingredient.type !== 'string' || typeof ingredient.amount !== 'number') {
            throw new Error(`Unsupported loot ingredient for ${id}`);
        }
        return { itemId: ingredient.type, count: Math.ceil(ingredient.amount * 0.5) };
    });
}

export const RESEARCH_LAB_HAMMER_LOOT = {
    researchlab: researchLabLoot('researchlab'), researchlab2: researchLabLoot('researchlab2'),
    researchlab3: researchLabLoot('researchlab3'), researchlab4: researchLabLoot('researchlab4'),
} as const;

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

function onhit({ animation, isPlayerNearby }: AnimatedBuildingHammerContext): void {
    // scienceprototyper.lua and magicprototyper.lua: hit, then the on/off loop.
    animation.playOnce('hit', () => animation.start(isPlayerNearby ? 'proximity_loop' : 'idle'));
}

function onhammered(id: ResearchLabId, { position, dropLoot, spawnEffect, remove }: AnimatedBuildingHammerContext): void {
    dropLoot(RESEARCH_LAB_HAMMER_LOOT[id]);
    spawnEffect();
    // structure_collapse_fx.lua: collapse_small:SetMaterial("wood").
    PlaySound('dontstarve/common/destroy_smoke', position);
    PlaySound('dontstarve/common/destroy_wood', position);
    remove();
}

function researchLabDefinition(id: ResearchLabId): AnimatedBuildingDefinition {
    return {
        ...definitions.animatedBuildings[id], onbuilt, onturnon, onturnoff, onhit,
        hammerWorkLeft: 4,
        prepare: () => PreloadSounds('dontstarve/common/destroy_smoke', 'dontstarve/common/destroy_wood'),
        hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse_small' },
        onhammered: (context) => onhammered(id, context),
    };
}

export const RESEARCH_LAB_DEFINITIONS: Readonly<Record<ResearchLabId, AnimatedBuildingDefinition>> = {
    researchlab: researchLabDefinition('researchlab'),
    researchlab2: researchLabDefinition('researchlab2'),
    researchlab3: researchLabDefinition('researchlab3'),
    researchlab4: researchLabDefinition('researchlab4'),
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
