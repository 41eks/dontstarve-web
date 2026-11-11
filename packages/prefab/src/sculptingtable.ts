import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { Workable } from '../../componets/src/workable';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree } from '../../componets/src/techtree';
import { WORLD_SCALE } from './standardcomponents';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { PrefabInstance } from './prefabInstance';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, LoadBuildingSkin, SaveBuildingSkin, type BuildingDeclaration } from './building';
import { Pickable } from './components/pickable';
import { Trader, type TradeAcceptance, type TradeItem } from '../../componets/src/trader';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import type { PlacementSaveRecord } from './saveRecord';
import type { PrefabWorldContext } from './worldContext';

export const SCULPTING_TABLE_ID = 'sculptingtable' as const;
export type SculptingTableId = typeof SCULPTING_TABLE_ID;
const declaration: BuildingDeclaration = definitions.animatedBuildings.sculptingtable;
export const SCULPTING_TABLE_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives!;

/** sculptingtable.lua MakePlacer("sculptingtable_placer", "sculpting_station", "sculpting_station", "idle"). */
export const SCULPTING_TABLE_PLACER = buildingPlacer(declaration);

/** sculptingtable.lua sculptable_materials: swapfile/symbol replace the table's block symbol. */
export const SCULPTABLE_MATERIALS = {
    marble: { swapfile: 'marble', symbol: 'marble01' },
    cutstone: { swapfile: 'cutstone', symbol: 'cutstone01' },
} as const;
export type SculptableMaterial = keyof typeof SCULPTABLE_MATERIALS;

export function isSculptableMaterial(itemId: string): itemId is SculptableMaterial {
    return Object.hasOwn(SCULPTABLE_MATERIALS, itemId);
}

export type SculptingTableSaveState = NonNullable<PlacementSaveRecord['components']['sculptingtable']>;

// pickable:SetUp(itemname, 1000000) then Pause(): the held item never regrows.
const HELD_ITEM_REGEN_TIME = 1000000;
const SCULPTING_SYMBOL = 'cutstone01';
const PLACE_SOUND = 'dontstarve/common/together/sculpting_table/craft';
const ITEM_SOUND = 'dontstarve/common/together/moonbase/moonstaff_place';

/** inst.SoundEmitter:PlaySound: one-shots stop when the table is removed. */
function playsound(inst: SculptingTableInstance, path: SoundEventPath): void {
    for (const sound of inst._sounds) if (!sound.isPlaying()) inst._sounds.delete(sound);
    inst._sounds.add(PlaySound(path, inst.position));
}

