import type * as THREE from 'three';
import definitions from './definitions.json' with { type: 'json' };
import { winterometer_init_fn } from '@dontstarve-web/animation/prefabskin';
import type { PercentAnimationController } from '@dontstarve-web/animation/sprite';
import { ComponentTimer } from '../../componets/src/timer';
import { OVERHEAT_TEMP } from '../../componets/src/temperatureoverrider';
import {
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
} from './animatedBuildingPlacement';
import { actionEntity } from './actionEntity';
import { PlaySound, PreloadSounds } from './sound';

export const WINTEROMETER_ID = 'winterometer' as const;
export type WinterometerId = typeof WINTEROMETER_ID;
export const WINTEROMETER_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.winterometer.skinArchives;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** winterometer.lua's DoPeriodicTask(1, DoCheckTemp, 0), owned as a restartable game-time timer. */
class WinterometerCheck {
    private readonly timer?: ComponentTimer;
    private readonly context: AnimatedBuildingEventContext;
    constructor(context: AnimatedBuildingEventContext) {
        this.context = context;
        const scheduler = context.world?.scheduler;
        if (scheduler) {
            this.timer = new ComponentTimer(scheduler, () => {
                this.check();
                this.timer!.start(1);
            });
        }
        // Lua's burntup listener cancels the task; later starts are refused by the burnt tag.
        context.model.addEventListener('burntup' as never, () => this.cancel());
    }

    private get burnt(): boolean { return actionEntity(this.context.model, WINTEROMETER_ID).hasTag('burnt'); }

    /** DoCheckTemp: the meter reads GetLocalTemperature(inst), clamped to [0, OVERHEAT_TEMP]. */
    check(): void {
        const { model, world } = this.context;
        if (this.burnt || model.userData.removed || !world?.getLocalTemperature) return;
        const temperature = world.getLocalTemperature(model.position.x, model.position.z);
        // Reskinning replaces the animation controller, so read the current one from the entity.
        (model.userData.animationController as PercentAnimationController)
            .setPercent('meter', 1 - clamp(temperature, 0, OVERHEAT_TEMP) / OVERHEAT_TEMP);
    }

    /** StartCheckTemp: arms at most one task; delay 0 makes the first reading on the next tick. */
    start(): void {
        if (this.burnt || this.context.model.userData.removed || !this.timer) return;
        if (this.timer.snapshot.peek().status === 'scheduled') return;
        this.timer.start(0);
    }

    cancel(): void { this.timer?.stop(); }
}

const checkOf = (model: THREE.Object3D): WinterometerCheck => model.userData.winterometer;

function oninit(context: AnimatedBuildingEventContext): void {
    const check = new WinterometerCheck(context);
    context.model.userData.winterometer = check;
    check.check();
    check.start();
}

function onbuilt(context: AnimatedBuildingBuiltContext): void {
    const { model, animation, onComplete } = context;
    checkOf(model).cancel();
    animation.playOnce('place', () => {
        checkOf(model).start();
        onComplete();
    });
    PlaySound('dontstarve/common/winter_meter_craft', model.position);
}

function onhit({ model, animation }: AnimatedBuildingEventContext): void {
    checkOf(model).cancel();
    // The global animover handler restarts the check once the hit clip finishes.
    animation.playOnce('hit', () => checkOf(model).start());
}

export const WINTEROMETER_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.winterometer,
    obstacleRadius: 0.4,
    hammerWorkLeft: 4, hammerMaterial: 'wood',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse_small' },
    burnable: { burnTime: 10, fxLevel: 2, propagator: 'small' },
    skinInit: winterometer_init_fn,
    prepare: () => PreloadSounds('dontstarve/common/winter_meter_craft'),
    oninit,
    onbuilt,
    onhit,
    onreskin: ({ model }) => checkOf(model).check(),
    ondispose: ({ model }) => checkOf(model).cancel(),
};
