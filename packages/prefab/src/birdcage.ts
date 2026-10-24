import * as THREE from 'three';
import definitions from './definitions.json' with { type: 'json' };
import catalog from './groundItems.json' with { type: 'json' };
import { birdcage_init_fn } from '@dontstarve-web/animation/prefabskin';
import { loadBuildOverride, type LoadedBuildOverride, type SpriteController } from '@dontstarve-web/animation/sprite';
import { batch, createMemo, createSignal, readonlySignal, getWatchWorldContent, type ReadonlySignal, type GetWatchWorldContent, type WorldContentEnvironment, type WorldPhase } from '@dontstarve-web/signals';
import type { InventoryStack, ItemEntity, ItemOwner } from '@dontstarve-web/inventory';
import { Occupiable } from '../../componets/src/occupiable';
import { Shelf, type ShelfHolder, type ShelfTaker } from '../../componets/src/shelf';
import { DefaultSleepTest, DefaultWakeTest, Sleeper, type SleeperInst } from '../../componets/src/sleeper';
import { ComponentTimer } from '../../componets/src/timer';
import { Trader, type TradeItem } from '../../componets/src/trader';
import { foods } from '../../componets/src/preparedfoods';
import { FRAMES } from '../../stategraphs/src/stategraph';
import type {
    AnimatedBuildingBuiltContext,
    AnimatedBuildingDefinition,
    AnimatedBuildingEventContext,
    AnimatedBuildingHammerContext,
    AnimatedBuildingPreparedResources,
} from './animatedBuildingPlacement';
import { actionEntity } from './actionEntity';
import { BIRD_IDS, BIRD_SOUNDS, isBirdId, type BirdId } from './birds';
import { PlaySound, PreloadSounds, type SoundEventPath } from './sound';

export const BIRDCAGE_ID = 'birdcage' as const;
export type BirdcageId = typeof BIRDCAGE_ID;
export const BIRDCAGE_SKIN_ARCHIVES: Readonly<Record<string, string>> = definitions.animatedBuildings.birdcage.skinArchives;

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
export type BirdcageSaveState = BirdcageSaveStateData;

// birdcage.lua BUILD_OVERRIDES: poisoned canaries and mutated birds are not ported.
const BUILD_OVERRIDES: Readonly<Record<string, string>> = { canary_poisoned: 'canary', mutatedbird: 'bird_lunar' };
// birdcage.lua invalid_foods.
const INVALID_FOODS: ReadonlySet<string> = new Set(['bird_egg', 'bird_egg_cooked', 'rottenegg', 'woby_treat']);
// tuning.lua FEED_BIRD_POOP_CHANCE.
const FEED_BIRD_POOP_CHANCE = .33;
const ANIMATION_PERIOD = 6;

const ITEM_SOURCES = catalog.items as unknown as Readonly<Record<string, { readonly source: string }>>;
const ALL_SOUNDS: readonly SoundEventPath[] = [
    'dontstarve/birds/wingflap_cage', 'dontstarve/common/birdcage_craft',
    ...BIRD_IDS.flatMap(id => [BIRD_SOUNDS[id].chirp, BIRD_SOUNDS[id].death]),
];

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

interface BirdcageResources extends AnimatedBuildingPreparedResources {
    readonly builds: Readonly<Record<BirdId, LoadedBuildOverride>>;
}

async function prepare(): Promise<BirdcageResources> {
    const base = `${import.meta.env.BASE_URL}dst/data/anim`;
    const [builds] = await Promise.all([
        Promise.all(BIRD_IDS.map(id => loadBuildOverride(base, `${id}_build.zip`))),
        PreloadSounds(...ALL_SOUNDS),
    ]);
    return {
        materials: builds.flatMap(build => build.materials),
        builds: Object.fromEntries(BIRD_IDS.map((id, index) => [id, builds[index]])) as BirdcageResources['builds'],
    };
}

