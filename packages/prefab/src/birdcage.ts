import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent, removeComponent } from './components';
import { Workable } from '../../componets/src/workable';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { PrefabInstance, type EntityTask } from './prefabInstance';
import { SpriteState } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import catalog from './groundItems.json' with { type: 'json' };
import { AnimState, type AnimStateArt } from '@dontstarve-web/animation/animState';
import { batch, type WorldPhase } from '@dontstarve-web/signals';
import type { InventoryStack, ItemEntity, ItemOwner } from '@dontstarve-web/inventory';
import { Occupiable } from '../../componets/src/occupiable';
import { Shelf } from '../../componets/src/shelf';
import { DefaultSleepTest, DefaultWakeTest, Sleeper } from '../../componets/src/sleeper';
import { Trader, type TradeAcceptance, type TradeItem } from '../../componets/src/trader';
import { Inspectable } from '../../componets/src/inspectable';
import { foods } from '../../componets/src/preparedfoods';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { buildingPlacer, buildingPrefab, LoadBuildingSkin, SaveBuildingSkin, type BuildingDeclaration } from './building';
import type { PlacementSaveRecord } from './saveRecord';
import type { PrefabWorldContext } from './worldContext';
import { BIRD_SOUNDS, isBirdId } from './birds';
import { PlaySound, type SoundEventPath } from './sound';

export const BIRDCAGE_ID = 'birdcage' as const;
export type BirdcageId = typeof BIRDCAGE_ID;
const declaration: BuildingDeclaration = definitions.animatedBuildings.birdcage;
export const BIRDCAGE_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives!;

/** birdcage.lua MakePlacer("birdcage_placer", "birdcage", "bird_cage", "idle_empty"). */
export const BIRDCAGE_PLACER = buildingPlacer(declaration);

/** birdcage.lua CAGE_STATES: the suffix of the idle and hit clips, and the saved CAGE_STATE. */
export const CAGE_STATES = {
    DEAD: '_death',
    SKELETON: '_skeleton',
    EMPTY: '_empty',
    FULL: '_bird',
    SICK: '_sick',
} as const;
export type CageState = typeof CAGE_STATES[keyof typeof CAGE_STATES];
export type BirdcageStatus = 'GENERIC' | 'SLEEPING' | 'STARVING' | 'HUNGRY' | 'OCCUPIED' | 'DEAD' | 'SKELETON';
/** birdcage.lua OnSave plus the occupiable occupant and the inventory's only slot. */
export interface BirdcageSaveStateData {
    cageState: CageState;
    birdType?: string;
    occupant?: InventoryStack;
    item?: InventoryStack;
}

// birdcage.lua BUILD_OVERRIDES: poisoned canaries and mutated birds are not ported.
const BUILD_OVERRIDES: Readonly<Record<string, string>> = { canary_poisoned: 'canary', mutatedbird: 'bird_lunar' };
// birdcage.lua invalid_foods.
const INVALID_FOODS: ReadonlySet<string> = new Set(['bird_egg', 'bird_egg_cooked', 'rottenegg', 'woby_treat']);
// tuning.lua FEED_BIRD_POOP_CHANCE.
const FEED_BIRD_POOP_CHANCE = .33;
const ANIMATION_PERIOD = 6;

const ITEM_SOURCES = catalog.items as unknown as Readonly<Record<string, { readonly source: string }>>;

/** edible.foodtype == FOODTYPE.MEAT: prefabs/meats.lua items and cooked recipes with a MEAT primary type. */
export function isMeatFood(prefab: string): boolean {
    return ITEM_SOURCES[prefab]?.source.endsWith('/meats.lua') === true
        || (Object.hasOwn(foods, prefab) && (foods as Record<string, { foodtype?: string }>)[prefab].foodtype === 'MEAT');
}

const isSeedItem = (prefab: string) => prefab === 'seeds' || prefab.includes('_seeds');
const seedOf = (prefab: string) => `${prefab.toLowerCase()}_seeds`;

