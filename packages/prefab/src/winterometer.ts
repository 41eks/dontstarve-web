import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance } from './prefabInstance';
import type { ReadonlyVector3 } from './transform';
import definitions from './definitions.json' with { type: 'json' };
import { ComponentTimer } from '../../componets/src/timer';
import { OVERHEAT_TEMP } from '../../componets/src/temperatureoverrider';
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import { PlaySound } from './sound';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt } from './standardcomponents';
import { BurnableBinding } from './treeFire';
import type { PrefabWorldContext } from './worldContext';

export const WINTEROMETER_ID = 'winterometer' as const;
export type WinterometerId = typeof WINTEROMETER_ID;
const declaration: BuildingDeclaration = definitions.animatedBuildings.winterometer;
export const WINTEROMETER_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives!;

/** winterometer.lua MakePlacer("winterometer_placer", "winter_meter", "winter_meter", "idle"). */
export const WINTEROMETER_PLACER = buildingPlacer(declaration);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** winterometer.lua's DoPeriodicTask(1, DoCheckTemp, 0), owned as a restartable game-time timer. */
class WinterometerCheck {
    private readonly timer: ComponentTimer;
    private readonly inst: PrefabInstance;
    constructor(inst: PrefabInstance, world: PrefabWorldContext & { scheduler: NonNullable<PrefabWorldContext['scheduler']> }) {
        this.inst = inst;
        this.timer = new ComponentTimer(world.scheduler, () => {
            this.check();
            this.timer.start(1);
        });
        // Lua's burntup listener cancels the task; later starts are refused by the burnt tag.
        inst.ListenForEvent('burntup', () => this.cancel());
    }

    /** DoCheckTemp: the meter reads GetLocalTemperature(inst), clamped to [0, OVERHEAT_TEMP]. */
    check(): void {
        const { inst } = this, world = inst.worldServices;
        if (inst.hasTag('burnt') || inst.isRemoved || !world?.getLocalTemperature) return;
        const temperature = world.getLocalTemperature(inst.position.x, inst.position.z);
        inst.sprite.setPercent('meter', 1 - clamp(temperature, 0, OVERHEAT_TEMP) / OVERHEAT_TEMP);
    }

    /** StartCheckTemp: arms at most one task; delay 0 makes the first reading on the next tick. */
    start(): void {
        if (this.inst.hasTag('burnt') || this.inst.isRemoved) return;
        if (this.timer.snapshot.peek().status === 'scheduled') return;
        this.timer.start(0);
    }

    cancel(): void { this.timer.stop(); }
}

function onbuilt(inst: WinterometerInstance): void {
    const check = inst.temperatureCheck;
    check.cancel();
    // The global animover handler restarts the check task.
    inst.sprite.playOnce('place', () => check.start());
    PlaySound('dontstarve/common/winter_meter_craft', inst.position);
}

function onworked(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    const check = (inst as WinterometerInstance).temperatureCheck;
    check.cancel();
    inst.sprite.playOnce('hit', () => check.start());
}

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

/** winterometer.lua fn(), as far as it is ported: the temperature check, the hammer workable and MakeSmallBurnable. */
export class WinterometerInstance extends PrefabInstance {
    readonly temperatureCheck: WinterometerCheck;

    constructor(world: PrefabWorldContext, position: ReadonlyVector3) {
        super(WINTEROMETER_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
        const { fire, scheduler } = world;
        if (!fire || !scheduler) throw new Error('A winterometer needs the world\'s fire effects and scheduler');
        this.worldServices = world;
        // The first reading in fn is taken where the meter stands.
        this.setPosition(position.x, 0, position.z);
        MakeBuildingPersist(this);
        const { OnSave: saveBuilding, OnLoad: loadBuilding } = this;
        this.OnSave = (inst, data) => { saveBuilding!(inst, data); onsaveBurnt(inst, data); };
        this.OnLoad = (inst, data) => { loadBuilding!(inst, data); onloadBurnt(inst, data); };
        this.addTag('structure');
        const workable = this.components.workable = new Workable(this);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnWorkCallback(onworked);
        workable.SetOnFinishCallback(onhammered);
        this.components.lootdropper = createStructureLootDropper(this);
        const check = this.temperatureCheck = new WinterometerCheck(this, { ...world, scheduler });
        this.onRemove(() => check.cancel());
        this.ListenForEvent('onbuilt', () => onbuilt(this));
        // MakeSmallBurnable(inst, nil, nil, true): SMALL_BURNTIME, fire level 2, small propagator, burnt structure.
        const burn = new BurnableBinding(this, {
            burnTime: 10, fxLevel: 2, propagator: 'small',
            onExtinguish: () => { PlaySound('dontstarve/common/fireOut', this.position); },
            onBurnt: () => { DefaultBurntStructureFn(this); burn.dispose(); },
        }, { fire, scheduler });
        this.onRemove(() => burn.dispose());
        check.check();
        check.start();
    }
}

export function winterometerPrefabs(world: PrefabWorldContext) {
    return { [WINTEROMETER_ID]: buildingPrefab(declaration, 'winter_meter', .4, position => new WinterometerInstance(world, position), world) };
}