/** AnimState Play/PushAnimation: pushed clips wait for the current one-shot clip to finish. */
class CageAnimation {
    private queue: { name: string; loop: boolean }[] = [];
    private playingOnce = false;
    private readonly controller: () => SpriteController;
    constructor(controller: () => SpriteController) { this.controller = controller; }

    play(name: string, loop = false): void {
        this.queue = [];
        this.run(name, loop);
    }

    push(name: string, loop = false): void {
        if (this.playingOnce) this.queue.push({ name, loop });
        else this.run(name, loop);
    }

    private run(name: string, loop: boolean): void {
        const controller = this.controller();
        this.playingOnce = !loop;
        if (loop) controller.start(name);
        else controller.playOnce(name, () => this.finish());
    }

    private finish(): void {
        this.playingOnce = false;
        const next = this.queue.shift();
        if (next) this.run(next.name, next.loop);
    }
}

type CageEntity = ReturnType<typeof actionEntity>;

/** birdcage.lua prefab logic for one cage inst. */
export class Birdcage {
    private readonly cageStateSignal = createSignal<CageState>(CAGE_STATES.EMPTY);
    readonly cageState: ReadonlySignal<CageState> = readonlySignal(this.cageStateSignal);
    private readonly birdTypeSignal = createSignal<string | undefined>(undefined);
    readonly birdType: ReadonlySignal<string | undefined> = readonlySignal(this.birdTypeSignal);
    /** The inventory's only slot (maxslots = 1). */
    private slot: ItemEntity | undefined;
    occupiable: Occupiable<ItemEntity, CageEntity> | undefined;
    readonly shelf: Shelf<ItemEntity, CageEntity>;
    readonly trader: Trader<TradeItem>;
    private readonly sleeperSignal = createSignal<Sleeper | undefined>(undefined);
    get sleeper(): Sleeper | undefined { return this.sleeperSignal.peek(); }
    readonly status: ReadonlySignal<BirdcageStatus | undefined>;
    private readonly statusMemo;
    private stopSleepAnimation: (() => void) | undefined;
    private readonly animation: CageAnimation;
    private readonly animationTask: ComponentTimer | undefined;
    private chirpsound: SoundEventPath | undefined;
    private activeBuild: string | undefined;
    private stopRot: (() => void) | undefined;
    private readonly cancels = new Set<() => void>();
    private disposed = false;
    private readonly context: AnimatedBuildingEventContext;
    private readonly getWatchWorldContent: GetWatchWorldContent | undefined;
    private readonly entity: CageEntity;
    private readonly random: () => number;
    resources: BirdcageResources | undefined;

