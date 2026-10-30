import type * as THREE from 'three';
import definitions from './definitions.json' with { type: 'json' };
import { lightning_rod_init_fn } from '@dontstarve-web/animation/prefabskin';
import type { SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import { Battery } from '../../componets/src/battery';
import { ComponentTimer } from '../../componets/src/timer';
import {
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
} from './animatedBuildingPlacement';
import { actionEntity } from './actionEntity';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { prefabInstance } from './prefabInstance';

export const LIGHTNING_ROD_ID = 'lightning_rod' as const;
export type LightningRodId = typeof LIGHTNING_ROD_ID;
export const LIGHTNING_ROD_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.lightning_rod.skinArchives;

/** lightningrod.lua OnSave: data.charged and data.chargeleft only exist while the rod is charged. */
export interface LightningRodSaveState { charged: true; chargeleft: number }

/** inst.Light: radius 1.5, falloff 1, intensity .5, orange. Radius is in DST units. */
const LIGHT = { radius: 1.5 * (TILE_SIZE / 4), intensity: .5, falloff: 1, colour: [235 / 255, 121 / 255, 12 / 255] } as const;
const ZAP_SOUND = 'dontstarve/common/lightningrod';
const CRAFT_SOUND = 'dontstarve/common/lightning_rod_craft';

/** lightningrod.lua's inst.charged / inst.chargeleft / inst.zaptask and WatchWorldState("cycles", ondaycomplete). */
class LightningRod {
    charged = false;
    chargeleft: number | undefined;
    /** dozap's DoTaskInTime(math.random(10, 40), dozap), a restartable game-time timer. */
    private readonly zapTimer?: ComponentTimer;
    /** The discrete once-per-day callback; re-armed on every expiry while charged. */
    private readonly dayTimer?: ComponentTimer;
    readonly battery: Battery<LightningRod>;

    private readonly context: AnimatedBuildingEventContext;

    constructor(context: AnimatedBuildingEventContext) {
        this.context = context;
        const scheduler = context.world?.scheduler;
        if (scheduler) {
            this.zapTimer = new ComponentTimer(scheduler, () => this.dozap());
            this.dayTimer = new ComponentTimer(scheduler, () => {
                this.ondaycomplete();
                this.armDay();
            });
        }
        this.battery = new Battery<LightningRod>(this);
        this.battery.SetCanBeUsedFn((inst, _user, mult) => {
            if (mult) {
                const charge = inst.actualCharge;
                if (charge !== undefined && charge >= mult) return [true];
            } else if (inst.charged) return [true];
            return [false, 'NOT_ENOUGH_CHARGE'];
        });
        this.battery.SetOnUsedFn((inst, _user, mult) => {
            if (mult) {
                const charge = inst.actualCharge;
                if (charge !== undefined && charge > mult) {
                    inst.dozap();
                    inst.chargeleft! -= mult;
                    return;
                }
            }
            inst.discharge();
        });
        this.battery.SetResolvePartialChargeMultFn((inst, _user, mult) => {
            const charge = inst.actualCharge;
            return charge === undefined ? mult : Math.min(mult, charge);
        });
    }

    /**
     * CalcActualCharge: functionally, the rod holds 1 charge that decays over 3 days, not 3 separate charges.
     */
    get actualCharge(): number | undefined {
        return this.chargeleft === undefined ? undefined : this.chargeleft - (Math.ceil(this.chargeleft) - 1);
    }

    private get removed(): boolean { return this.context.model.userData.removed === true; }

    private armDay(): void {
        const world = this.context.world;
        if (!this.charged || !world?.scheduler || !world.secondsUntilNextDay) return;
        this.dayTimer?.start(world.secondsUntilNextDay(world.scheduler.now));
    }

    /** dozap: the sound and fx at the rod, then the next zap in 10–40 seconds. */
    dozap(): void {
        if (this.removed) return;
        const { model, world } = this.context;
        PlaySound(ZAP_SOUND, model.position);
        const position = actionEntity(model, LIGHTNING_ROD_ID).getPosition();
        world?.fx?.spawn('lightning_rod_fx', position);
        this.zapTimer?.start(10 + Math.floor(Math.random() * 31));
    }

    discharge(): void {
        if (!this.charged) return;
        this.dayTimer?.stop();
        // AnimState:ClearBloomEffectHandle has no renderer here; the light is the visible charge.
        this.charged = false;
        this.chargeleft = undefined;
        prefabInstance(this.context.model)!.light.set(null);
        this.zapTimer?.stop();
    }

    private ondaycomplete(): void {
        this.dozap();
        if (this.chargeleft! > 1) this.chargeleft! -= 1;
        else this.discharge();
    }

    setcharged(charges: number): void {
        if (!this.charged) {
            prefabInstance(this.context.model)!.light.set(LIGHT);
            this.charged = true;
            this.armDay();
        }
        this.chargeleft = Math.max(this.chargeleft ?? 0, charges);
        this.dozap();
    }

    /** onlightning: onhit, then a full three-day charge. */
    onlightning(): void {
        playHit(this.context.model);
        this.setcharged(3);
    }

    dispose(): void {
        this.zapTimer?.stop();
        this.dayTimer?.stop();
        prefabInstance(this.context.model)!.light.set(null);
    }
}

const rodOf = (model: THREE.Object3D): LightningRod => model.userData.lightningrod;

/** onhit: AnimState:PlayAnimation("hit"), PushAnimation("idle", false). */
function playHit(model: THREE.Object3D): void {
    const animation = prefabInstance(model)!.sprite as SpriteAnimationController;
    animation.playOnce('hit', () => (prefabInstance(model)!.sprite as SpriteAnimationController).start('idle'));
}

function oninit(context: AnimatedBuildingEventContext): void {
    const { model } = context;
    const entity = actionEntity(model, LIGHTNING_ROD_ID);
    const rod = new LightningRod(context);
    model.userData.lightningrod = rod;
    entity.addTag('lightningrod');
    Object.assign(prefabInstance(model)!.components, {
        battery: rod.battery,
        // getstatus: inst.charged and "CHARGED" or nil
        inspectable: { getstatus: () => rod.charged ? 'CHARGED' : undefined },
    });
    model.addEventListener('lightningstrike' as never, () => rod.onlightning());
}

function onbuilt({ animation, model, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
    PlaySound(CRAFT_SOUND, model.position);
}

export const LIGHTNING_ROD_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.lightning_rod,
    hammerWorkLeft: 4, hammerMaterial: 'metal',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse' },
    skinInit: lightning_rod_init_fn,
    oninit,
    onbuilt,
    ondispose: ({ model }) => rodOf(model).dispose(),
    // onload: a charged save restores its remaining charge (and zaps once, as setcharged does).
    onrestore: ({ model }, components) => {
        const saved = components.lightningrod;
        if (saved?.charged && saved.chargeleft > 0) rodOf(model).setcharged(saved.chargeleft);
    },
    exportComponents: ({ model }) => {
        const rod = rodOf(model);
        return rod.charged ? { lightningrod: { charged: true, chargeleft: rod.chargeleft! } } : {};
    },
};
