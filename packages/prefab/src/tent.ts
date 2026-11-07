import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import type * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { prefabInstance, PrefabInstance } from './prefabInstance';
import definitions from './definitions.json' with { type: 'json' };
import { FiniteUses } from '../../componets/src/finiteuses';
import { SleepingBag } from '../../componets/src/sleepingbag';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import type { PrefabWorldContext } from './worldContext';
import { PlaySound } from './sound';

export const TENT_ID = 'tent' as const;
const declaration: BuildingDeclaration = definitions.animatedBuildings.tent;

/** tent.lua MakePlacer("tent_placer", "tent", "tent", "idle"). */
export const TENT_PLACER = buildingPlacer(declaration);
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

function onbuilt(inst: PrefabInstance): void {
    inst.sprite.playOnce('place');
    inst.sprite.pushAnimation('idle', true);
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
export class TentInstance extends PrefabInstance {
    private sleepSounds: (() => void)[] = [];

    constructor(world: PrefabWorldContext) {
        super(TENT_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
        const { scheduler } = world;
        if (!scheduler) throw new Error('A tent needs the world scheduler');
        this.worldServices = world;
        MakeBuildingPersist(this);
        for (const tag of ['tent', 'structure']) this.addTag(tag);
        const workable = this.components.workable = new Workable(this);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnWorkCallback(onworked);
        workable.SetOnFinishCallback(onhammered);
        this.components.lootdropper = createStructureLootDropper(this);

        const uses = new FiniteUses(this);
        uses.SetMaxUses(TENT_USES);
        uses.SetUses(TENT_USES);
        uses.SetOnFinished(() => {
            if (this.hasTag('burnt')) return;
            this.stopSleepSound();
            this.persists = false;
            this.sprite.playOnce('destroy', () => this.remove());
            PlaySound('dontstarve/common/tent_dis_pre', this.position);
            scheduler.schedule(16 * FRAME, () => PlaySound('dontstarve/common/tent_dis_twirl', this.position));
        });

        const bag = new SleepingBag(this);
        bag.health_tick = TENT_HEALTH_TICK;
        // sleep_anim: tents loop sleep_loop while occupied.
        bag.onsleep = () => {
            this.sprite.start('sleep_loop');
            this.startSleepSound(scheduler, this.sprite.currentAnimationLength);
        };
        bag.onwake = () => {
            this.stopSleepSound();
            this.sprite.start('idle');
            uses.Use();
        };
        Object.assign(this.components, { sleepingbag: bag, finiteuses: uses });
        this.ListenForEvent('onbuilt', () => onbuilt(this));
        this.onRemove(() => {
            this.stopSleepSound();
            bag.dispose();
            uses.dispose();
        });
    }

    private startSleepSound(scheduler: GameTimeScheduler, length: number): void {
        this.stopSleepSound();
        const play = () => PlaySound('dontstarve/common/tent_sleep', this.position);
        this.sleepSounds = [periodic(scheduler, length, 33 * FRAME, play), periodic(scheduler, length, 47 * FRAME, play)];
    }

    stopSleepSound(): void { for (const cancel of this.sleepSounds.splice(0)) cancel(); }
}

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

/** The Prefab table tent.lua returns for the tent; the placer is the build flow's. */
export function tentPrefabs(world: PrefabWorldContext) {
    return { [TENT_ID]: buildingPrefab(declaration, 'tent', 1, () => new TentInstance(world), world) };
}