    constructor(context: AnimatedBuildingEventContext, random: () => number = Math.random) {
        this.context = context;
        this.getWatchWorldContent = context.world?.getWatchWorldContent;
        const scheduler = context.world?.scheduler;
        if (!this.getWatchWorldContent && scheduler) {
            const sources: WorldContentEnvironment = {
                wind: context.world?.wind ?? readonlySignal(createSignal({ angle: 0, velocity: 1 })),
                perishTick: context.world?.perishTick ?? readonlySignal(createSignal({ time: scheduler.now, total: 0 })),
                perishClock: context.world?.perishClock,
                snowLevel: context.world?.snowLevel ?? readonlySignal(createSignal(0)),
                playerpositions: context.world?.playerpositions ?? readonlySignal(createSignal<THREE.Vector3[]>([])),
                moon: context.world?.moon ?? readonlySignal(createSignal({ phase: 'new', waxing: true })),
                scheduler, temperature: context.world?.temperature ?? readonlySignal(createSignal(30)),
                cycle: context.world?.cycle ?? readonlySignal(createSignal<WorldPhase>('day')),
                season: context.world?.season ?? readonlySignal(createSignal({ season: 'spring', progress: .5 })),
            };
            this.getWatchWorldContent = (key, registerCleanup) => getWatchWorldContent(key, registerCleanup, sources);
        }
        this.random = random;
        this.resources = context.prepared as BirdcageResources | undefined;
        const entity = this.entity = actionEntity(context.model, BIRDCAGE_ID);
        this.animation = new CageAnimation(() => context.model.userData.animationController as SpriteController);
        this.animationTask = scheduler ? new ComponentTimer(scheduler, () => { this.doAnimationTask(); this.animationTask!.start(ANIMATION_PERIOD); }) : undefined;
        for (const tag of ['structure', 'cage']) entity.addTag(tag);
        this.shelf = new Shelf<ItemEntity, CageEntity>(entity, this.holder);
        this.shelf.SetOnShelfItem((_inst, item) => this.onGetShelfItem(item));
        this.shelf.SetOnTakeItem((_inst, taker, item) => this.onLoseShelfItem(taker, item));
        this.trader = new Trader<TradeItem>(entity);
        this.trader.SetAbleToAcceptTest(() => this.sleeper?.IsAsleep() ? { ok: false, reason: 'SLEEPING' } : { ok: true });
        this.trader.SetAcceptTest(item => birdcageAcceptsItem(item.prefab));
        this.trader.SetOnAccept((giver, item) => this.onGetItem(giver, item));
        this.trader.SetOnRefuse(() => this.onRefuseItem());
        this.trader.Disable();
        this.addOccupiable();
        this.statusMemo = createMemo((): BirdcageStatus | undefined => this.computeStatus());
        this.status = readonlySignal(this.statusMemo);
        const components = entity.components as Record<string, unknown>;
        components.shelf = this.shelf;
        components.trader = this.trader;
        components.birdcage = this;
    }

    // --- state -------------------------------------------------------------------------------

    private get controller(): SpriteController { return this.context.model.userData.animationController as SpriteController; }
    private get position(): THREE.Vector3 { return this.context.model.position; }
    private get groundPosition(): THREE.Vector3 { return this.entity.getPosition(); }
    get item(): ItemEntity | undefined { return this.slot; }
    getBird(): ItemEntity | undefined { return this.occupiable?.GetOccupant(); }

    private setCageState(state: CageState): void { this.cageStateSignal.set(state); }

    /** birdcage.lua GetHunger: the bird's remaining freshness. */
    private hungerOf(bird: ItemEntity | undefined): number {
        const percent = bird?.components.perishable.percent.peek();
        return bird && percent !== undefined ? percent : 1;
    }

    /** birdcage.lua GetStatus; undefined once the cage no longer has a state worth reporting. */
    private computeStatus(): BirdcageStatus | undefined {
        const state = this.cageStateSignal.get();
        if (state === CAGE_STATES.EMPTY) return 'GENERIC';
        if (state === CAGE_STATES.FULL) {
            const percent = this.occupiable?.occupant.get()?.components.perishable.percent.get();
            const hunger = percent ?? 1;
            return this.sleeperSignal.get()?.isasleep.get() ? 'SLEEPING' : hunger < .33 ? 'STARVING' : hunger < .66 ? 'HUNGRY' : 'OCCUPIED';
        }
        if (state === CAGE_STATES.DEAD || state === CAGE_STATES.SICK) return 'DEAD';
        return 'SKELETON';
    }

    // --- animation helpers -------------------------------------------------------------------

    private playStateAnim(name: string, loop = false): void { this.animation.play(name + this.cageStateSignal.peek(), loop); }
    private pushStateAnim(name: string, loop = false): void { this.animation.push(name + this.cageStateSignal.peek(), loop); }

    private doTaskInTime(seconds: number, run: () => void): void {
        const scheduler = this.context.world?.scheduler;
        if (!scheduler) return;
        const cancel = scheduler.schedule(seconds, () => { this.cancels.delete(cancel); if (!this.disposed) run(); });
        this.cancels.add(cancel);
    }

