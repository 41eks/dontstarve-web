import type { PrefabInstance } from './prefabInstance';
import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import { type SpriteState } from '@dontstarve-web/display';
import * as THREE from 'three';
import { createRenderEffect, createSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { bookstation_init_fn } from '@dontstarve-web/animation/prefabskin';
import { ComponentTimer } from '../../componets/src/timer';
import { actionEntity } from './actionEntity';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import { BOOK_USE_STEP, BOOKSTATION_RESTORE_AMOUNT, isBook } from './books';
import definitions from './definitions.json' with { type: 'json' };
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import type { BuildingContainer } from './containers';
import type { WorldContext, PrefabWorldContext } from './worldContext';
import { modelHasTag, prefabInstance } from './prefabInstance';

export const BOOKSTATION_ID = 'bookstation' as const;
export type BookstationId = typeof BOOKSTATION_ID;
export const BOOKSTATION_SKIN_ARCHIVES: Readonly<Record<string, string>> =
    definitions.animatedBuildings.bookstation.skinArchives;

// tuning.lua: seg_time, BOOKSTATION_RESTORE_AMOUNT, BOOKSTATION_BONUS_RANGE, BOOKSTATION_WICKER_BONUS.
const BOOKSTATION_RESTORE_TIME = 30;
const BOOKSTATION_BONUS_RANGE = 12 * (TILE_SIZE / 4);
const BOOKSTATION_WICKER_BONUS = 2;

const BOOKS_SOME = 'empty';
const BOOKS_MORE = 'mid';
const BOOKS_FULL = 'full';

interface BookstationHost {
    readonly model: THREE.Group;
    readonly container: BuildingContainer;
    readonly world: PrefabWorldContext;
    /** Changes whenever the drawn sprite is rebuilt, so the book layers are shown again. */
    readonly art?: ReadonlySignal<number>;
}

/** bookstation.lua's RestoreTask, book-count art and prototyper on/off state for one placed inst. */
export class Bookstation {
    private readonly host: BookstationHost;
    private readonly restoreTimer: ComponentTimer;
    private readonly stopLifecycle: () => void;
    private readonly stopAesthetics: () => void;
    private readonly bookCount = createSignal(0);
    private stopWatching?: () => void;
    private disposed = false;
    /** prototyper.on: the player is close enough for onturnon. */
    on = false;

    constructor(host: BookstationHost) {
        this.host = host;
        const scheduler = host.world.scheduler;
        if (!scheduler) throw new Error('A bookstation needs the world scheduler');
        this.restoreTimer = new ComponentTimer(scheduler, () => this.RestoreBooks());
        this.stopLifecycle = host.container.subscribeLifecycle(() => this.refresh());
        const onBurnt = () => this.stopTimer();
        host.model.addEventListener('burntup' as never, onBurnt);
        this.stopWatching = () => host.model.removeEventListener('burntup' as never, onBurnt);
        // UpdateBookAesthetics: Show/Hide the book layers by fullness, also on every rebuilt sprite and reskin.
        this.stopAesthetics = createRenderEffect(() => {
            host.art?.get();
            const count = this.bookCount.get(), animation = this.animation;
            if (!animation) return;
            const show = (layer: string, visible: boolean) => visible ? animation.showLayer(layer) : animation.hideLayer(layer);
            show(BOOKS_SOME, count > 0);
            show(BOOKS_MORE, count >= .5);
            show(BOOKS_FULL, count >= 1);
        });
        this.refresh();
    }

    get restore() { return this.restoreTimer.snapshot; }

    private get animation(): SpriteState { return (prefabInstance(this.host.model)!.sprite as SpriteState); }

    /** ItemGet / ItemLose: start or cancel the restore task, then UpdateBookAesthetics. */
    private refresh(): void {
        if (this.disposed) return;
        const { container } = this.host;
        const hasBook = container.GetAllItems().some(item => item.hasTag('book'));
        const running = this.restoreTimer.snapshot.peek().status === 'scheduled';
        if (hasBook && !running) this.restoreTimer.start(BOOKSTATION_RESTORE_TIME);
        else if (!hasBook && running) this.restoreTimer.stop();
        this.bookCount.set(this.countBooks());
    }

    private stopTimer(): void { this.restoreTimer.stop(); }

    private countBooks(): number {
        const { container } = this.host;
        return container.NumItems() / container.GetNumSlots();
    }

    /** RestoreBooks: +1% of the maximum uses, doubled while a bookbuilder is within range. */
    RestoreBooks(): void {
        if (this.disposed) return;
        const { container, model, world } = this.host;
        const player = world.player;
        const nearPlayer = player.position.distanceToSquared(prefabInstance(model)!.position)
            <= BOOKSTATION_BONUS_RANGE * BOOKSTATION_BONUS_RANGE;
        const bonus = nearPlayer && modelHasTag(player, 'bookbuilder')
            ? BOOKSTATION_WICKER_BONUS : 1;
        for (const book of container.GetAllItems()) {
            if (!book.hasTag('book') || !isBook(book.prefab)) continue;
            const percent = book.components.finiteuses.percent.peek();
            if (percent === undefined || percent >= 1) continue;
            book.components.finiteuses.setPercent(percent + BOOKSTATION_RESTORE_AMOUNT * bonus, BOOK_USE_STEP);
        }
        // DoPeriodicTask: publishing refreshes the UI and re-arms the next period while books remain.
        container.publishDTO();
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.stopLifecycle();
        this.stopAesthetics();
        this.stopWatching?.();
        this.restoreTimer.stop();
    }
}

interface BookstationInstance extends PrefabInstance { bookstation?: Bookstation }

function bookstationOf(model: THREE.Group): Bookstation | undefined {
    return (prefabInstance(model)! as BookstationInstance).bookstation;
}

/** The animation that follows a one-shot clip: proximity_loop while prototyper.on, else idle. */
function settle({ model, animation }: Pick<AnimatedBuildingEventContext, 'model' | 'animation'>): void {
    animation.start(bookstationOf(model)?.on ? 'proximity_loop' : 'idle');
}

function onbuilt(context: AnimatedBuildingBuiltContext): void {
    PlaySound('wickerbottom_rework/bookstation/place', context.model.position);
    context.animation.playOnce('place', () => {
        settle(context);
        context.onComplete();
    });
}

function oninit({ model, instance, world, art }: AnimatedBuildingEventContext): void {
    const workable = instance.components.workable = new Workable(instance);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(4);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    instance.components.lootdropper = createStructureLootDropper(instance);
    const container = instance.components.container as BuildingContainer | undefined;
    if (!world || !container) throw new Error('A bookstation needs its container and world');
    const entity = actionEntity(model, BOOKSTATION_ID);
    for (const tag of ['structure', 'giftmachine', 'prototyper']) entity.addTag(tag);
    (instance as BookstationInstance).bookstation = new Bookstation({ model, container, world, art });
}

function onturnon(context: AnimatedBuildingEventContext): void {
    const bookstation = bookstationOf(context.model);
    if (bookstation) bookstation.on = true;
    if (actionEntity(context.model, BOOKSTATION_ID).hasTag('burnt')) return;
    // onbuilt's place clip hands over to proximity_loop when it finishes.
    if ((prefabInstance(context.model)!.sprite as SpriteState).currentAnimation === 'place') return;
    context.animation.start('proximity_loop');
}

function onturnoff(context: AnimatedBuildingEventContext): void {
    const bookstation = bookstationOf(context.model);
    if (bookstation) bookstation.on = false;
    if (actionEntity(context.model, BOOKSTATION_ID).hasTag('burnt')) return;
    context.animation.start('idle');
}

function hitThenSettle(context: AnimatedBuildingEventContext): void {
    context.animation.playOnce('hit', () => settle(context));
}

function onworked(inst: PrefabInstance): void {
    if (inst.hasTag('burnt')) return;
    const on = (inst as BookstationInstance).bookstation?.on === true;
    inst.sprite.playOnce('hit');
    inst.sprite.pushAnimation(on ? 'proximity_loop' : 'idle', on);
}

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.components.container?.DropEverything(inst.position);
    inst.components.lootdropper!.DropLoot();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    inst.remove();
}