/** birdcage.lua ShouldAcceptItem for an unpossessed (non-mutant) bird. */
export function birdcageAcceptsItem(prefab: string): boolean {
    return !INVALID_FOODS.has(prefab) && (Object.hasOwn(ITEM_SOURCES, seedOf(prefab)) || isSeedItem(prefab) || isMeatFood(prefab));
}

/** birdcage.lua DigestFood: the product spawned by a fed item. */
export function digestedFoodProduct(prefab: string, random: () => number = Math.random): string | undefined {
    if (isMeatFood(prefab)) return 'bird_egg';
    if (Object.hasOwn(ITEM_SOURCES, seedOf(prefab))) return seedOf(prefab);
    // TryLuckRoll without luck: roll <= chance. The shrunken guano scale is not ported.
    return random() <= FEED_BIRD_POOP_CHANCE ? 'guano' : undefined;
}

interface BirdcageComponents {
    inspectable: Inspectable;
    lootdropper: LootDropper;
    occupiable?: Occupiable<ItemEntity, BirdcageInstance>;
    workable: Workable<BirdcageInstance>;
    trader: Trader<TradeItem, unknown, BirdcageInstance>;
    shelf: Shelf<ItemEntity, BirdcageInstance>;
    sleeper?: Sleeper;
}

/** birdcage.lua's fields on the inst; fn is the constructor. */
export class BirdcageInstance extends PrefabInstance {
    declare readonly components: PrefabInstance['components'] & BirdcageComponents;
    /** inst.CAGE_STATE */
    CAGE_STATE: CageState = CAGE_STATES.EMPTY;
    /** inst.bird_type: OnEmptied keeps it, as OnBirdStarve reads it afterwards. */
    bird_type?: string;
    /** inst.chirpsound */
    chirpsound?: SoundEventPath;
    /** inst.AnimationTask */
    AnimationTask?: EntityTask;
    /** inst.components.inventory's only slot (maxslots = 1). */
    slot?: ItemEntity;
    /** RemoveEventCallback for item.OnRotFn. */
    stopRot?: () => void;
    /** The bird's appearance slot; the cage's own skin declaration stays independent. */
    readonly birdAnimState = new AnimState();