    private playSound(path: SoundEventPath | undefined): void { if (path) PlaySound(path, this.position); }

    // --- bird build ---------------------------------------------------------------------------

    /** birdcage.lua SetBirdType: swap the override build for the bird's own build. */
    setBirdType(bird: string | undefined): void {
        if (this.activeBuild !== undefined) this.controller.clearOverrideBuild(this.activeBuild);
        this.activeBuild = undefined;
        const type = bird === undefined ? undefined : BUILD_OVERRIDES[bird] ?? bird;
        this.birdTypeSignal.set(type);
        const build = type !== undefined && isBirdId(type) ? this.resources?.builds[type] : undefined;
        if (type !== undefined && build) {
            this.activeBuild = `${type}_build`;
            this.controller.addOverrideBuild(this.activeBuild, build);
        }
    }

    /** A reskin replaces the controller and the prepared builds; re-apply the displayed bird. */
    reapplyArt(resources: BirdcageResources | undefined): void {
        this.resources = resources;
        this.activeBuild = undefined;
        const type = this.birdTypeSignal.peek();
        const build = type !== undefined && isBirdId(type) ? resources?.builds[type] : undefined;
        if (type !== undefined && build) {
            this.activeBuild = `${type}_build`;
            this.controller.addOverrideBuild(this.activeBuild, build);
        }
    }

    // --- occupiable ---------------------------------------------------------------------------

    private addOccupiable(): void {
        const occupiable = new Occupiable<ItemEntity, CageEntity>(this.entity);
        occupiable.occupanttype = 'bird';
        occupiable.onoccupied = (_inst, bird) => this.onOccupied(bird);
        occupiable.onemptied = () => this.onEmptied();
        occupiable.onperishfn = (_inst, bird) => this.onBirdStarve(bird);
        this.occupiable = occupiable;
        (this.entity.components as Record<string, unknown>).occupiable = occupiable;
    }

    private removeOccupiable(): void {
        this.occupiable?.dispose();
        this.occupiable = undefined;
        delete (this.entity.components as Record<string, unknown>).occupiable;
    }

    private onOccupied(bird: ItemEntity): void {
        if (this.context.world?.perishClock) bird.components.perishable.BindWorld({ perishClock: this.context.world.perishClock });
        this.setCageState(CAGE_STATES.FULL);
        // Only if the bird can actually sleep: every ported bird has a sleeper in birds.lua.
        if (this.getWatchWorldContent && !this.sleeper) {
            const sleeper = new Sleeper(this.sleeperInst(), this.getWatchWorldContent, this.random);
            sleeper.sleeptestfn = (inst, cycle) => this.shouldSleep(inst, cycle);
            sleeper.waketestfn = (inst, cycle) => this.shouldWake(inst, cycle);
            this.sleeperSignal.set(sleeper);
            (this.entity.components as Record<string, unknown>).sleeper = sleeper;
            this.stopSleepAnimation = sleeper.isasleep.subscribe(asleep => {
                if (!this.occupiable?.IsOccupied()) return;
                if (asleep) {
                    this.stopAnimationTask();
                    this.animation.play('sleep_pre');
                    this.animation.push('sleep_loop', true);
                } else {
                    this.animation.play('sleep_pst');
                    this.pushStateAnim('idle', true);
                    this.startAnimationTask();
                }
            });
        }
        this.trader.Enable();
        this.setBirdType(bird.prefab);
        this.chirpsound = isBirdId(bird.prefab) ? BIRD_SOUNDS[bird.prefab].chirp : undefined;
        this.animation.play('flap');
        this.playSound('dontstarve/birds/wingflap_cage');
        this.pushStateAnim('idle', true);
        this.startAnimationTask();
    }

    private onEmptied(): void {
        if (this.activeBuild !== undefined) this.controller.clearOverrideBuild(this.activeBuild);
        this.activeBuild = undefined;
        this.setCageState(CAGE_STATES.EMPTY);
        this.removeSleeper();
        this.trader.Disable();
        this.playStateAnim('idle', false);
        this.stopAnimationTask();
    }

