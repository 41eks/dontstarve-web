import { addComponent, removeComponent } from './components';
import { SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Leader, PointOfInterest } from '../../componets/src/statueglommerSignatures';
import { Pickable } from './components/pickable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { PlaySound } from './sound';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';

export const STATUEGLOMMER_ID = 'statueglommer' as const;
/** TUNING.ROCKS_MINE. */
export const STATUEGLOMMER_WORK = 6;

export interface StatueGlommerWorld { scheduler: GameTimeScheduler }

SetSharedLootTable('statueglommer', [['marble', 1], ['marble', 1], ['marble', 1]]);

const LIGHT_FRAMES = 6;

export class StatueGlommerInstance extends PrefabInstance {
    declare readonly components: PrefabInstance['components'] & {
        pickable: Pickable; inspectable: Inspectable; hauntable: Hauntable; workable?: Workable; lootdropper?: LootDropper;
    };
    /** inst.spawned: the flower was grown this full moon; nil until the first one is. */
    declare spawned?: boolean;
    /** inst.islighton. */
    declare islighton: boolean;
}

/** OnLightDirty with lightval at LIGHT_FRAMES: PushLight's full radius, as a loaded flower statue finishes its tween at once. */
function OnLightDirty(inst: StatueGlommerInstance, lightval: number): void {
    if (lightval <= 0) { inst.light.set(null); return; }
    inst.light.set({ radius: .75 * lightval / LIGHT_FRAMES * WORLD_SCALE, intensity: .9, falloff: .3,
        colour: [180 / 255, 195 / 255, 150 / 255] });
}

function OnMakeFull(inst: StatueGlommerInstance): void {
    inst.sprite.setSymbolOverride('swap_flower', 'glommer_swap_flower.zip', 'swap_flower');
    inst.sprite.setSymbolHidden('swap_flower', false);
}

function OnWorked(inst: StatueGlommerInstance, _worker: unknown, workleft: number): void {
    if (workleft <= 0) {
        PlaySound('dontstarve/wilson/rock_break', inst.position);
        inst.components.lootdropper?.DropLoot(inst.position);
        inst.sprite.playOnce('low');
        removeComponent(inst, 'workable');
        removeComponent(inst, 'lootdropper');
    } else { inst.sprite.playOnce(workleft < STATUEGLOMMER_WORK * .5 ? 'med' : 'full'); }
}

/**
 * OnSave: data.worked and data.spawned, kept under this project's `statueglommer` key. workable:OnSave also writes the
 * unset maxwork (-1), which this project's Workable leaves out, so the record adds it.
 */
function OnSave(inst: StatueGlommerInstance, data: EntityPersistData): void {
    const worked = inst.components.workable === undefined;
    if (worked || inst.spawned) { data.statueglommer = { ...(worked ? { worked: true } : {}), ...(inst.spawned ? { spawned: true } : {}) }; }
    const workable = inst.components.workable;
    if (workable) { data.workable = { maxwork: workable.maxwork.peek(), workleft: workable.GetWorkLeft() }; }
}

function OnLoad(inst: StatueGlommerInstance, data: EntityPersistData): void {
    const saved = data.statueglommer;
    if (saved) {
        if (saved.worked && inst.components.workable) {
            inst.sprite.playOnce('low');
            removeComponent(inst, 'workable');
            removeComponent(inst, 'lootdropper');
        }
        inst.spawned = saved.spawned === true;
    }
    if (inst.components.pickable.canBePicked && !inst.islighton) {
        inst.islighton = true;
        OnLightDirty(inst, LIGHT_FRAMES);
    }
}

function OnLoadWorked(inst: StatueGlommerInstance): void {
    const workable = inst.components.workable;
    if (!workable) { return; }
    if (workable.GetWorkLeft() <= 0) {
        inst.sprite.playOnce('low');
        removeComponent(inst, 'workable');
        removeComponent(inst, 'lootdropper');
    } else { inst.sprite.playOnce(workable.GetWorkLeft() < STATUEGLOMMER_WORK * .5 ? 'med' : 'full'); }
}

/**
 * statueglommer.lua fn. Its OnInit watch of isfullmoon (SpawnGland / RemoveGland, SpawnGlommer), OnPicked's follower
 * handoff and the leader's OnLoseChild are not ported: no full moon grows the flower here. OnInit's first RemoveGland
 * empties a new statue's shelf, so the flower symbol starts hidden.
 */
function fn(world: StatueGlommerWorld): StatueGlommerInstance {
    const inst = new StatueGlommerInstance(STATUEGLOMMER_ID, new SpriteState({ name: 'full', held: true, billboard: true }));
    inst.minimap.SetPriority(5);
    inst.minimap.SetIcon('statueglommer.png');
    // SetBank / SetBuild("glommer_statue"), PlayAnimation("full") without the loop flag.
    inst.sprite.playOnce('full');
    inst.sprite.setSymbolHidden('swap_flower', true);
    inst.islighton = false;
    inst.addTag('statue');
    addComponent(inst, 'pointofinterest', PointOfInterest);
    addComponent(inst, 'inspectable', Inspectable);
    addComponent(inst, 'leader', Leader);
    // A new pickable has canbepicked nil: the shelf is empty until a full moon or a saved full record.
    const pickable = addComponent(inst, 'pickable', Pickable, 'glommerflower', undefined, 1, undefined, undefined,
        { picked: true }, { scheduler: world.scheduler });
    pickable.savesCanInteractWith = true;
    pickable.makefullfn = () => OnMakeFull(inst);
    const workable = addComponent(inst, 'workable', Workable);
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(STATUEGLOMMER_WORK);
    workable.SetOnWorkCallback(OnWorked);
    workable.savestate = true;
    workable.SetOnLoadFn(() => OnLoadWorked(inst));
    const lootdropper = addComponent(inst, 'lootdropper', LootDropper, () => undefined);
    lootdropper.SetChanceLootTable('statueglommer');
    inst.OnSave = OnSave;
    inst.OnLoad = OnLoad;
    inst.spawned = false;
    const hauntable = addComponent(inst, 'hauntable', Hauntable, world.scheduler);
    // MakeHauntableWork's active Lua branch returns false (its work attempt is commented out).
    hauntable.SetOnHauntFn(() => false);
    return inst;
}

/** The Prefab statueglommer.lua returns. */
export function statueGlommerPrefabs(world: StatueGlommerWorld):
    Readonly<Record<typeof STATUEGLOMMER_ID, PrefabEntityDefinition<StatueGlommerInstance>>> {
    return {
        [STATUEGLOMMER_ID]: {
            fn: () => fn(world),
            assets: { animationArchive: 'glommer_statue.zip', buildArchives: ['glommer_statue.zip', 'glommer_swap_flower.zip'], bank: 'glommer_statue' },
            assetOptions: { instancedAnimations: 'all' },
            physics: { make: MakeObstaclePhysics, radius: .75 },
        },
    };
}
