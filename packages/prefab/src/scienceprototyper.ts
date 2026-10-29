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
import { PlaySound, type SoundHandle } from './sound';
import type { Group } from 'three';
import { actionEntity } from './actionEntity';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree } from '../../componets/src/techtree';
import { WORLD_SCALE } from './standardcomponents';
import type { SpriteController } from '@dontstarve-web/animation/sprite';

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

const idleSoundPaths = {
    researchlab: 'dontstarve/common/researchmachine_lvl1_idle_LP',
    researchlab2: 'dontstarve/common/researchmachine_lvl2_idle_LP',
    researchlab3: 'dontstarve/common/researchmachine_lvl3_idle_LP',
    researchlab4: 'dontstarve/common/researchmachine_lvl4_idle_LP',
} as const;
const idleSounds = new WeakMap<Group, SoundHandle>();

function stopIdleSound(model: Group): void {
    idleSounds.get(model)?.stop();
    idleSounds.delete(model);
}

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', onComplete);
    (animation as SpriteController).pushAnimation('idle');
}

function onturnon(id: ResearchLabId, { model, animation }: AnimatedBuildingEventContext): void {
    if (actionEntity(model, id).hasTag('burnt')) return;
    const controller = animation as SpriteController;
    if (id === 'researchlab3' && controller.currentAnimation !== 'proximity_loop') {
        if (controller.currentAnimation === 'place') controller.pushAnimation('proximity_pre');
        else controller.playOnce('proximity_pre');
        controller.pushAnimation('proximity_loop', true);
    } else if (id !== 'researchlab3' && (controller.currentAnimation === 'place' || controller.currentAnimation === 'proximity_loop')) {
        controller.pushAnimation('proximity_loop', true);
    } else controller.start('proximity_loop');
    if (!idleSounds.get(model)?.isPlaying()) idleSounds.set(model, PlaySound(idleSoundPaths[id], model.position));
}

function onturnoff(id: ResearchLabId, { model, animation }: AnimatedBuildingEventContext): void {
    stopIdleSound(model);
    if (actionEntity(model, id).hasTag('burnt')) return;
    if (id === 'researchlab' || id === 'researchlab2') animation.playOnce('idle');
    else {
        const controller = animation as SpriteController;
        if (id === 'researchlab3') controller.pushAnimation('proximity_pst');
        controller.pushAnimation('idle');
    }
}

function onhit({ model, animation }: AnimatedBuildingHammerContext): void {
    // scienceprototyper.lua and magicprototyper.lua: hit, then the on/off loop.
    const on = model.userData.components?.prototyper?.on === true;
    animation.playOnce('hit');
    (animation as SpriteController).pushAnimation(on ? 'proximity_loop' : 'idle', on);
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
    const levels = {
        researchlab: { SCIENCE: 1, MAGIC: 1 }, researchlab2: { SCIENCE: 2, MAGIC: 1 },
        researchlab3: { MAGIC: 3 }, researchlab4: { MAGIC: 2 },
    };
    return {
        ...definitions.animatedBuildings[id], obstacleRadius: .4, onProximity: false, onbuilt, onhit,
        oninit: (context) => {
            const inst = actionEntity(context.model, id);
            inst.addTag('structure');
            inst.addTag(`level${RESEARCH_LAB_IDS.indexOf(id) + 1}`);
            const prototyper = new Prototyper(inst, 4 * WORLD_SCALE);
            prototyper.trees = CreateTechTree(levels[id]);
            // Skin replacement preserves the component and its users, but replaces the controller.
            const currentContext = () => ({ ...context,
                animation: context.model.userData.animationController as SpriteController });
            prototyper.onturnon = () => onturnon(id, currentContext());
            prototyper.onturnoff = () => onturnoff(id, currentContext());
            inst.components.prototyper = prototyper;
        },
        ondispose: ({ model }) => {
            const inst = actionEntity(model, id);
            inst.components.prototyper?.OnRemoveFromEntity();
            delete inst.components.prototyper;
            stopIdleSound(model);
        },
        hammerWorkLeft: 4,
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