    private removeSleeper(): void {
        this.stopSleepAnimation?.();
        this.stopSleepAnimation = undefined;
        this.sleeper?.dispose();
        this.sleeperSignal.set(undefined);
        delete (this.entity.components as Record<string, unknown>).sleeper;
    }

    /** The bird starved: drop its death state and shelve the meat. */
    private onBirdStarve(bird: ItemEntity): void {
        this.stopAnimationTask();
        this.setCageState(CAGE_STATES.DEAD);
        this.animation.play('death');
        if (isBirdId(bird.prefab)) this.playSound(BIRD_SOUNDS[bird.prefab].death);
        this.pushStateAnim('idle', false);
        // Needed because onEmptied already cleared the override build.
        this.setBirdType(this.birdTypeSignal.peek());
        const loot = this.context.world?.spawnItem?.({ itemId: 'smallmeat', count: 1 });
        if (loot) {
            this.giveItem(loot);
            this.shelf.PutItemOnShelf(loot);
        }
    }

    // --- sleeper -----------------------------------------------------------------------------

    private sleeperInst(): SleeperInst {
        const cage = this;
        return {
            isValid: () => !cage.disposed,
            PushEvent: (name, data) => cage.entity.PushEvent?.(name, data),
            components: {},
        };
    }

    private shouldSleep(inst: SleeperInst, cycle: WorldPhase): boolean {
        const bird = this.getBird();
        return bird !== undefined && DefaultSleepTest(inst, cycle) && this.hungerOf(bird) >= .33;
    }

    private shouldWake(inst: SleeperInst, cycle: WorldPhase): boolean {
        const bird = this.getBird();
        return bird !== undefined && DefaultWakeTest(inst, cycle) || this.hungerOf(bird) < .33;
    }

    // --- periodic idle animation ---------------------------------------------------------------

    private startAnimationTask(): void { this.animationTask?.start(ANIMATION_PERIOD); }
    private stopAnimationTask(): void { this.animationTask?.stop(); }

    /** DoAnimationTask: the hunger of the bird picks the idle variant and its sounds. */
    private doAnimationTask(): void {
        const bird = this.getBird();
        const hunger = this.hungerOf(bird);
        const rand = this.random();
        const chirp = this.chirpsound;
        if (hunger < .33) {
            if (rand < .75) {
                this.animation.play('idle_bird3');
                for (const frame of [5, 15, 28, 99]) this.doTaskInTime(frame * FRAMES, () => this.playSound('dontstarve/birds/wingflap_cage'));
                for (const frame of [4, 27, 42, 100]) this.doTaskInTime(frame * FRAMES, () => this.playSound(chirp));
            }
        } else if (hunger < .66) {
            if (rand < .5) {
                this.animation.play('idle_bird2');
                for (const frame of [26, 81, 96]) this.doTaskInTime(frame * FRAMES, () => this.playSound(chirp));
            }
        } else if (rand < .5) {
            this.animation.play('caw');
            this.playSound(chirp);
        } else if (rand < .6) {
            this.animation.play('flap');
            this.playSound('dontstarve/birds/wingflap_cage');
        } else this.animation.play('hop');
        this.pushStateAnim('idle', true);
    }

    // --- trader -------------------------------------------------------------------------------

    private onGetItem(_giver: unknown, item: TradeItem): void {
        // If you're sleeping, wake up.
        if (this.sleeper?.IsAsleep()) this.sleeper.WakeUp();
        const prefab = item.prefab;
        if (isMeatFood(prefab) || isSeedItem(prefab) || Object.hasOwn(ITEM_SOURCES, seedOf(prefab))) {
            // Peck, peck, peck, hop, idle; the food is digested 60 frames later.
            this.animation.play('peck');
            this.animation.push('peck');
            this.animation.push('peck');
            this.animation.push('hop');
            this.pushStateAnim('idle', true);
            this.doTaskInTime(60 * FRAMES, () => this.digestFood(prefab));
        }
    }

