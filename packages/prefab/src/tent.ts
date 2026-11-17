import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { Workable } from '../../componets/src/workable';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import type * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { prefabInstance, PrefabInstance, type EntityTask } from './prefabInstance';
import definitions from './definitions.json' with { type: 'json' };
import { FiniteUses } from '../../componets/src/finiteuses';
import { SleepingBag } from '../../componets/src/sleepingbag';
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import type { PrefabWorldContext } from './worldContext';
import { PlaySound } from './sound';

export const TENT_ID = 'tent' as const;
const declaration: BuildingDeclaration = definitions.animatedBuildings.tent;

/** tent.lua MakePlacer("tent_placer", "tent", "tent", "idle"). */
export const TENT_PLACER = buildingPlacer(declaration, 'tent');
/** TUNING.TENT_USES. */
export const TENT_USES = 15;
// TUNING.SLEEP_HEALTH_PER_TICK doubled by tent.lua, and TUNING.SLEEP_HUNGER_PER_TICK.
const TENT_HEALTH_TICK = 2;
const FRAME = 1 / 30;

export type TentComponents = { sleepingbag: SleepingBag; finiteuses: FiniteUses };

/** The tent's own components, once oninit has run. */
export function getTentComponents(model: THREE.Object3D): TentComponents | undefined {
    const components = prefabInstance(model)?.components;
    return components?.sleepingbag && components.finiteuses ? components as TentComponents : undefined;
}

function onbuilt(inst: PrefabInstance): void {
    inst.sprite.playOnce('place');
    inst.sprite.pushAnimation('idle', true);
}

function PlaySleepLoopSoundTask(inst: TentInstance): void {
    PlaySound('dontstarve/common/tent_sleep', inst.position);
}

function stopsleepsound(inst: TentInstance): void {
    for (const task of inst.sleep_tasks ?? []) task.Cancel();
    inst.sleep_tasks = undefined;
}

function startsleepsound(inst: TentInstance, len: number): void {
    stopsleepsound(inst);
    inst.sleep_tasks = [inst.DoPeriodicTask(len, PlaySleepLoopSoundTask, 33 * FRAME), inst.DoPeriodicTask(len, PlaySleepLoopSoundTask, 47 * FRAME)];
}

function onfinishedsound(inst: TentInstance): void {
    PlaySound('dontstarve/common/tent_dis_twirl', inst.position);
}

/** tent.lua common_fn / tent(): sleepingbag, finiteuses and their sleep, wake, hit and finish callbacks. */
export class TentInstance extends PrefabInstance {
    sleep_tasks?: EntityTask[];

    constructor(world: PrefabWorldContext) {
        super(TENT_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
        if (!world.scheduler) throw new Error('A tent needs the world scheduler');
        this.worldServices = world;
        MakeBuildingPersist(this);
        for (const tag of ['tent', 'structure']) this.addTag(tag);
        const workable = addComponent(this, 'workable', Workable);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnWorkCallback(onworked);
        workable.SetOnFinishCallback(onhammered);
        addComponent(this, 'lootdropper', LootDropper, spawnStructureLoot(this), STRUCTURE_LOOT_RECIPES);

        const uses = addComponent(this, 'finiteuses', FiniteUses);
        uses.SetMaxUses(TENT_USES);
        uses.SetUses(TENT_USES);
        uses.SetOnFinished(() => {
            if (this.hasTag('burnt')) return;
            stopsleepsound(this);
            this.persists = false;
            this.sprite.playOnce('destroy', () => this.remove());
            PlaySound('dontstarve/common/tent_dis_pre', this.position);
            this.DoTaskInTime(16 * FRAME, onfinishedsound);
        });

        const bag = addComponent(this, 'sleepingbag', SleepingBag);
        bag.health_tick = TENT_HEALTH_TICK;
        // sleep_anim: tents loop sleep_loop while occupied.
        bag.onsleep = () => {
            this.sprite.start('sleep_loop');
            startsleepsound(this, this.sprite.currentAnimationLength);
        };
        bag.onwake = () => {
            stopsleepsound(this);
            this.sprite.start('idle');
            uses.Use();
        };
        this.ListenForEvent('onbuilt', () => onbuilt(this));
    }
}

/** tent.lua onhit wakes a sleeper even when the tent is burnt. */
function onworked(inst: TentInstance): void {
    if (!inst.hasTag('burnt')) {
        stopsleepsound(inst);
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
    return { [TENT_ID]: { ...buildingPrefab(declaration, 'tent', 1, () => new TentInstance(world), world), minimapIcon: 'tent.png' } };
}
