import definitions from './definitions.json' with { type: 'json' };
import type { AnimatedBuildingDefinition } from './animatedBuildingPlacement';
import { actionEntity } from './actionEntity';
import { PlaySound } from './sound';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { LunarHailBuildup, RoseInspectable } from '../../componets/src/pandoraschestSignatures';

export const PANDORAS_CHEST_ID = 'pandoraschest' as const;
export type PandorasChestId = typeof PANDORAS_CHEST_ID;
/** tuning.lua HAUNT_TINY. */
const HAUNT_TINY = 1;

/**
 * treasurechest.lua MakeChest("pandoraschest", "pandoras_chest", "pandoras_chest", indestructible = true,
 * pandora_master_postinit): a 3 x 3 container with no workable, lootdropper or burnable, and no skins.
 */
export const PANDORAS_CHEST_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.pandoraschest,
    // fn: AnimState:PlayAnimation("closed"); onclose: PlayAnimation("close") + PushAnimation("closed", false).
    idleHeld: true,
    minimapIcon: 'pandoraschest.png',
    // onopen / onclose: SOUNDS.open / SOUNDS.close, with the container's own sounds skipped.
    onopen: ({ model }) => { PlaySound('dontstarve/wilson/chest_open', model.position); },
    onclose: ({ model }) => { PlaySound('dontstarve/wilson/chest_close', model.position); },
    oninit: ({ model, instance, world }) => {
        // MakeChest AddTag("structure"), AddTag("chest"); MakeSnowCoveredPristine AddTag("SnowCovered").
        for (const tag of ['structure', 'chest', 'SnowCovered']) instance.addTag(tag);
        const inst = actionEntity(model, PANDORAS_CHEST_ID);
        const components: Record<string, unknown> = { inspectable: new Inspectable(inst) };
        if (world?.scheduler) {
            const hauntable = new Hauntable({ addTag: tag => inst.addTag(tag), removeTag: tag => inst.removeTag(tag),
                PushEvent: (name, data) => inst.PushEvent?.(name, data) }, world.scheduler);
            hauntable.SetHauntValue(HAUNT_TINY);
            components.hauntable = hauntable;
        }
        // MakeSnowCovered -> MakeLunarHailBuildup; pandora_master_postinit -> MakeRoseTarget_CreateFuel_IncreasedHorror.
        components.lunarhailbuildup = new LunarHailBuildup(inst);
        components.roseinspectable = new RoseInspectable(inst);
        Object.assign(instance.components, components);
    },
    ondispose: ({ instance }) => { (instance.components.hauntable as Hauntable | undefined)?.dispose(); },
};