    constructor(world: PrefabWorldContext, art?: AnimStateArt) {
        super(BIRDCAGE_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
        this.worldServices = world;
        this.sprite.declareAnimState('bird', this.birdAnimState.json, art);
        for (const tag of ['structure', 'cage', 'sanityaura']) this.addTag(tag);

        addComponent(this, 'inspectable', Inspectable).getstatus = () => GetStatus(this);
        addComponent(this, 'lootdropper', LootDropper, spawnStructureLoot(this), STRUCTURE_LOOT_RECIPES);
        AddOccupiable(this);

        const workable = addComponent(this, 'workable', Workable<BirdcageInstance>);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnFinishCallback(OnWorkFinished);
        workable.SetOnWorkCallback(OnWorked);

        const trader = addComponent(this, 'trader', Trader<TradeItem, unknown, BirdcageInstance>);
        trader.SetAbleToAcceptTest(AbleToAcceptTest);
        trader.SetAcceptTest(ShouldAcceptItem);
        trader.SetOnAccept(OnGetItem);
        trader.SetOnRefuse(OnRefuseItem);
        trader.Disable();

        // inst:AddComponent("inventory"): the shelf's one-slot holder.
        const shelf = addComponent(this, 'shelf', Shelf<ItemEntity, BirdcageInstance>, {
            RemoveItem: item => RemoveItem(this, item),
            DropItem: item => DropItem(this, item),
        });
        shelf.SetOnShelfItem(OnGetShelfItem);
        shelf.SetOnTakeItem(OnLoseShelfItem);

        this.ListenForEvent('onbuilt', OnBuilt);
        this.ListenForEvent('gotosleep', GoToSleep);
        this.ListenForEvent('onwakeup', WakeUp);

        this.OnSave = OnSave;
        this.OnLoad = OnLoad;
        this.onRemove(() => OnRemoveEntity(this));
    }
}

const GetBird = (inst: BirdcageInstance): ItemEntity | undefined => inst.components.occupiable?.GetOccupant();

/** GetHunger: the bird's remaining freshness. */
function GetHunger(bird: ItemEntity | undefined): number {
    return bird?.components.perishable.percent.peek() ?? 1;
}

/** SetBirdType: swap the override build for the bird's own build. */
function SetBirdType(inst: BirdcageInstance, bird: string | undefined): void {
    if (inst.bird_type !== undefined) inst.birdAnimState.ClearOverrideBuild(`${inst.bird_type}_build`);
    inst.bird_type = bird === undefined ? undefined : BUILD_OVERRIDES[bird] ?? bird;
    if (inst.bird_type !== undefined && isBirdId(inst.bird_type)) inst.birdAnimState.AddOverrideBuild(`${inst.bird_type}_build`);
}

function SetCageState(inst: BirdcageInstance, state: CageState): void {
    inst.CAGE_STATE = state;
}

function PlayStateAnim(inst: BirdcageInstance, anim: string, loop = false): void {
    inst.AnimState.PlayAnimation(anim + inst.CAGE_STATE, loop);
}

function PushStateAnim(inst: BirdcageInstance, anim: string, loop = false): void {
    inst.AnimState.PushAnimation(anim + inst.CAGE_STATE, loop);
}

function DoPlaySound(inst: BirdcageInstance, soundname: SoundEventPath | undefined): void {
    if (soundname) PlaySound(soundname, inst.position);
}

/** The world's perish clock reaches a bird or item the cage now holds. */
function BindPerishWorld(inst: BirdcageInstance, item: ItemEntity): void {
    const { perishClock, scheduler } = inst.worldServices ?? {};
    if (perishClock && scheduler) item.components.perishable.BindWorld({ perishClock, scheduler });
}

function DigestFood(inst: BirdcageInstance, prefab: string): void {
    const product = digestedFoodProduct(prefab);
    if (product) inst.worldServices?.dropLoot?.([{ itemId: product, count: 1 }], inst.position.clone());
    // Refill bird stomach.
    const bird = GetBird(inst);
    if (bird && !bird.isRemoved) bird.components.perishable.SetPercent(1);
}

/** trader.lua AbleToAccept's sleeper check. */
function AbleToAcceptTest(inst: BirdcageInstance): TradeAcceptance {
    return inst.components.sleeper?.IsAsleep() ? { ok: false, reason: 'SLEEPING' } : { ok: true };
}

function ShouldAcceptItem(_inst: BirdcageInstance, item: TradeItem): boolean {
    return birdcageAcceptsItem(item.prefab);
}

function OnGetItem(inst: BirdcageInstance, _giver: unknown, item: TradeItem): void {
    // If you're sleeping, wake up.
    if (inst.components.sleeper?.IsAsleep()) inst.components.sleeper.WakeUp();
    const prefab = item.prefab;
    if (isMeatFood(prefab) || isSeedItem(prefab) || Object.hasOwn(ITEM_SOURCES, seedOf(prefab))) {
        // Peck, peck, peck, hop, idle; the food is digested 60 frames later.
        inst.sprite.playOnce('peck');
        inst.sprite.pushAnimation('peck');
        inst.sprite.pushAnimation('peck');
        inst.sprite.pushAnimation('hop');
        PushStateAnim(inst, 'idle', true);
        inst.DoTaskInTime(60 * FRAMES, () => DigestFood(inst, prefab));
    }
}

function OnRefuseItem(inst: BirdcageInstance): void {
    inst.sprite.playOnce('flap');
    PushStateAnim(inst, 'idle', true);
    DoPlaySound(inst, 'dontstarve/birds/wingflap_cage');
}

/** DoAnimationTask: the hunger of the bird picks the idle variant and its sounds. */
function DoAnimationTask(inst: BirdcageInstance): void {
    const hunger = GetHunger(GetBird(inst));
    const rand = Math.random();
    const chirp = inst.chirpsound;
    const soundAt = (frame: number, sound: SoundEventPath | undefined) => inst.DoTaskInTime(frame * FRAMES, () => DoPlaySound(inst, sound));
    if (hunger < .33) {
        if (rand < .75) {
            inst.sprite.playOnce('idle_bird3');
            for (const frame of [5, 15, 28, 99]) soundAt(frame, 'dontstarve/birds/wingflap_cage');
            for (const frame of [4, 27, 42, 100]) soundAt(frame, chirp);
        }
    } else if (hunger < .66) {
        if (rand < .5) {
            inst.sprite.playOnce('idle_bird2');
            for (const frame of [26, 81, 96]) soundAt(frame, chirp);
        }
    } else if (rand < .5) {
        inst.sprite.playOnce('caw');
        DoPlaySound(inst, chirp);
    } else if (rand < .6) {
        inst.sprite.playOnce('flap');
        DoPlaySound(inst, 'dontstarve/birds/wingflap_cage');
    } else inst.sprite.playOnce('hop');
    PushStateAnim(inst, 'idle', true);
}

function StartAnimationTask(inst: BirdcageInstance): void {
    inst.AnimationTask?.Cancel();
    inst.AnimationTask = inst.DoPeriodicTask(ANIMATION_PERIOD, DoAnimationTask);
}

function StopAnimationTask(inst: BirdcageInstance): void {
    inst.AnimationTask?.Cancel();
    inst.AnimationTask = undefined;
}

function ShouldSleep(inst: BirdcageInstance, cycle: WorldPhase): boolean {
    const bird = GetBird(inst);
    return bird !== undefined && DefaultSleepTest(inst, cycle) && GetHunger(bird) >= .33;
}

function ShouldWake(inst: BirdcageInstance, cycle: WorldPhase): boolean {
    const bird = GetBird(inst);
    return bird !== undefined && DefaultWakeTest(inst, cycle) || GetHunger(bird) < .33;
}

function GoToSleep(inst: BirdcageInstance): void {
    if (inst.components.occupiable?.IsOccupied()) {
        StopAnimationTask(inst);
        inst.sprite.playOnce('sleep_pre');
        inst.sprite.pushAnimation('sleep_loop', true);
    }
}

function WakeUp(inst: BirdcageInstance): void {
    if (inst.components.occupiable?.IsOccupied()) {
        inst.sprite.playOnce('sleep_pst');
        PushStateAnim(inst, 'idle', true);
        StartAnimationTask(inst);
    }
}

function OnOccupied(inst: BirdcageInstance, bird: ItemEntity): void {
    BindPerishWorld(inst, bird);
    SetCageState(inst, CAGE_STATES.FULL);
    // Only if the bird can actually sleep: every ported bird has a sleeper in birds.lua.
    const getWatchWorldContent = inst.worldServices?.getWatchWorldContent;
    if (getWatchWorldContent) {
        const sleeper = addComponent(inst, 'sleeper', Sleeper, getWatchWorldContent);
        sleeper.sleeptestfn = ShouldSleep;
        sleeper.waketestfn = ShouldWake;
    }
    inst.components.trader.Enable();
    SetBirdType(inst, bird.prefab);
    inst.chirpsound = isBirdId(bird.prefab) ? BIRD_SOUNDS[bird.prefab].chirp : undefined;
    inst.sprite.playOnce('flap');
    DoPlaySound(inst, 'dontstarve/birds/wingflap_cage');
    PushStateAnim(inst, 'idle', true);
    StartAnimationTask(inst);
}

function OnEmptied(inst: BirdcageInstance): void {
    if (inst.bird_type !== undefined) inst.birdAnimState.ClearOverrideBuild(`${inst.bird_type}_build`);
    SetCageState(inst, CAGE_STATES.EMPTY);
    removeComponent(inst, 'sleeper');
    inst.components.trader.Disable();
    PlayStateAnim(inst, 'idle', false);
    StopAnimationTask(inst);
}

function OnWorkFinished(inst: BirdcageInstance): void {
    // If there is a bird inside drop the proper loot (bird, meat or rot).
    if (inst.components.occupiable?.IsOccupied()) {
        const item = inst.components.occupiable.Harvest();
        if (item) inst.worldServices?.dropItem?.(item, inst.position.clone());
    }
    inst.components.lootdropper.DropLoot();
    if (inst.slot) DropItem(inst, inst.slot);
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'metal');
    inst.remove();
}

