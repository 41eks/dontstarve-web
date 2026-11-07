import { Workable } from '../../componets/src/workable';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree } from '../../componets/src/techtree';
import { WORLD_SCALE } from './standardcomponents';
import { createStructureLootDropper } from './structureLoot';
import { PrefabInstance } from './prefabInstance';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import { AnimState } from '@dontstarve-web/animation/animState';
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import { Pickable } from './components/pickable';
import { Trader, type TradeItem } from '../../componets/src/trader';
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

function onbuilt(inst: SculptingTableInstance): void {
    inst.playTableSound(PLACE_SOUND);
    inst.sprite.playOnce('place');
    inst.sprite.pushAnimation('idle', false);
}

function onturnon(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    if (inst.sprite.currentAnimation === 'place' || inst.sprite.currentAnimation === 'proximity_loop') {
        inst.sprite.pushAnimation('proximity_loop', true);
    } else inst.sprite.start('proximity_loop');
    const table = inst as SculptingTableInstance;
    table.loop = PlaySound('dontstarve/common/together/sculpting_table/proximity_LP', inst.position);
}

function onturnoff(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    inst.sprite.pushAnimation('idle', false);
    const table = inst as SculptingTableInstance;
    table.loop?.stop();
    table.loop = undefined;
}

function onworked(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = inst.components.prototyper?.on === true;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation(on ? 'proximity_loop' : 'idle', on);
}

function onhammered(inst: PrefabInstance): void {
    inst.components.lootdropper!.DropLoot();
    const { pickable } = inst as SculptingTableInstance;
    if (pickable.canInteractWith && pickable.product) inst.components.lootdropper!.SpawnLootPrefab(pickable.product);
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

/** onsave: data.itemname = caninteractwith and product or nil. The pickable's own record stays out of the save. */
function onsave(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    delete (data as { pickable?: unknown }).pickable;
    const { pickable } = inst as SculptingTableInstance;
    if (pickable.canInteractWith && pickable.product) data.sculptingtable = { itemname: pickable.product };
}

/** onload: giveitem restores the held block. */
function onload(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
    const itemname = data.sculptingtable?.itemname;
    if (itemname !== undefined && isSculptableMaterial(itemname)) (inst as SculptingTableInstance).giveItem(itemname);
}

/** sculptingtable.lua fn(), as far as it is ported: the prototyper, the held block's trader and pickable, and the hammer workable. */
export class SculptingTableInstance extends PrefabInstance {
    readonly pickable: Pickable;
    readonly trader: Trader<TradeItem>;
    private readonly sounds = new Set<SoundHandle>();
    /** inst.AnimState: the display dresses every drawn sprite and reskin with the held block. */
    private readonly animState = new AnimState();
    loop?: SoundHandle;

    constructor(world: PrefabWorldContext, sprites: SpriteResources) {
        super(SCULPTING_TABLE_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
        this.worldServices = world;
        this.sprite.setAnimState(this.animState.json, sprites.archives);
        MakeBuildingPersist(this);
        const { OnSave: saveBuilding, OnLoad: loadBuilding } = this;
        this.OnSave = (inst, data) => { saveBuilding!(inst, data); onsave(inst, data); };
        this.OnLoad = (inst, data) => { loadBuilding!(inst, data); onload(inst, data); };
        this.ListenForEvent('onbuilt', () => onbuilt(this));
        const workable = this.components.workable = new Workable(this);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnWorkCallback(onworked);
        workable.SetOnFinishCallback(onhammered);
        this.components.lootdropper = createStructureLootDropper(this);
        this.addTag('structure');
        const prototyper = this.components.prototyper = new Prototyper(this, 4 * WORLD_SCALE);
        prototyper.trees = CreateTechTree({ SCULPTING: 1 });
        prototyper.onturnon = onturnon;
        prototyper.onturnoff = onturnoff;
        // onitemtaken: the pickable stops being interactable and the block disappears.
        const pickable = this.pickable = new Pickable(this, '', HELD_ITEM_REGEN_TIME, 1, () => {
            if (pickable.canInteractWith) {
                pickable.canInteractWith = false;
                this.playTableSound(ITEM_SOUND);
            }
            this.animState.ClearOverrideSymbol(SCULPTING_SYMBOL);
            prototyper.SetTechLevel('SCULPTING', 1);
        });
        pickable.canInteractWith = false;
        pickable.pause();
        const trader = this.trader = new Trader<TradeItem>(this);
        trader.acceptsNonTradable = true;
        trader.SetAbleToAcceptTest(item => {
            if (pickable.canInteractWith) return { ok: false, reason: 'SLOTFULL' };
            return isSculptableMaterial(item.prefab) ? { ok: true } : { ok: false, reason: 'NOTSCULPTABLE' };
        });
        trader.SetOnAccept((_giver, item) => {
            if (isSculptableMaterial(item.prefab)) this.giveItem(item.prefab);
        });
        this.components.trader = trader;
        this.onRemove(() => {
            prototyper.OnRemoveFromEntity();
            for (const sound of this.sounds) sound.stop();
            this.sounds.clear();
            pickable.dispose();
            trader.dispose();
        });
    }

    playTableSound(path: SoundEventPath): void {
        for (const sound of this.sounds) if (!sound.isPlaying()) this.sounds.delete(sound);
        this.sounds.add(PlaySound(path, this.position));
    }

    /** giveitem: the block becomes pickable and shows the offered material. */
    giveItem(itemname: SculptableMaterial): void {
        const { pickable } = this;
        pickable.SetUp(itemname, HELD_ITEM_REGEN_TIME);
        pickable.pause();
        if (!pickable.canInteractWith) {
            pickable.canInteractWith = true;
            this.playTableSound(ITEM_SOUND);
        }
        const { swapfile, symbol } = SCULPTABLE_MATERIALS[itemname];
        this.animState.OverrideSymbol(SCULPTING_SYMBOL, swapfile, symbol);
        this.components.prototyper!.SetTechLevel('SCULPTING', 2);
    }
}

export function sculptingTablePrefabs(world: PrefabWorldContext) {
    return { [SCULPTING_TABLE_ID]: buildingPrefab(declaration, 'sculpting_station', .4, (_position, sprites) => new SculptingTableInstance(world, sprites), world,
        // The held block is an OverrideSymbol on its AnimState.
        { controller: true }) };
}