export const BOOKSTATION_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.bookstation,
    obstacleRadius: 0.4,
    // MakeLargeBurnable(inst, nil, nil, true) and MakeLargePropagator.
    burnable: { burnTime: 30, fxLevel: 4, propagator: 'large' },
    skinInit: bookstation_init_fn,
    onbuilt, oninit, onturnon, onturnoff,
    onopen: (context) => {
        if (actionEntity(context.model, BOOKSTATION_ID).hasTag('burnt')) return;
        hitThenSettle(context);
        PlaySound('dontstarve/wilson/chest_open', context.model.position);
    },
    onclose: (context) => {
        if (actionEntity(context.model, BOOKSTATION_ID).hasTag('burnt')) return;
        hitThenSettle(context);
        PlaySound('dontstarve/wilson/chest_close', context.model.position);
    },
    ondispose: ({ model }) => { bookstationOf(model)?.dispose(); delete (prefabInstance(model)! as BookstationInstance).bookstation; },
};

export class BookstationPlacement extends AnimatedBuildingPlacement<BookstationId> {
    constructor(
        world: WorldContext,
        consumeBufferedBuild: (buildId: BookstationId) => boolean,
        onInteractionChange?: (change: AnimatedBuildingInteractionChange<BookstationId>) => void,
    ) {
        super(world, { [BOOKSTATION_ID]: BOOKSTATION_DEFINITION }, consumeBufferedBuild, onInteractionChange);
    }
}