function OnWorked(inst: BirdcageInstance): void {
    PlayStateAnim(inst, 'hit', false);
    if (inst.components.occupiable?.IsOccupied()) {
        inst.sprite.pushAnimation('flap');
        DoPlaySound(inst, 'dontstarve/birds/wingflap_cage');
    }
    PushStateAnim(inst, 'idle', true);
}

function OnBuilt(inst: BirdcageInstance): void {
    inst.sprite.playOnce('place');
    PushStateAnim(inst, 'idle', false);
    DoPlaySound(inst, 'dontstarve/common/birdcage_craft');
}

function OnBirdRot(inst: BirdcageInstance): void {
    StopAnimationTask(inst);
    SetCageState(inst, CAGE_STATES.SKELETON);
    PlayStateAnim(inst, 'idle', false);
    // Mutated birds do not have a skeleton to show so always default back to one that does.
    SetBirdType(inst, 'crow');
    inst.DoTaskInTime(0, () => {
        if (inst.slot) inst.components.shelf.PutItemOnShelf(inst.slot);
    });
}

function OnBirdStarve(inst: BirdcageInstance): void {
    const bird = GetBird(inst);
    StopAnimationTask(inst);
    SetCageState(inst, CAGE_STATES.DEAD);
    inst.sprite.playOnce('death');
    if (bird && isBirdId(bird.prefab)) DoPlaySound(inst, BIRD_SOUNDS[bird.prefab].death);
    PushStateAnim(inst, 'idle', false);
    // Needed here because OnEmptied is called before this callback, which clears the build override.
    SetBirdType(inst, inst.bird_type);
    // Put loot on "shelf".
    const loot = inst.worldServices?.spawnItem?.({ itemId: 'smallmeat', count: 1 });
    if (loot) {
        GiveItem(inst, loot);
        inst.components.shelf.PutItemOnShelf(loot);
    }
}

