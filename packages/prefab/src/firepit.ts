import { prefabInstance } from './prefabInstance';
import type * as THREE from 'three';
import definitions from './definitions.json' with { type: 'json' };
import { firepit_init_fn } from '@dontstarve-web/animation/prefabskin';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
} from './animatedBuildingPlacement';
import type { WorldContext } from './worldContext';
import { actionEntity } from './actionEntity';
import { Burnable } from '../../componets/src/burnable';
import { Fueled, type FueledSave } from '../../componets/src/fueled';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { WorkInst } from '../../componets/src/workable';
import { CAMPFIREFIRE_ARCHIVE, CAMPFIREFIRE_ID, CampfireFire } from './campfirefire';
import { PlaySound } from './sound';

export const FIRE_PIT_ID = 'firepit' as const;
export type FirePitId = typeof FIRE_PIT_ID;
export const FIRE_PIT_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.firepit.skinArchives;

/** firepit.lua OnSave plus its fueled component's OnSave. */
export interface FirePitSaveState { fueled?: FueledSave; queued_charcoal?: true }

// tuning.lua with the default 30 s segments: night_time = 60, dusk_time = 120.
const FIREPIT_FUEL_MAX = (60 + 120) * 2;
const FIREPIT_FUEL_START = 60 + 120;
const FIREPIT_BONUS_MULT = 2;
const ADD_FUEL_SOUND = 'dontstarve/common/fireAddFuel';
const SECTION_STATUS = ['OUT', 'EMBERS', 'LOW', 'NORMAL', 'HIGH'] as const;

/** skinprefabs.lua: each skin's firepit_init_fn fxoffset. */
const SKIN_FX_OFFSET: Readonly<Record<string, number>> = {
    firepit_fanged: 20, firepit_fangedp: 20, firepit_firebird: -5, firepit_hole: 26, firepit_hole_alt: 26,
    firepit_kiln: -36, firepit_kiln_alt: -36, firepit_lava: 0, firepit_stonehenge: -28, firepit_victorian: 10,
};

type FirePitInst = ReturnType<typeof actionEntity>;

/** firepit.lua's burnable/fueled pair: fuel sections set the campfirefire level, an empty pit goes out. */
class FirePit {
    readonly burnable: Burnable;
    readonly fueled: Fueled<FirePitInst>;
    queued_charcoal = false;
    disable_charcoal = false;
    /** Only when the world supplies no game-time scheduler; advanced by the building's update. */
    readonly ownScheduler?: GameTimeScheduler;
    private readonly context: AnimatedBuildingEventContext;

    constructor(context: AnimatedBuildingEventContext) {
        const { model, instance } = context;
        this.context = context;
        const inst = actionEntity(model, FIRE_PIT_ID);
        for (const tag of ['campfire', 'structure', 'wildfireprotected', 'cooker', 'storytellingprop']) inst.addTag(tag);
        const scheduler = context.world?.scheduler ?? (this.ownScheduler = new GameTimeScheduler());
        const factory = context.fxFactories?.get(CAMPFIREFIRE_ARCHIVE);
        if (!factory) throw new Error('firepit requires the campfirefire animation');

        const burnable = this.burnable = new Burnable(inst, scheduler);
        inst.components.burnable = burnable;
        burnable.SetFXSpawner(data => data.prefab === CAMPFIREFIRE_ID ? new CampfireFire(factory, instance, model, data) : undefined);
        burnable.AddBurnFX(CAMPFIREFIRE_ID, { x: 0, y: 25, z: 0 }, 'firefx', true, undefined, true);
        // ListenForEvent("onextinguish", onextinguish)
        burnable.SetOnExtinguishFn(() => this.fueled.InitializeFuelLevel(0));

        const fueled = this.fueled = new Fueled(inst, scheduler);
        inst.components.fueled = fueled;
        fueled.maxfuel = FIREPIT_FUEL_MAX;
        fueled.accepting = true;
        fueled.SetSections(4);
        fueled.bonusmult = FIREPIT_BONUS_MULT;
        fueled.SetTakeFuelFn(() => { PlaySound(ADD_FUEL_SOUND, model.position); });
        fueled.SetUpdateFn(() => this.onupdatefueled());
        fueled.SetSectionCallback((newsection, _oldsection, _inst, doer) => this.onfuelchange(newsection, doer as WorkInst | undefined));
        fueled.InitializeFuelLevel(FIREPIT_FUEL_START);

        Object.assign(prefabInstance(model)!.components, {
            inspectable: { getstatus: () => SECTION_STATUS[fueled.GetCurrentSection()] },
        });
        // A skinned pit runs its firepit_init_fn after the prefab fn.
        if (context.skinId !== undefined) {
            this.setSkin(context.skinId);
            this.restart();
        }
    }

