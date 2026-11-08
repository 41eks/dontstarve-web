import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { Workable } from '../../componets/src/workable';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import type { PrefabInstance } from './prefabInstance';
import definitions from './definitions.json' with { type: 'json' };
import type { AnimatedBuildingDefinition } from './animatedBuildingPlacement';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree, type TechTree } from '../../componets/src/techtree';
import { onloadBurnt, onsaveBurnt, WORLD_SCALE } from './standardcomponents';

export type MagicPrototyperId = 'researchlab3' | 'researchlab4';

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

function onhit(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = inst.components.prototyper?.on === true;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation(on ? 'proximity_loop' : 'idle', on);
}

/**
 * magicprototyper.lua createmachine(level, name, soundprefix, sounddelay, techtree, mergeanims, onact). The use animation,
 * its sounds, onact (spawnrabbits) and the delayed place sound are not ported.
 */
function createmachine(level: 3 | 4, name: MagicPrototyperId, soundprefix: 'lvl3' | 'lvl4', techtree: Readonly<TechTree>,
    mergeanims: boolean): AnimatedBuildingDefinition {
    function onturnon(inst: PrefabInstance): void {
        if (inst.hasTag('burnt')) return;
        const anim = inst.sprite;
        if (mergeanims) {
            // In case other animations were still in queue.
            if (anim.currentAnimation === 'proximity_loop') anim.start('proximity_loop');
            else {
                if (anim.currentAnimation === 'place') anim.pushAnimation('proximity_pre');
                else anim.playOnce('proximity_pre');
                anim.pushAnimation('proximity_loop', true);
            }
        } else if (anim.currentAnimation === 'proximity_loop' || anim.currentAnimation === 'place') {
            // Push again even if already playing, in case an idle was also pushed.
            anim.pushAnimation('proximity_loop', true);
        } else anim.start('proximity_loop');
        if (!inst.SoundEmitter!.PlayingSound('idlesound')) {
            inst.SoundEmitter!.PlaySound(`dontstarve/common/researchmachine_${soundprefix}_idle_LP`, 'idlesound');
        }
    }

    function onturnoff(inst: PrefabInstance): void {
        if (inst.hasTag('burnt')) return;
        if (mergeanims) inst.sprite.pushAnimation('proximity_pst', false);
        inst.sprite.pushAnimation('idle', false);
        inst.SoundEmitter!.KillSound('idlesound');
    }

    function onbuilt(inst: PrefabInstance): void {
        inst.sprite.playOnce('place');
        inst.sprite.pushAnimation('idle', false);
    }

    function fn(inst: PrefabInstance): void {
        inst.AddSoundEmitter();
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

/** TUNING.PROTOTYPER_TREES.SHADOWMANIPULATOR / PRESTIHATITATOR. */
export const MAGIC_PROTOTYPER_DEFINITIONS: Readonly<Record<MagicPrototyperId, AnimatedBuildingDefinition>> = {
    researchlab3: createmachine(3, 'researchlab3', 'lvl3', { MAGIC: 3 }, true),
    researchlab4: createmachine(4, 'researchlab4', 'lvl4', { MAGIC: 2 }, false),
};