/** The occupiable fn registers, and OnLoseShelfItem registers again after OnGetShelfItem removed it. */
function AddOccupiable(inst: BirdcageInstance): void {
    const occupiable = addComponent(inst, 'occupiable', Occupiable<ItemEntity, BirdcageInstance>);
    occupiable.occupanttype = 'bird';
    occupiable.onoccupied = OnOccupied;
    occupiable.onemptied = OnEmptied;
    occupiable.onperishfn = OnBirdStarve;
}

/** inventory:GiveItem on the cage's only slot. */
function GiveItem(inst: BirdcageInstance, item: ItemEntity): void {
    inst.slot = item;
    item.components.inventoryitem.owner = SlotOwner(inst, item);
}

function SlotOwner(inst: BirdcageInstance, item: ItemEntity): ItemOwner {
    return {
        address: { containerId: `world:birdcage:${String(inst.entityId)}`, slotKey: '0' },
        changed() {},
        remove: () => { RemoveItem(inst, item); item.destroy(); return true; },
        replace: prefab => {
            if (inst.slot !== item) return false;
            const replacement = inst.worldServices?.spawnItem?.({ itemId: prefab, count: item.components.stackable.count });
            if (!replacement) return false;
            RemoveItem(inst, item);
            item.destroy();
            GiveItem(inst, replacement);
            return true;
        },
        PushEvent() {},
    };
}

