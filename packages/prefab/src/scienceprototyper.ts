import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { Workable } from '../../componets/src/workable';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance } from './prefabInstance';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, LoadBuildingSkin, SaveBuildingSkin, type BuildingDeclaration } from './building';
import type { BuildingPlacerSpec } from './buildingPlacer';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree, type TechTree } from '../../componets/src/techtree';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt, WORLD_SCALE } from './standardcomponents';
import type { PlacementSaveRecord } from './saveRecord';
import { PlaySound } from './sound';
import { BurnableBinding } from './treeFire';
import type { PrefabWorldContext } from './worldContext';
import { MAGIC_PROTOTYPERS } from './magicprototyper';

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

/** onsave/onload, with the skin the building save shape keeps beside data.burnt. */
function onsave(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    SaveBuildingSkin(inst, data);
    onsaveBurnt(inst, data);
}

function onload(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    LoadBuildingSkin(inst, data);
    onloadBurnt(inst, data);
}

/**
 * scienceprototyper.lua createmachine(level, name, soundprefix, techtree, giftsound). The use animation and its sounds,
 * gifts, the wardrobe, the place sound and the achievement are not ported.
 */
function createmachine(level: 1 | 2, name: ScienceMachineId, soundprefix: 'lvl1' | 'lvl2', techtree: Readonly<TechTree>) {
    const declaration: BuildingDeclaration = definitions.animatedBuildings[name];

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

    function fn(world: PrefabWorldContext): PrefabInstance {
        const { fire, scheduler } = world;
        if (!fire || !scheduler) throw new Error(`A ${name} needs the world's fire effects and scheduler`);
        const inst = new PrefabInstance(name, new SpriteState({ name: 'idle', billboard: true }));
        inst.worldServices = world;
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

        // MakeLargeBurnable(inst, nil, nil, true) and MakeLargePropagator.
        const burn = new BurnableBinding(inst, {
            burnTime: 30, fxLevel: 4, propagator: 'large',
            onExtinguish: () => { PlaySound('dontstarve/common/fireOut', inst.position); },
            onBurnt: () => { DefaultBurntStructureFn(inst); burn.dispose(); },
        }, { fire, scheduler });
        inst.onRemove(() => burn.dispose());

        inst.OnSave = onsave;
        inst.OnLoad = onload;
        return inst;
    }

    return {
        placer: buildingPlacer(declaration),
        prefab: (world: PrefabWorldContext) => buildingPrefab(declaration, name, .4, () => fn(world), world),
    };
}

/** TUNING.PROTOTYPER_TREES.SCIENCEMACHINE / ALCHEMYMACHINE, with magicprototyper.lua's two stations. */
const RESEARCH_LABS = {
    researchlab: createmachine(1, 'researchlab', 'lvl1', { SCIENCE: 1, MAGIC: 1 }),
    researchlab2: createmachine(2, 'researchlab2', 'lvl2', { SCIENCE: 2, MAGIC: 1 }),
    ...MAGIC_PROTOTYPERS,
} as const;

/** MakePlacer("<name>_placer", name, name, "idle") for each station. */
export const RESEARCH_LAB_PLACERS: Readonly<Record<ResearchLabId, BuildingPlacerSpec>> = Object.fromEntries(
    RESEARCH_LAB_IDS.map(id => [id, RESEARCH_LABS[id].placer])) as Record<ResearchLabId, BuildingPlacerSpec>;

export function researchLabPrefabs(world: PrefabWorldContext) {
    return Object.fromEntries(RESEARCH_LAB_IDS.map(id => [id, RESEARCH_LABS[id].prefab(world)])) as
        Record<ResearchLabId, ReturnType<typeof RESEARCH_LABS[ResearchLabId]['prefab']>>;
}

export function isResearchLabId(value: string): value is ResearchLabId {
    return RESEARCH_LAB_IDS.some((researchLabId) => researchLabId === value);
}
