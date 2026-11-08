import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { Workable } from '../../componets/src/workable';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import type { PrefabInstance } from './prefabInstance';
import definitions from './definitions.json' with { type: 'json' };
import { AnimatedBuildingPlacement, type AnimatedBuildingDefinition } from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree, type TechTree } from '../../componets/src/techtree';
import { onloadBurnt, onsaveBurnt, WORLD_SCALE } from './standardcomponents';
import { MAGIC_PROTOTYPER_DEFINITIONS } from './magicprototyper';

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

type ScienceMachineId = 'researchlab' | 'researchlab2';

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

/** onhit: the gift loop (isgifting) is not ported. */
function onhit(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = inst.components.prototyper?.on === true;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation(on ? 'proximity_loop' : 'idle', on);
}

function onturnoff(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.sprite.playOnce('idle');
    inst.SoundEmitter!.KillSound('idlesound');
    inst.SoundEmitter!.KillSound('loop');
}

/**
 * scienceprototyper.lua createmachine(level, name, soundprefix, techtree, giftsound). The use animation and its sounds,
 * gifts, the wardrobe, the place sound and the achievement are not ported.
 */
function createmachine(level: 1 | 2, name: ScienceMachineId, soundprefix: 'lvl1' | 'lvl2', techtree: Readonly<TechTree>): AnimatedBuildingDefinition {
    function onturnon(inst: PrefabInstance): void {
        if (inst.hasTag('burnt')) return;
        const anim = inst.sprite;
        if (anim.currentAnimation === 'proximity_loop' || anim.currentAnimation === 'place') {
            // Push again even if already playing, in case an idle was also pushed.
            anim.pushAnimation('proximity_loop', true);
        } else anim.start('proximity_loop');
        if (!inst.SoundEmitter!.PlayingSound('idlesound')) {
            inst.SoundEmitter!.KillSound('loop');
            inst.SoundEmitter!.PlaySound(`dontstarve/common/researchmachine_${soundprefix}_idle_LP`, 'idlesound');
        }
    }

    function onbuilt(inst: PrefabInstance): void {
        inst.sprite.playOnce('place');
        inst.sprite.pushAnimation('idle', false);
    }

    function fn(inst: PrefabInstance): void {
        inst.AddSoundEmitter();
        inst.addTag('giftmachine');
        inst.addTag('structure');
        inst.addTag(`level${level}`);

        const prototyper = addComponent(inst, 'prototyper', Prototyper, 4 * WORLD_SCALE);
        prototyper.onturnon = onturnon;
        prototyper.onturnoff = onturnoff;
        prototyper.trees = CreateTechTree(techtree);

        inst.ListenForEvent('onbuilt', () => onbuilt(inst));

        addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
        const workable = addComponent(inst, 'workable', Workable);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnFinishCallback(onhammered);
        workable.SetOnWorkCallback(onhit);

        inst.OnSave = onsaveBurnt;
        inst.OnLoad = onloadBurnt;
    }

    return {
        ...definitions.animatedBuildings[name], obstacleRadius: .4,
        // MakeLargeBurnable(inst, nil, nil, true) and MakeLargePropagator.
        burnable: { burnTime: 30, fxLevel: 4, propagator: 'large' },
        // AnimatedBuildingPlacement creates the entity; fn assembles it.
        oninit: ({ instance }) => fn(instance),
    };
}

/** TUNING.PROTOTYPER_TREES.SCIENCEMACHINE / ALCHEMYMACHINE, with magicprototyper.lua's two stations. */
export const RESEARCH_LAB_DEFINITIONS: Readonly<Record<ResearchLabId, AnimatedBuildingDefinition>> = {
    researchlab: createmachine(1, 'researchlab', 'lvl1', { SCIENCE: 1, MAGIC: 1 }),
    researchlab2: createmachine(2, 'researchlab2', 'lvl2', { SCIENCE: 2, MAGIC: 1 }),
    ...MAGIC_PROTOTYPER_DEFINITIONS,
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
