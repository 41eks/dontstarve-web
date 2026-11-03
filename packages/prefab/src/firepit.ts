import { SpriteState } from '@dontstarve-web/display';
import { createEffect, watchSignal } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Fueled, type FueledSave } from '../../componets/src/fueled';
import { Workable, type WorkInst } from '../../componets/src/workable';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingPersist } from './building';
import { CAMPFIREFIRE_ID } from './campfirefire';
import { addComponent } from './components';
import { PrefabInstance } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { PlaySound } from './sound';
import { createStructureLootDropper } from './structureLoot';
import type { PrefabWorldContext } from './worldContext';

export const FIRE_PIT_ID = 'firepit' as const;
export type FirePitId = typeof FIRE_PIT_ID;

const declaration = definitions.animatedBuildings.firepit;

/** firepit.lua MakePlacer("firepit_placer", "firepit", "firepit", "preview"). */
export const FIRE_PIT_PLACER = buildingPlacer(declaration);

/** firepit.lua OnSave plus its fueled component's OnSave, nested as this project's saves hold them. */
export interface FirePitSaveState { fueled?: FueledSave; queued_charcoal?: true }

// tuning.lua with the default 30 s segments: night_time = 60, dusk_time = 120.
const FIREPIT_FUEL_MAX = (60 + 120) * 2;
const FIREPIT_FUEL_START = 60 + 120;
const FIREPIT_BONUS_MULT = 2;
const FIREPIT_RAIN_RATE = 2;
const ADD_FUEL_SOUND = 'dontstarve/common/fireAddFuel';
const SECTION_STATUS = ['OUT', 'EMBERS', 'LOW', 'NORMAL', 'HIGH'] as const;

/** skinprefabs.lua: each skin's firepit_init_fn fxoffset. */
const SKIN_FX_OFFSET: Readonly<Record<string, number>> = {
    firepit_fanged: 20, firepit_fangedp: 20, firepit_firebird: -5, firepit_hole: 26, firepit_hole_alt: 26,
    firepit_kiln: -36, firepit_kiln_alt: -36, firepit_lava: 0, firepit_stonehenge: -28, firepit_victorian: 10,
};

/** firepit.lua fn(), as far as it is ported: fuel sections set the campfirefire level, and an empty pit goes out. */
export class FirePitInstance extends PrefabInstance {
    queued_charcoal = false;
    disable_charcoal = false;
    /** components.fueled, with its whole interface. */
    private readonly fueled: Fueled<FirePitInstance>;

    constructor(world: PrefabWorldContext, position: ReadonlyVector3) {
        super(FIRE_PIT_ID, new SpriteState({ name: 'idle', held: true, billboard: true }));
        const { fire, scheduler } = world;
        if (!fire || !scheduler) throw new Error('A firepit needs the world\'s fire effects and scheduler');
        this.worldServices = world;
        // The pit lights in fn, and its fire's sounds start where the pit stands.
        this.setPosition(position.x, 0, position.z);
        MakeBuildingPersist(this);
        const { OnSave: saveBuilding, OnLoad: loadBuilding } = this;
        this.OnSave = (inst, data) => { saveBuilding!(inst, data); onsave(this, data); };
        this.OnLoad = (inst, data) => { loadBuilding!(inst, data); onload(this, data); };
        for (const tag of ['campfire', 'structure', 'wildfireprotected', 'cooker', 'storytellingprop']) this.addTag(tag);
        const workable = this.components.workable = new Workable(this);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnWorkCallback(onworked);
        workable.SetOnFinishCallback(onhammered);
        this.components.lootdropper = createStructureLootDropper(this);

        // Settled before the burnable goes: its last update can still reach the fire level.
        const fueled = this.components.fueled = this.fueled = new Fueled<FirePitInstance>(this, scheduler);
        this.onRemove(() => fueled.dispose());
        const burnable = addComponent(this, 'burnable', scheduler);
        burnable.SetFXSpawner(data => data.prefab === CAMPFIREFIRE_ID ? fire.spawnCampfire(this, data) : undefined);
        burnable.AddBurnFX(CAMPFIREFIRE_ID, { x: 0, y: 25, z: 0 }, 'firefx', true, undefined, true);
        // ListenForEvent("onextinguish", onextinguish)
        burnable.SetOnExtinguishFn(() => fueled.InitializeFuelLevel(0));

        fueled.maxfuel = FIREPIT_FUEL_MAX;
        fueled.accepting = true;
        fueled.SetSections(4);
        fueled.bonusmult = FIREPIT_BONUS_MULT;
        fueled.SetTakeFuelFn(() => { PlaySound(ADD_FUEL_SOUND, this.position); });
        fueled.SetUpdateFn(() => this.onupdatefueled());
        fueled.SetSectionCallback((newsection, _oldsection, _inst, doer) => this.onfuelchange(newsection, doer as WorkInst | undefined));
        fueled.InitializeFuelLevel(FIREPIT_FUEL_START);
        Object.assign(this.components, { inspectable: { getstatus: () => SECTION_STATUS[fueled.GetCurrentSection()] } });

        this.ListenForEvent('onbuilt', () => onbuilt(this));
        // A skin's firepit_init_fn / firepit_clear_fn runs when the skin is set, after fn.
        const skin = watchSignal(this.sprite.skinId, stop => this.onRemove(stop));
        let previous = skin.peek();
        createEffect(() => {
            const skinId = skin.get();
            if (skinId === previous) return;
            previous = skinId;
            this.setSkin(skinId);
            this.restart();
        });
    }

