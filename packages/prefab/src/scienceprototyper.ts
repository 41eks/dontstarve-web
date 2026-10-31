import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import { type SpriteState } from '@dontstarve-web/display';
import { prefabInstance, type PrefabInstance } from './prefabInstance';
import definitions from './definitions.json' with { type: 'json' };
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { PlaySound, type SoundHandle } from './sound';
import type { Group } from 'three';
import { actionEntity } from './actionEntity';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree } from '../../componets/src/techtree';
import { WORLD_SCALE } from './standardcomponents';

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
    (animation as SpriteState).pushAnimation('idle');
}

function onturnon(id: ResearchLabId, { model, animation }: AnimatedBuildingEventContext): void {
    if (actionEntity(model, id).hasTag('burnt')) return;
    const controller = animation as SpriteState;
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
        const controller = animation as SpriteState;
        if (id === 'researchlab3') controller.pushAnimation('proximity_pst');
        controller.pushAnimation('idle');
    }
}

function onworked(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = inst.components.prototyper?.on === true;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation(on ? 'proximity_loop' : 'idle', on);
}

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

/** prefabskin.lua researchlab4_init_fn / researchlab4_clear_fn: only the hat comes from the skin build. */
const RESEARCHLAB4_SKIN: NonNullable<AnimatedBuildingDefinition['skinAnimState']> = {
    init: (anim, skinArchive) => anim.OverrideItemSkinSymbol('machine_hat', skinArchive, 'machine_hat', 'researchlab4', 'researchlab4'),
    clear: anim => anim.ClearOverrideSymbol('machine_hat'),
};

function researchLabDefinition(id: ResearchLabId): AnimatedBuildingDefinition {
    const levels = {
        researchlab: { SCIENCE: 1, MAGIC: 1 }, researchlab2: { SCIENCE: 2, MAGIC: 1 },
        researchlab3: { MAGIC: 3 }, researchlab4: { MAGIC: 2 },
    };
    return {
        ...definitions.animatedBuildings[id], obstacleRadius: .4, onbuilt,
        ...(id === 'researchlab4' ? { skinAnimState: RESEARCHLAB4_SKIN } : {}),
        oninit: (context) => {
            const workable = context.instance.components.workable = new Workable(context.instance);
            workable.SetWorkAction('HAMMER');
            workable.SetWorkLeft(4);
            workable.SetOnWorkCallback(onworked);
            workable.SetOnFinishCallback(onhammered);
            context.instance.components.lootdropper = createStructureLootDropper(context.instance);
            const inst = actionEntity(context.model, id);
            inst.addTag('structure');
            inst.addTag(`level${RESEARCH_LAB_IDS.indexOf(id) + 1}`);
            const prototyper = new Prototyper(inst, 4 * WORLD_SCALE);
            prototyper.trees = CreateTechTree(levels[id]);
            // Skin replacement preserves the component and its users, but replaces the controller.
            const currentContext = () => ({ ...context,
                animation: (prefabInstance(context.model)!.sprite as SpriteState) });
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