    private onRefuseItem(): void {
        this.animation.play('flap');
        this.pushStateAnim('idle', true);
        this.playSound('dontstarve/birds/wingflap_cage');
    }

    private digestFood(prefab: string): void {
        const product = digestedFoodProduct(prefab, this.random);
        if (product) this.context.world?.dropLoot?.([{ itemId: product, count: 1 }], this.groundPosition.clone());
        // Refill the bird's stomach.
        const bird = this.getBird();
        if (bird && !bird.isRemoved) bird.components.perishable.SetPercent(1);
    }

    // --- shelf and inventory ----------------------------------------------------------------

    /** inventory:GiveItem on the cage's only slot. */
    private giveItem(item: ItemEntity): void {
        this.slot = item;
        item.components.inventoryitem.owner = this.slotOwner(item);
    }

    private slotOwner(item: ItemEntity): ItemOwner {
        const cage = this;
        const id = String(cage.context.model.userData.entityId);
        return {
            address: { containerId: `world:birdcage:${id}`, slotKey: '0' },
            changed() {},
            remove: () => { cage.holder.RemoveItem(item); item.destroy(); return true; },
            replace: prefab => {
                if (cage.slot !== item) return false;
                const replacement = cage.context.world?.spawnItem?.({ itemId: prefab, count: item.components.stackable.count });
                if (!replacement) return false;
                cage.holder.RemoveItem(item);
                item.destroy();
                cage.giveItem(replacement);
                return true;
            },
            PushEvent() {},
        };
    }

    private readonly holder: ShelfHolder<ItemEntity> = {
        RemoveItem: (item) => {
            if (this.slot !== item) return;
            this.slot = undefined;
            item.components.inventoryitem.owner = null;
        },
        DropItem: (item) => {
            if (this.slot === item) this.holder.RemoveItem(item);
            this.context.world?.dropItem?.(item, this.groundPosition.clone());
        },
    };

    private onGetShelfItem(item: ItemEntity): void {
        if (this.context.world?.perishClock) item.components.perishable.BindWorld({ perishClock: this.context.world.perishClock });
        // De-activate occupiable.
        this.removeOccupiable();
        this.shelf.cantakeitem = true;
        this.stopRot?.();
        this.stopRot = item.ListenForEvent('perished', () => this.onBirdRot());
    }

    private onLoseShelfItem(_taker: ShelfTaker<ItemEntity> | undefined, _item: ItemEntity): void {
        this.stopRot?.();
        this.stopRot = undefined;
        // Activate occupiable.
        if (!this.occupiable) this.addOccupiable();
        const bird = this.getBird();
        if (bird) this.onOccupied(bird);
        else this.onEmptied();
    }

    private onBirdRot(): void {
        this.stopAnimationTask();
        this.setCageState(CAGE_STATES.SKELETON);
        this.playStateAnim('idle', false);
        // Mutated birds do not have a skeleton to show so always default back to one that does.
        this.setBirdType('crow');
        this.doTaskInTime(0, () => {
            if (this.slot) this.shelf.PutItemOnShelf(this.slot);
        });
    }

    // --- work --------------------------------------------------------------------------------

    /** OnWorked: hit clip of the state; an occupied cage flaps. */
    onWorked(): void {
        this.playStateAnim('hit', false);
        if (this.occupiable?.IsOccupied()) {
            this.animation.push('flap');
            this.playSound('dontstarve/birds/wingflap_cage');
        }
        this.pushStateAnim('idle', true);
    }

    /** OnWorkFinished: the occupant and the shelved item leave with the destroyed cage. */
    dropContents(): void {
        if (this.occupiable?.IsOccupied()) {
            const item = this.occupiable.Harvest();
            if (item) this.context.world?.dropItem?.(item, this.groundPosition.clone());
        }
        const held = this.slot;
        if (held) this.holder.DropItem(held);
    }

