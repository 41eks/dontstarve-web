import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { PrefabInstance, modelHasTag, type EntityTask } from './prefabInstance';
import { Workable } from '../../componets/src/workable';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree } from '../../componets/src/techtree';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import { createRenderEffect } from '@dontstarve-web/signals';
import { BOOK_USE_STEP, BOOKSTATION_RESTORE_AMOUNT, isBook } from './books';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, LoadBuildingSkin, MakeBuildingContainer, SaveBuildingSkin } from './building';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import type { PlacementSaveRecord } from './saveRecord';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt } from './standardcomponents';
import { BurnableBinding } from './treeFire';
import type { PrefabWorldContext } from './worldContext';

export const BOOKSTATION_ID = 'bookstation' as const;
export type BookstationId = typeof BOOKSTATION_ID;

const declaration = definitions.animatedBuildings.bookstation;

export const BOOKSTATION_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives;

/** bookstation.lua MakePlacer("bookstation_placer", "bookstation", "bookstation", "idle"). */
export const BOOKSTATION_PLACER = buildingPlacer(declaration);

// tuning.lua: seg_time, BOOKSTATION_BONUS_RANGE, BOOKSTATION_WICKER_BONUS.
const BOOKSTATION_RESTORE_TIME = 30;
const BOOKSTATION_BONUS_RANGE = 12 * (TILE_SIZE / 4);
const BOOKSTATION_WICKER_BONUS = 2;

const BOOKS_SOME = 'empty';
const BOOKS_MORE = 'mid';
const BOOKS_FULL = 'full';

/** The fields bookstation.lua keeps on inst. */
export class BookstationInstance extends PrefabInstance {
    /** inst.RestoreTask: the periodic RestoreBooks while a book is on the shelf. */
    RestoreTask?: EntityTask;
}

