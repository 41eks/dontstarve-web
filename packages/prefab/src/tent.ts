import definitions from './definitions.json' with { type: 'json' };
import type { SpriteController } from '@dontstarve-web/animation/sprite';
import { FiniteUses } from '../../componets/src/finiteuses';
import { SleepingBag } from '../../componets/src/sleepingbag';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { actionEntity } from './actionEntity';
import type {
    AnimatedBuildingBuiltContext,
    AnimatedBuildingDefinition,
    AnimatedBuildingEventContext,
    AnimatedBuildingHammerContext,
} from './animatedBuildingPlacement';
import { PlaySound, PreloadSounds } from './sound';

export const TENT_ID = 'tent' as const;
/** TUNING.TENT_USES. */
export const TENT_USES = 15;
// TUNING.SLEEP_HEALTH_PER_TICK doubled by tent.lua, and TUNING.SLEEP_HUNGER_PER_TICK.
const TENT_HEALTH_TICK = 2;
const FRAME = 1 / 30;

export type TentComponents = { sleepingbag: SleepingBag; finiteuses: FiniteUses };

/** The tent's own components, once oninit has run. */
export function getTentComponents(model: { userData: Record<string, any> }): TentComponents | undefined {
    const components = model.userData.components;
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
function oninit({ model, instance, world, remove }: AnimatedBuildingEventContext): void {
    const scheduler = world?.scheduler;
    if (!scheduler) throw new Error('A tent needs the world scheduler');
    const entity = actionEntity(model, TENT_ID);
    for (const tag of ['tent', 'structure']) entity.addTag(tag);
    const animation = () => model.userData.animationController as SpriteController;
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
        animation().playOnce('destroy', () => remove?.());
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
    model.userData.components = { ...model.userData.components, sleepingbag: bag, finiteuses: uses };
    model.userData.stopTentSleepSound = stopSleepSound;
}

/** tent.lua onhit: stop the sleep sound, play hit, then idle; the sleeper is woken. */
function onhit({ model, animation }: AnimatedBuildingHammerContext): void {
    model.userData.stopTentSleepSound?.();
    animation.playOnce('hit', () => (model.userData.animationController as SpriteController).start('idle'));
    getTentComponents(model)?.sleepingbag.DoWakeUp();
}

function ondispose({ model }: AnimatedBuildingEventContext): void {
    const tent = getTentComponents(model);
    model.userData.stopTentSleepSound?.();
    tent?.sleepingbag.dispose();
    tent?.finiteuses.dispose();
}

export const TENT_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.tent,
    obstacleRadius: 1,
    hammerWorkLeft: 4, hammerMaterial: 'wood',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_large', name: 'collapse' },
    prepare: () => PreloadSounds('dontstarve/common/tent_sleep', 'dontstarve/common/tent_dis_pre', 'dontstarve/common/tent_dis_twirl'),
    onbuilt, oninit, onhit, ondispose,
    exportComponents: ({ model }) => ({ finiteuses: getTentComponents(model)!.finiteuses.OnSave() }),
    onrestore: ({ model }, components) => {
        if (components.finiteuses) getTentComponents(model)!.finiteuses.OnLoad(components.finiteuses);
    },
};