    /** firepit_init_fn / firepit_clear_fn: the skin's fx offset, then restart_firepit to move the fire. */
    setSkin(skinId: string | undefined): void {
        const offset = skinId === undefined ? undefined : SKIN_FX_OFFSET[skinId];
        this.burnable.SetFXOffset(offset === undefined ? undefined : { x: 0, y: offset, z: 0 });
    }

    /** restart_firepit: empty and refill the fuel, keeping a queued charcoal. */
    restart(): void {
        const queued = this.queued_charcoal;
        this.queued_charcoal = false;
        const percent = this.fueled.GetPercent();
        this.fueled.MakeEmpty();
        this.fueled.SetPercent(percent);
        this.queued_charcoal = queued;
    }

    /** updatefuelrate: rain speeds consumption, but the world's precipitation is not available here. */
    private updatefuelrate(): void { this.fueled.rate = 1; }

    private onupdatefueled(): void {
        this.updatefuelrate();
        this.burnable.SetFXLevel(this.fueled.GetCurrentSection(), this.fueled.GetSectionPercent());
    }

    private onfuelchange(newsection: number, doer: WorkInst | undefined): void {
        if (newsection <= 0) {
            this.burnable.Extinguish();
            if (this.queued_charcoal) {
                this.context.world?.dropLoot?.([{ itemId: 'charcoal', count: 1 }], this.context.instance.position);
                this.queued_charcoal = false;
            }
            return;
        }
        if (!this.burnable.IsBurning()) {
            this.updatefuelrate();
            this.burnable.Ignite(false, undefined, doer);
        }
        this.burnable.SetFXLevel(newsection, this.fueled.GetSectionPercent());
        if (newsection === this.fueled.sections) this.queued_charcoal = !this.disable_charcoal;
    }

    dispose(): void {
        this.fueled.dispose();
        this.ownScheduler?.dispose();
    }
}

const firepitOf = (model: THREE.Object3D): FirePit => model.userData.firepit;

function onbuilt({ animation, model, onComplete }: AnimatedBuildingBuiltContext): void {
    animation.playOnce('place', () => {
        animation.start('idle');
        onComplete();
    });
    PlaySound(ADD_FUEL_SOUND, model.position);
}

export const FIRE_PIT_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.firepit,
    obstacleRadius: 0.3,
    hammerWorkLeft: 4, hammerMaterial: 'stone',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse' },
    hammerExtraLoot: [{ itemId: 'ash', count: 1 }],
    skinInit: firepit_init_fn,
    fxArchives: [CAMPFIREFIRE_ARCHIVE],
    oninit: context => { context.model.userData.firepit = new FirePit(context); },
    onbuilt,
    onupdate: ({ model }, dt) => {
        const firepit = firepitOf(model);
        firepit.ownScheduler?.advance(dt);
        firepit.burnable.UpdateFX(dt);
    },
    onreskin: ({ model, skinId }) => {
        const firepit = firepitOf(model);
        firepit.setSkin(skinId);
        firepit.restart();
    },
    ondispose: ({ model }) => firepitOf(model).dispose(),
    onrestore: ({ model }, components) => {
        const saved = components.firepit, firepit = firepitOf(model);
        if (saved?.queued_charcoal) firepit.queued_charcoal = true;
        if (saved?.fueled) firepit.fueled.OnLoad(saved.fueled);
    },
    exportComponents: ({ model }) => {
        const firepit = firepitOf(model), fueled = firepit.fueled.OnSave();
        return fueled || firepit.queued_charcoal
            ? { firepit: { ...(fueled ? { fueled } : {}), ...(firepit.queued_charcoal ? { queued_charcoal: true as const } : {}) } } : {};
    },
};

export class FirePitPlacement extends AnimatedBuildingPlacement<FirePitId> {
    constructor(world: WorldContext, consumeBufferedBuild: (buildId: FirePitId) => boolean) {
        super(world, { [FIRE_PIT_ID]: FIRE_PIT_DEFINITION }, consumeBufferedBuild);
    }
}
