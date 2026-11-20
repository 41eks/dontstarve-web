import { SpriteState } from '@dontstarve-web/display';
import { WorldContentKey, type GetWatchWorldContent, type WorldMoonPhase } from '@dontstarve-web/signals';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { Inspectable } from '../../componets/src/inspectable';
import { Workable } from '../../componets/src/workable';
import { SanityAura } from '../../componets/src/sanityaura';
import { Repairable } from '../../componets/src/repairable';

export const MOON_FISSURE_ID = 'moon_fissure' as const;
/** MATERIALS.MOON_ALTAR. */
const MOON_ALTAR = 'moon_altar';

export interface MoonFissureWorld { readonly getWatchWorldContent?: GetWatchWorldContent }

/** lightstate_data's rows, as far as UpdateState reads them for the fissure itself: the light and sanity values stay in the source. */
const lightstate_data: readonly { readonly enabled: boolean; readonly radius: number }[] = [
    { enabled: false, radius: 0 }, { enabled: true, radius: 3 }, { enabled: true, radius: 6 },
    { enabled: true, radius: 11 }, { enabled: true, radius: 11 },
];
/** The keys of every row's `layers`. */
const LAYERS = ['low', 'med', 'high', 'full'];

const MOON_STATES: Readonly<Record<WorldMoonPhase, number>> = { new: 1, quarter: 2, half: 3, threequarter: 4, full: 5 };

export class MoonFissureInstance extends PrefabInstance {
    declare readonly components: PrefabInstance['components'] & {
        inspectable: Inspectable; workable: Workable; sanityaura: SanityAura; repairable: Repairable;
    };
    /** inst._level: net_tinybyte, the MOON_STATES index of the phase the fissure shows. */
    declare _level: number;
}

/**
 * UpdateState, for the fissure's own AnimState and components: every glow layer is hidden on the fissure itself (they are
 * drawn by inst.fx), and `backing` shows only while the light is off. inst.fx's layers and Light:Enable are not ported.
 */
function UpdateState(inst: MoonFissureInstance, moonphase: WorldMoonPhase): void {
    const level = MOON_STATES[moonphase];
    const lightstate = lightstate_data[level - 1]!;
    for (const layer of LAYERS) { inst.sprite.hideLayer(layer); }
    if (lightstate.enabled) { inst.sprite.hideLayer('backing'); }
    else { inst.sprite.showLayer('backing'); }
    inst.components.sanityaura.max_distsq = lightstate.radius * lightstate.radius * 1.25 * 1.25;
    inst._level = level;
}

/**
 * moon_fissure.lua fn, for loading, drawing and saving. Not ported: the Light and its OnUpdateLight task, the SoundEmitter,
 * inspectable.getstatus, sanityaura's aurafn / fallofffn, repairable's onrepaired / checkmaterialfn, OnEntitySleep /
 * OnEntityWake, the moon_fissure_fx child and WatchWorldState("moonphase"): the look is the phase at construction.
 */
function fn(world: MoonFissureWorld): MoonFissureInstance {
    // SetBank / SetBuild("moon_fissure"), PlayAnimation("crack_idle", true).
    const inst = new MoonFissureInstance(MOON_FISSURE_ID, new SpriteState({ name: 'crack_idle', billboard: true }));
    inst.physicsRadiusOverride = .4;
    // SetFinalOffset(3)
    inst.sprite.setDepthOffset(true);
    // TheWorld.state.moonphase
    const moonphase = world.getWatchWorldContent?.(WorldContentKey.Moon, stop => inst.onRemove(stop)).peek().phase ?? 'new';
    inst._level = MOON_STATES[moonphase];
    inst.addTag('antlion_sinkhole_blocker');
    addComponent(inst, 'inspectable', Inspectable);
    // here for repairable
    const workable = addComponent(inst, 'workable', Workable);
    workable.SetMaxWork(1);
    workable.WriteWorkLeft(0);
    const sanityaura = addComponent(inst, 'sanityaura', SanityAura);
    sanityaura.max_distsq = 1;
    const repairable = addComponent(inst, 'repairable', Repairable, workable, MOON_ALTAR);
    repairable.noannounce = true;
    UpdateState(inst, moonphase);
    return inst;
}

/** The moon_fissure Prefab moon_fissure.lua returns; moon_fissure_plugged and moon_fissure_fx are not ported. */
export function moonFissurePrefabs(world: MoonFissureWorld):
    Readonly<Record<typeof MOON_FISSURE_ID, PrefabEntityDefinition<MoonFissureInstance>>> {
    return {
        [MOON_FISSURE_ID]: {
            fn: () => fn(world),
            assets: { animationArchive: 'moon_fissure.zip', buildArchives: ['moon_fissure.zip'], bank: 'moon_fissure' },
            // The 70 fissures of an imported world share one batch for their loop.
            assetOptions: { instancedAnimations: ['crack_idle'] },
        },
    };
}