function onhammered(inst: BookstationInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.container?.DropEverything(inst.position);
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

function onhit(inst: BookstationInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = inst.components.prototyper!.on;
    inst.AnimState.PlayAnimation('hit');
    inst.AnimState.PushAnimation(on ? 'proximity_loop' : 'idle', on);
}

/** onsave/onload, with the skin the building save shape keeps beside data.burnt. */
function onsave(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    SaveBuildingSkin(inst, data);
    onsaveBurnt(inst, data);
}

function onload(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    LoadBuildingSkin(inst, data);
    onloadBurnt(inst, data);
}

/** onturnon; the craft animation's _activetask (onactivate) is not ported. */
function onturnon(inst: BookstationInstance): void {
    if (inst.hasTag('burnt')) return;
    if (inst.sprite.currentAnimation === 'place') inst.AnimState.PushAnimation('proximity_loop', true);
    else inst.AnimState.PlayAnimation('proximity_loop', true);
    inst.SoundEmitter!.KillSound('idlesound');
}

function onturnoff(inst: BookstationInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.AnimState.PlayAnimation('idle', true);
    inst.SoundEmitter!.KillSound('proximity_loop');
}

function onbuilt(inst: BookstationInstance): void {
    inst.AnimState.PlayAnimation('place');
    inst.AnimState.PushAnimation('idle', false);
    PlaySound('wickerbottom_rework/bookstation/place', inst.position);
}

function onopen(inst: BookstationInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = inst.components.prototyper!.on;
    inst.AnimState.PlayAnimation('hit');
    inst.AnimState.PushAnimation(on ? 'proximity_loop' : 'idle', on);
    PlaySound('dontstarve/wilson/chest_open', inst.position);
}

function onclose(inst: BookstationInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = inst.components.prototyper!.on;
    inst.AnimState.PlayAnimation('hit');
    inst.AnimState.PushAnimation(on ? 'proximity_loop' : 'idle', on);
    PlaySound('dontstarve/wilson/chest_close', inst.position);
}

/** RestoreBooks: +1% of the maximum uses, doubled while a bookbuilder is within range; the world has one player. */
function RestoreBooks(inst: BookstationInstance): void {
    const player = inst.worldServices?.player;
    const wicker_bonus = player !== undefined && modelHasTag(player, 'bookbuilder')
        && player.position.distanceToSquared(inst.position) <= BOOKSTATION_BONUS_RANGE * BOOKSTATION_BONUS_RANGE ? BOOKSTATION_WICKER_BONUS : 1;
    for (const book of inst.components.container!.GetAllItems()) {
        if (!book.hasTag('book') || !isBook(book.prefab)) continue;
        const percent = book.components.finiteuses.percent.peek();
        if (percent === undefined || percent >= 1) continue;
        book.components.finiteuses.setPercent(percent + BOOKSTATION_RESTORE_AMOUNT * wicker_bonus, BOOK_USE_STEP);
    }
}

function CountBooks(inst: BookstationInstance): number {
    const cmp = inst.components.container;
    return cmp ? cmp.NumItems() / cmp.GetNumSlots() : 0;
}

function UpdateBookAesthetics(inst: BookstationInstance, countoverride?: number): void {
    const count = countoverride ?? CountBooks(inst);
    const show = (layer: string, visible: boolean) => visible ? inst.AnimState.Show(layer) : inst.AnimState.Hide(layer);
    show(BOOKS_SOME, count > 0);
    show(BOOKS_MORE, count >= .5);
    show(BOOKS_FULL, count >= 1);
}

/** container:HasItemWithTag("book", 1); a burnt station has dropped its books and released its container. */
const hasBook = (inst: BookstationInstance) => inst.components.container?.GetAllItems().some(item => item.hasTag('book')) ?? false;

function ItemGet(inst: BookstationInstance): void {
    if (inst.RestoreTask === undefined && hasBook(inst)) inst.RestoreTask = inst.DoPeriodicTask(BOOKSTATION_RESTORE_TIME, RestoreBooks);
    UpdateBookAesthetics(inst);
}

function ItemLose(inst: BookstationInstance): void {
    if (!hasBook(inst) && inst.RestoreTask !== undefined) {
        inst.RestoreTask.Cancel();
        inst.RestoreTask = undefined;
    }
    UpdateBookAesthetics(inst);
}

/**
 * bookstation.lua fn(), as far as it is ported: no craft animation on activate, gifts, inspectable, hauntable, snow
 * cover or lunar hail.
 */
function fn(world: PrefabWorldContext, sprites: SpriteResources): BookstationInstance {
    const { fire, scheduler } = world;
    if (!fire || !scheduler) throw new Error('A bookstation needs the world\'s fire effects and scheduler');
    const inst = new BookstationInstance(BOOKSTATION_ID, new SpriteState({ name: 'idle', held: true, billboard: true }));
    inst.worldServices = world;
    inst.AddSoundEmitter();
    // inst.AnimState: the display dresses every drawn sprite and reskin with the book layers.
    inst.sprite.setAnimState(inst.AnimState.json, sprites.archives);
    UpdateBookAesthetics(inst, 0);
    inst.minimap.SetPriority(5);
    inst.addTag('structure');
    inst.addTag('giftmachine');

    const prototyper = addComponent(inst, 'prototyper', Prototyper, 4 * (TILE_SIZE / 4));
    prototyper.onturnon = onturnon;
    prototyper.onturnoff = onturnoff;
    prototyper.trees = CreateTechTree({ BOOKCRAFT: 1 });

    inst.ListenForEvent('onbuilt', () => onbuilt(inst));

    inst.OnSave = onsave;
    inst.OnLoad = onload;
    const container = MakeBuildingContainer(inst, BOOKSTATION_ID, world);
    container.onopenfn = onopen;
    container.onclosefn = onclose;

    addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
    const workable = addComponent(inst, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(4);
    workable.SetOnFinishCallback(onhammered);
    workable.SetOnWorkCallback(onhit);

    // MakeLargeBurnable(inst, nil, nil, true) and MakeLargePropagator.
    const burn = new BurnableBinding(inst, {
        burnTime: 30, fxLevel: 4, propagator: 'large',
        onExtinguish: () => { PlaySound('dontstarve/common/fireOut', inst.position); },
        onBurnt: () => { DefaultBurntStructureFn(inst); burn.dispose(); },
    }, { fire, scheduler });
    inst.onRemove(() => burn.dispose());

    // ListenForEvent("itemget", ItemGet) / ("itemlose", ItemLose): the container's slots are signals, read here as its
    // events; with a book on the shelf ItemGet's branch applies, without one ItemLose's.
    inst.onRemove(createRenderEffect(() => {
        inst.components.container?.TrackContents();
        if (hasBook(inst)) ItemGet(inst); else ItemLose(inst);
    }));
    return inst;
}

export function bookstationPrefabs(world: PrefabWorldContext) {
    return { [BOOKSTATION_ID]: { ...buildingPrefab(declaration, 'bookstation', .4, (_position, sprites) => fn(world, sprites), world),
        // MiniMapEntity:SetIcon("bookstation.png").
        minimapIcon: 'bookstation.png' } };
}