/** inventory:RemoveItem on the cage's only slot. */
function RemoveItem(inst: BirdcageInstance, item: ItemEntity): void {
    if (inst.slot !== item) return;
    inst.slot = undefined;
    item.components.inventoryitem.owner = null;
}

/** inventory:DropItem on the cage's only slot. */
function DropItem(inst: BirdcageInstance, item: ItemEntity): void {
    RemoveItem(inst, item);
    inst.worldServices?.dropItem?.(item, inst.position.clone());
}

function OnGetShelfItem(inst: BirdcageInstance, item: ItemEntity): void {
    BindPerishWorld(inst, item);
    // De-activate occupiable.
    removeComponent(inst, 'occupiable');
    inst.components.shelf.cantakeitem = true;
    inst.stopRot?.();
    inst.stopRot = item.ListenForEvent('perished', () => OnBirdRot(inst));
}

function OnLoseShelfItem(inst: BirdcageInstance): void {
    inst.stopRot?.();
    inst.stopRot = undefined;
    // Activate occupiable.
    if (!inst.components.occupiable) AddOccupiable(inst);
    const bird = GetBird(inst);
    if (bird) OnOccupied(inst, bird);
    else OnEmptied(inst);
}

/** OnSave: CAGE_STATE, bird_type, the occupant and the inventory slot. */
function OnSave(inst: BirdcageInstance, data: PlacementSaveRecord['components']): void {
    SaveBuildingSkin(inst, data);
    const occupant = GetBird(inst);
    occupant?.flush();
    inst.slot?.flush();
    data.birdcage = {
        cageState: inst.CAGE_STATE,
        ...(inst.bird_type === undefined ? {} : { birdType: inst.bird_type }),
        ...(occupant ? { occupant: occupant.snapshot() } : {}),
        ...(inst.slot ? { item: inst.slot.snapshot() } : {}),
    };
}

/** OnLoad, then OnLoadPostPass: components first (the occupant), then the inst data and the shelf. */
function OnLoad(inst: BirdcageInstance, data: PlacementSaveRecord['components']): void {
    LoadBuildingSkin(inst, data);
    const saved = data.birdcage;
    if (!saved) return;
    const spawnItem = inst.worldServices?.spawnItem;
    batch(() => {
        if (saved.occupant) {
            const bird = spawnItem?.(saved.occupant);
            if (bird) inst.components.occupiable?.Occupy(bird);
        }
        if (saved.item) {
            const held = spawnItem?.(saved.item);
            if (held) GiveItem(inst, held);
        }
        SetCageState(inst, saved.cageState);
        if (saved.birdType !== undefined) SetBirdType(inst, saved.birdType);
    });
    PlayStateAnim(inst, 'idle', true);
    // Check in inventory, put on shelf if needed.
    if (inst.slot) inst.components.shelf.PutItemOnShelf(inst.slot);
}

/** GetStatus */
function GetStatus(inst: BirdcageInstance): BirdcageStatus {
    if (inst.CAGE_STATE === CAGE_STATES.EMPTY) return 'GENERIC';
    if (inst.CAGE_STATE === CAGE_STATES.FULL) {
        const hunger = GetHunger(GetBird(inst));
        return inst.components.sleeper?.IsAsleep() ? 'SLEEPING' : hunger < .33 ? 'STARVING' : hunger < .66 ? 'HUNGRY' : 'OCCUPIED';
    }
    if (inst.CAGE_STATE === CAGE_STATES.DEAD || inst.CAGE_STATE === CAGE_STATES.SICK) return 'DEAD';
    return 'SKELETON';
}

function OnRemoveEntity(inst: BirdcageInstance): void {
    inst.stopRot?.();
    inst.sprite.declareAnimState('bird', undefined);
}

export function birdcagePrefabs(world: PrefabWorldContext) {
    return { [BIRDCAGE_ID]: buildingPrefab(declaration, 'birdcage', .5, (_position, sprites) => new BirdcageInstance(world, sprites.archives), world) };
}