    /** OnBuilt */
    onBuilt(): void {
        this.animation.play('place');
        this.pushStateAnim('idle', false);
        this.playSound('dontstarve/common/birdcage_craft');
    }

    // --- persistence -------------------------------------------------------------------------

    /** OnSave: CAGE_STATE, bird_type, the occupant and the inventory slot. */
    save(): BirdcageSaveState {
        const occupant = this.getBird();
        occupant?.flush();
        this.slot?.flush();
        return {
            cageState: this.cageStateSignal.peek(),
            ...(this.birdTypeSignal.peek() === undefined ? {} : { birdType: this.birdTypeSignal.peek() }),
            ...(occupant ? { occupant: occupant.snapshot() } : {}),
            ...(this.slot ? { item: this.slot.snapshot() } : {}),
        };
    }

    /** OnLoad, then OnLoadPostPass: components first (the occupant), then the inst data and the shelf. */
    restore(data: BirdcageSaveState): void {
        const world = this.context.world;
        batch(() => {
            if (data.occupant && this.occupiable) {
                const bird = world?.spawnItem?.(data.occupant);
                if (bird) this.occupiable.Occupy(bird);
            }
            if (data.item) {
                const held = world?.spawnItem?.(data.item);
                if (held) this.giveItem(held);
            }
            this.setCageState(data.cageState);
            if (data.birdType !== undefined) this.setBirdType(data.birdType);
        });
        this.playStateAnim('idle', true);
        // Check in the inventory, put on the shelf if needed.
        if (this.slot) this.shelf.PutItemOnShelf(this.slot);
    }

    /** Perishing of the occupant and the shelved item settles with the shared 60-frame batches. */
    update(dt: number): void {
        const world = this.context.world;
        // The scene registry already updates registered items, including the cage's occupant and shelf.
        if (world?.itemEntities) return;
        const perishWorld = world?.perishClock ? { perishClock: world.perishClock } : undefined;
        this.getBird()?.components.perishable.onFrame(dt, perishWorld);
        this.slot?.components.perishable.onFrame(dt, perishWorld);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        for (const cancel of this.cancels) cancel();
        this.cancels.clear();
        this.animationTask?.stop();
        this.stopRot?.();
        this.removeSleeper();
        this.occupiable?.dispose();
        this.shelf.dispose();
        this.trader.dispose();
        this.statusMemo.dispose();
    }
}

const cageOf = (model: THREE.Object3D): Birdcage => model.userData.actionEntity.components.birdcage;

function oninit(context: AnimatedBuildingEventContext): void {
    new Birdcage(context);
}

function onbuilt({ model, onComplete }: AnimatedBuildingBuiltContext): void {
    const cage = cageOf(model);
    cage.onBuilt();
    // The place clip is followed by idle_empty; completion is reported after the placement clip.
    onComplete();
}

function onhit({ model }: AnimatedBuildingHammerContext): void {
    cageOf(model).onWorked();
}

export const BIRDCAGE_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.birdcage,
    hammerWorkLeft: 4, hammerMaterial: 'metal',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse_small' },
    skinInit: birdcage_init_fn,
    prepare,
    oninit,
    onbuilt,
    onhit,
    hammerDropEntities: ({ model }) => cageOf(model).dropContents(),
    onrestore: ({ model }, components) => { if (components.birdcage) cageOf(model).restore(components.birdcage); },
    exportComponents: ({ model }) => ({ birdcage: cageOf(model).save() }),
    onreskin: ({ model, prepared }) => cageOf(model).reapplyArt(prepared as BirdcageResources | undefined),
    onupdate: ({ model }, dt) => cageOf(model).update(dt),
    ondispose: ({ model }) => cageOf(model).dispose(),
};