function onhammered(inst: SculptingTableInstance): void {
    inst.components.lootdropper!.DropLoot();
    const { pickable } = inst.components;
    if (pickable.canInteractWith && pickable.product) inst.components.lootdropper!.SpawnLootPrefab(pickable.product);
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

function onhit(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = inst.components.prototyper?.on === true;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation(on ? 'proximity_loop' : 'idle', on);
}

function onbuilt(inst: SculptingTableInstance): void {
    inst.sprite.playOnce('place');
    inst.sprite.pushAnimation('idle', false);
    playsound(inst, PLACE_SOUND);
}

/** onitemtaken: the pickable stops being interactable and the block disappears. */
function onitemtaken(inst: SculptingTableInstance): void {
    const { pickable } = inst.components;
    if (pickable.canInteractWith) {
        pickable.canInteractWith = false;
        playsound(inst, ITEM_SOUND);
    }
    inst.AnimState.ClearOverrideSymbol(SCULPTING_SYMBOL);
    inst.components.prototyper!.SetTechLevel('SCULPTING', 1);
}

/** giveitem: the block becomes pickable and shows the offered material. */
function giveitem(inst: SculptingTableInstance, itemname: SculptableMaterial): void {
    const { pickable } = inst.components;
    pickable.SetUp(itemname, HELD_ITEM_REGEN_TIME);
    pickable.pause();
    if (!pickable.canInteractWith) {
        pickable.canInteractWith = true;
        playsound(inst, ITEM_SOUND);
    }
    inst.AnimState.ClearOverrideSymbol(SCULPTING_SYMBOL);
    const { swapfile, symbol } = SCULPTABLE_MATERIALS[itemname];
    inst.AnimState.OverrideSymbol(SCULPTING_SYMBOL, swapfile, symbol);
    inst.components.prototyper!.SetTechLevel('SCULPTING', 2);
}

function ongivenitem(inst: SculptingTableInstance, _giver: unknown, item: TradeItem): void {
    if (isSculptableMaterial(item.prefab)) giveitem(inst, item.prefab);
}

function abletoaccepttest(inst: SculptingTableInstance, item: TradeItem): TradeAcceptance {
    if (inst.components.pickable.canInteractWith) return { ok: false, reason: 'SLOTFULL' };
    return isSculptableMaterial(item.prefab) ? { ok: true } : { ok: false, reason: 'NOTSCULPTABLE' };
}

function onturnon(inst: SculptingTableInstance): void {
    if (inst.hasTag('burnt')) return;
    if (inst.sprite.currentAnimation === 'place' || inst.sprite.currentAnimation === 'proximity_loop') {
        inst.sprite.pushAnimation('proximity_loop', true);
    } else inst.sprite.start('proximity_loop');
    inst._loop?.stop();
    inst._loop = PlaySound('dontstarve/common/together/sculpting_table/proximity_LP', inst.position);
}

function onturnoff(inst: SculptingTableInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.sprite.pushAnimation('idle', false);
    inst._loop?.stop();
    inst._loop = undefined;
}

/** onsave: data.itemname = caninteractwith and product or nil. The pickable's own record stays out of the save. */
function onsave(inst: SculptingTableInstance, data: PlacementSaveRecord['components']): void {
    SaveBuildingSkin(inst, data);
    delete (data as { pickable?: unknown }).pickable;
    const { pickable } = inst.components;
    if (pickable.canInteractWith && pickable.product) data.sculptingtable = { itemname: pickable.product };
}

/** onload: giveitem restores the held block. */
function onload(inst: SculptingTableInstance, data: PlacementSaveRecord['components']): void {
    LoadBuildingSkin(inst, data);
    const itemname = data.sculptingtable?.itemname;
    if (itemname !== undefined && isSculptableMaterial(itemname)) giveitem(inst, itemname);
}

function OnRemoveEntity(inst: SculptingTableInstance): void {
    for (const sound of inst._sounds) sound.stop();
    inst._sounds.clear();
    inst._loop?.stop();
    inst._loop = undefined;
}

/** sculptingtable.lua's fields on the inst; fn() below registers the module callbacks on it. */
export class SculptingTableInstance extends PrefabInstance {
    declare readonly components: PrefabInstance['components'] & {
        pickable: Pickable;
        trader: Trader<TradeItem, unknown, SculptingTableInstance>;
    };
    /** inst.SoundEmitter: one-shot sounds and the "loop" named sound. */
    readonly _sounds = new Set<SoundHandle>();
    _loop?: SoundHandle;

    constructor(sprites: SpriteResources) {
        super(SCULPTING_TABLE_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
        // inst.AnimState: the display dresses every drawn sprite and reskin with the held block.
        this.sprite.setAnimState(this.AnimState.json, sprites.archives);
    }
}

/** sculptingtable.lua fn(), as far as it is ported: the prototyper, the held block's trader and pickable, and the hammer workable. */
function fn(world: PrefabWorldContext, sprites: SpriteResources): SculptingTableInstance {
    const inst = new SculptingTableInstance(sprites);
    inst.worldServices = world;
    inst.minimap.SetPriority(5);
    inst.addTag('structure');

    const prototyper = addComponent(inst, 'prototyper', Prototyper, 4 * WORLD_SCALE);
    prototyper.trees = CreateTechTree({ SCULPTING: 1 });
    prototyper.onturnon = onturnon;
    prototyper.onturnoff = onturnoff;

    // pickable:SetUp(itemname, 1000000) then Pause(): the held item never regrows.
    const pickable = addComponent(inst, 'pickable', Pickable, '', HELD_ITEM_REGEN_TIME, 1);
    pickable.canInteractWith = false;
    pickable.onpickedfn = onitemtaken;
    pickable.pause();

    const trader = addComponent(inst, 'trader', Trader<TradeItem, unknown, SculptingTableInstance>);
    trader.SetAbleToAcceptTest(abletoaccepttest);
    trader.acceptsNonTradable = true;
    trader.SetOnAccept(ongivenitem);

    addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
    const workable = addComponent(inst, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(4);
    workable.SetOnFinishCallback(onhammered);
    workable.SetOnWorkCallback(onhit);

    inst.OnSave = onsave;
    inst.OnLoad = onload;

    inst.ListenForEvent('onbuilt', () => onbuilt(inst));
    inst.onRemove(() => OnRemoveEntity(inst));
    return inst;
}

export function sculptingTablePrefabs(world: PrefabWorldContext) {
    return { [SCULPTING_TABLE_ID]: { ...buildingPrefab(declaration, 'sculpting_station', .4, (_position, sprites) => fn(world, sprites), world), minimapIcon: 'sculpting_station.png' } };
}
