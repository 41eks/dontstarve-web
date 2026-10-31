import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import type * as THREE from 'three';
import { type SpriteState } from '@dontstarve-web/display';
import { prefabInstance, type PrefabInstance } from './prefabInstance';
import definitions from './definitions.json' with { type: 'json' };
import { FiniteUses } from '../../componets/src/finiteuses';
import { SleepingBag } from '../../componets/src/sleepingbag';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { actionEntity } from './actionEntity';
import type {
    AnimatedBuildingBuiltContext,
    AnimatedBuildingDefinition,
    AnimatedBuildingEventContext,
} from './animatedBuildingPlacement';
import { PlaySound } from './sound';

export const TENT_ID = 'tent' as const;
/** TUNING.TENT_USES. */
export const TENT_USES = 15;
// TUNING.SLEEP_HEALTH_PER_TICK doubled by tent.lua, and TUNING.SLEEP_HUNGER_PER_TICK.
const TENT_HEALTH_TICK = 2;
const FRAME = 1 / 30;

export type TentComponents = { sleepingbag: SleepingBag; finiteuses: FiniteUses };

/** The tent's own components, once oninit has run. */
export function getTentComponents(model: THREE.Object3D): TentComponents | undefined {
    const components = prefabInstance(model)!.components;
    return components?.sleepingbag && components.finiteuses ? components as TentComponents : undefined;
}

function onbuilt({ animation, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
}

/** inst:DoPeriodicTask(period, fn, initialDelay) on the game-time scheduler. */
function periodic(scheduler: GameTimeScheduler, period: number, initialDelay: number, run: () => void): () => void {
    let cancel = scheduler.schedule(initialDelay, function tick() {
        run();
        cancel = scheduler.schedule(period, tick);
    });
    return () => cancel();
}

/** tent.lua common_fn / tent(): sleepingbag, finiteuses and their sleep, wake, hit and finish callbacks. */
function oninit({ model, instance, world }: AnimatedBuildingEventContext): void {
    const workable = instance.components.workable = new Workable(instance);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(4);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    instance.components.lootdropper = createStructureLootDropper(instance);
    const scheduler = world?.scheduler;
    if (!scheduler) throw new Error('A tent needs the world scheduler');
    const entity = actionEntity(model, TENT_ID);
    for (const tag of ['tent', 'structure']) entity.addTag(tag);
    const animation = () => (prefabInstance(model)!.sprite as SpriteState);
    let sleepSounds: (() => void)[] = [];
    const stopSleepSound = () => { for (const cancel of sleepSounds.splice(0)) cancel(); };
    const startSleepSound = (length: number) => {
        stopSleepSound();
        const play = () => PlaySound('dontstarve/common/tent_sleep', model.position);
        sleepSounds = [periodic(scheduler, length, 33 * FRAME, play), periodic(scheduler, length, 47 * FRAME, play)];
    };

    const uses = new FiniteUses(entity);
    uses.SetMaxUses(TENT_USES);
    uses.SetUses(TENT_USES);
    uses.SetOnFinished(() => {
        if (entity.hasTag('burnt')) return;
        stopSleepSound();
        instance.persists = false;
        animation().playOnce('destroy', () => instance.remove());
        PlaySound('dontstarve/common/tent_dis_pre', model.position);
        scheduler.schedule(16 * FRAME, () => PlaySound('dontstarve/common/tent_dis_twirl', model.position));
    });

    const bag = new SleepingBag(entity);
    bag.health_tick = TENT_HEALTH_TICK;
    // sleep_anim: tents loop sleep_loop while occupied.
    bag.onsleep = () => {
        animation().start('sleep_loop');
        startSleepSound(animation().currentAnimationLength);
    };
    bag.onwake = () => {
        stopSleepSound();
        animation().start('idle');
        uses.Use();
    };
    Object.assign(prefabInstance(model)!.components, { sleepingbag: bag, finiteuses: uses });
    (instance as TentInstance).stopSleepSound = stopSleepSound;
}

interface TentInstance extends PrefabInstance { stopSleepSound(): void }

/** tent.lua onhit wakes a sleeper even when the tent is burnt. */
function onworked(inst: PrefabInstance): void {
    if (!inst.hasTag('burnt')) {
        (inst as TentInstance).stopSleepSound();
        inst.sprite.playOnce('hit');
        inst.sprite.pushAnimation('idle', true);
    }
    inst.components.sleepingbag?.DoWakeUp();
}

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('big', inst.position, 'wood');
    inst.remove();
}

function ondispose({ instance }: AnimatedBuildingEventContext): void {
    (instance as TentInstance).stopSleepSound();
    instance.components.sleepingbag?.dispose();
    instance.components.finiteuses?.dispose();
}

export const TENT_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.tent,
    obstacleRadius: 1,
    onbuilt, oninit, ondispose,
    exportComponents: ({ model }) => ({ finiteuses: getTentComponents(model)!.finiteuses.OnSave() }),
    onrestore: ({ model }, components) => {
        if (components.finiteuses) getTentComponents(model)!.finiteuses.OnLoad(components.finiteuses);
    },
};
