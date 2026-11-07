import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import { SpriteState } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import { Battery } from '../../componets/src/battery';
import { ComponentTimer } from '../../componets/src/timer';
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { PrefabInstance } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import type { PrefabWorldContext } from './worldContext';

export const LIGHTNING_ROD_ID = 'lightning_rod' as const;
export type LightningRodId = typeof LIGHTNING_ROD_ID;
const declaration: BuildingDeclaration = definitions.animatedBuildings.lightning_rod;
export const LIGHTNING_ROD_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives!;

/** lightningrod.lua MakePlacer("lightning_rod_placer", "lightning_rod", "lightning_rod", "idle"). */
export const LIGHTNING_ROD_PLACER = buildingPlacer(declaration);

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

    private readonly inst: PrefabInstance;

    constructor(inst: PrefabInstance) {
        this.inst = inst;
        const scheduler = inst.worldServices?.scheduler;
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

    private get removed(): boolean { return this.inst.isRemoved; }

    private armDay(): void {
        const world = this.inst.worldServices;
        if (!this.charged || !world?.scheduler || !world.secondsUntilNextDay) return;
        this.dayTimer?.start(world.secondsUntilNextDay(world.scheduler.now));
    }

    /** dozap: the sound and fx at the rod, then the next zap in 10–40 seconds. */
    dozap(): void {
        if (this.removed) return;
        PlaySound(ZAP_SOUND, this.inst.position);
        this.inst.worldServices?.fx?.spawn('lightning_rod_fx', this.inst.position);
        this.zapTimer?.start(10 + Math.floor(Math.random() * 31));
    }

    discharge(): void {
        if (!this.charged) return;
        this.dayTimer?.stop();
        // AnimState:ClearBloomEffectHandle has no renderer here; the light is the visible charge.
        this.charged = false;
        this.chargeleft = undefined;
        this.inst.light.set(null);
        this.zapTimer?.stop();
    }

    private ondaycomplete(): void {
        this.dozap();
        if (this.chargeleft! > 1) this.chargeleft! -= 1;
        else this.discharge();
    }

    setcharged(charges: number): void {
        if (!this.charged) {
            this.inst.light.set(LIGHT);
            this.charged = true;
            this.armDay();
        }
        this.chargeleft = Math.max(this.chargeleft ?? 0, charges);
        this.dozap();
    }

    dispose(): void {
        this.zapTimer?.stop();
        this.dayTimer?.stop();
        this.inst.light.set(null);
    }
}


/** onlightning: the same source onhit declaration, then a full three-day charge. */
function onlightning(inst: LightningRodInstance): void {
    onhit(inst);
    inst.lightningRod.setcharged(3);
}

function onsave(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    const rod = (inst as LightningRodInstance).lightningRod;
    if (rod.charged) data.lightningrod = { charged: true, chargeleft: rod.chargeleft! };
}

/** A charged save restores its remaining charge (and zaps once, as setcharged does). */
function onload(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    const saved = data.lightningrod;
    if (saved?.charged && saved.chargeleft > 0) (inst as LightningRodInstance).lightningRod.setcharged(saved.chargeleft);
}

/** lightningrod.lua fn(), as far as it is ported: the charge, its battery and the hammer workable. */
export class LightningRodInstance extends PrefabInstance {
    readonly lightningRod: LightningRod;
    declare readonly components: PrefabInstance['components'] & {
        battery: Battery<LightningRod>;
        inspectable: { getstatus(): 'CHARGED' | undefined };
    };

    constructor(world: PrefabWorldContext) {
        super(LIGHTNING_ROD_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
        this.worldServices = world;
        MakeBuildingPersist(this);
        const { OnSave: saveBuilding, OnLoad: loadBuilding } = this;
        this.OnSave = (inst, data) => { saveBuilding!(inst, data); onsave(inst, data); };
        this.OnLoad = (inst, data) => { loadBuilding!(inst, data); onload(inst, data); };
        const workable = this.components.workable = new Workable(this);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnWorkCallback(onhit);
        workable.SetOnFinishCallback(onhammered);
        this.components.lootdropper = createStructureLootDropper(this);

        const rod = this.lightningRod = new LightningRod(this);
        this.addTag('structure');
        this.addTag('lightningrod');
        Object.assign(this.components, {
            battery: rod.battery,
            // getstatus: inst.charged and "CHARGED" or nil
            inspectable: { getstatus: () => rod.charged ? 'CHARGED' : undefined },
        });
        this.ListenForEvent('lightningstrike', () => onlightning(this));
        this.ListenForEvent('onbuilt', () => onbuilt(this));
        this.onRemove(() => rod.dispose());
    }
}

function onbuilt(inst: PrefabInstance): void {
    inst.sprite.playOnce('place');
    inst.sprite.pushAnimation('idle', true);
    PlaySound(CRAFT_SOUND, inst.position);
}

function onhit(inst: PrefabInstance): void {
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation('idle', false);
}

function onhammered(inst: PrefabInstance): void {
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'metal');
    inst.remove();
}

export function lightningRodPrefabs(world: PrefabWorldContext) {
    return { [LIGHTNING_ROD_ID]: buildingPrefab(declaration, 'lightning_rod', undefined, () => new LightningRodInstance(world), world) };
}