    loadFuel(saved: FueledSave): void { this.fueled.OnLoad(saved); }

    /** firepit_init_fn / firepit_clear_fn: the skin's fx offset, then restart_firepit to move the fire. */
    private setSkin(skinId: string | undefined): void {
        const offset = skinId === undefined ? undefined : SKIN_FX_OFFSET[skinId];
        this.components.burnable!.SetFXOffset(offset === undefined ? undefined : { x: 0, y: offset, z: 0 });
    }

    /** restart_firepit: empty and refill the fuel, keeping a queued charcoal. */
    private restart(): void {
        const { fueled } = this;
        const queued = this.queued_charcoal;
        this.queued_charcoal = false;
        const percent = fueled.GetPercent();
        fueled.MakeEmpty();
        fueled.SetPercent(percent);
        this.queued_charcoal = queued;
    }

    /** updatefuelrate: TheWorld.state.israining and no rainimmunity burns the fuel faster. */
    private updatefuelrate(): void {
        const weather = this.worldServices?.weather;
        const raining = weather?.preciptype.peek() === 'rain' && (this.components as { rainimmunity?: object }).rainimmunity === undefined;
        this.fueled.rate = raining ? 1 + FIREPIT_RAIN_RATE * weather!.precipitationRate.peek() : 1;
    }

    private onupdatefueled(): void {
        const { fueled } = this;
        this.updatefuelrate();
        this.components.burnable!.SetFXLevel(fueled.GetCurrentSection(), fueled.GetSectionPercent());
    }

    private onfuelchange(newsection: number, doer: WorkInst | undefined): void {
        const burnable = this.components.burnable!, { fueled } = this;
        if (newsection <= 0) {
            burnable.Extinguish();
            if (this.queued_charcoal) {
                this.worldServices?.dropLoot?.([{ itemId: 'charcoal', count: 1 }], this.position);
                this.queued_charcoal = false;
            }
            return;
        }
        if (!burnable.IsBurning()) {
            this.updatefuelrate();
            burnable.Ignite(false, undefined, doer);
        }
        burnable.SetFXLevel(newsection, fueled.GetSectionPercent());
        if (newsection === fueled.sections) this.queued_charcoal = !this.disable_charcoal;
    }
}

/** The fueled component's record stays nested under `firepit`, the shape existing saves hold. */
function onsave(inst: FirePitInstance, data: PlacementSaveRecord['components']): void {
    const components = data as { fueled?: FueledSave }, { fueled } = components;
    delete components.fueled;
    if (fueled || inst.queued_charcoal) data.firepit = { ...(fueled ? { fueled } : {}), ...(inst.queued_charcoal ? { queued_charcoal: true as const } : {}) };
}

function onload(inst: FirePitInstance, data: PlacementSaveRecord['components']): void {
    const saved = data.firepit;
    if (saved?.queued_charcoal) inst.queued_charcoal = true;
    if (saved?.fueled) inst.loadFuel(saved.fueled);
}

function onbuilt(inst: PrefabInstance): void {
    inst.sprite.playOnce('place');
    inst.sprite.pushAnimation('idle', false);
    PlaySound(ADD_FUEL_SOUND, inst.position);
}

function onworked(inst: PrefabInstance): void {
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation('idle', false);
}

function onhammered(inst: PrefabInstance): void {
    inst.components.lootdropper!.DropLoot();
    inst.components.lootdropper!.SpawnLootPrefab('ash');
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'stone');
    inst.remove();
}

export function firePitPrefabs(world: PrefabWorldContext) {
    return { [FIRE_PIT_ID]: { ...buildingPrefab(declaration, 'firepit', .3, position => new FirePitInstance(world, position), world),
        // fn: MiniMapEntity:SetIcon("firepit.png").
        minimapIcon: 'firepit.png' } };
}
