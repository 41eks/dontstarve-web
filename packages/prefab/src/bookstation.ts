import * as THREE from 'three';
import { createEffect, createSignal, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { SpriteController } from '@dontstarve-web/animation/sprite';
import { bookstation_init_fn } from '@dontstarve-web/animation/prefabskin';
import { ComponentTimer } from '../../componets/src/timer';
import { actionEntity } from './actionEntity';
import {
    AnimatedBuildingPlacement,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
    type AnimatedBuildingHammerContext,
    type AnimatedBuildingInteractionChange,
} from './animatedBuildingPlacement';
import { BOOK_USE_STEP, BOOKSTATION_RESTORE_AMOUNT, isBook } from './books';
import definitions from './definitions.json' with { type: 'json' };
import { PlaySound, PreloadSounds } from './sound';
import { TILE_SIZE } from './tile';
import type { BuildingContainer } from './containers';
import type { WorldContext } from './worldContext';
import { modelHasTag } from './prefabInstance';

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
    readonly world: WorldContext;
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
        const burnt = host.model.userData.burntSignal as ReadonlySignal<boolean> | undefined;
        if (burnt) {
            const watched = watchSignal(burnt, cleanup => { this.stopWatching = cleanup; });
            createEffect(() => { if (watched.get()) this.stopTimer(); });
        }
        // UpdateBookAesthetics: Show/Hide the book layers by fullness, also on every rebuilt sprite and reskin.
        this.stopAesthetics = createEffect(() => {
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

    private get animation(): SpriteController { return this.host.model.userData.animationController as SpriteController; }

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
        const nearPlayer = player.position.distanceToSquared(model.userData.getGroundPosition())
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

function bookstationOf(model: THREE.Group): Bookstation | undefined {
    return model.userData.bookstation as Bookstation | undefined;
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

function oninit({ model, world, art }: AnimatedBuildingEventContext): void {
    const container = model.userData.components?.container as BuildingContainer | undefined;
    if (!world || !container) throw new Error('A bookstation needs its container and world');
    const entity = actionEntity(model, BOOKSTATION_ID);
    for (const tag of ['structure', 'giftmachine', 'prototyper']) entity.addTag(tag);
    model.userData.bookstation = new Bookstation({ model, container, world, art });
}

function onturnon(context: AnimatedBuildingEventContext): void {
    const bookstation = bookstationOf(context.model);
    if (bookstation) bookstation.on = true;
    if (actionEntity(context.model, BOOKSTATION_ID).hasTag('burnt')) return;
    // onbuilt's place clip hands over to proximity_loop when it finishes.
    if ((context.model.userData.animationController as SpriteController).currentAnimation === 'place') return;
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

function onhit(context: AnimatedBuildingHammerContext): void {
    if (actionEntity(context.model, BOOKSTATION_ID).hasTag('burnt')) return;
    hitThenSettle(context);
}

export const BOOKSTATION_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.bookstation,
    obstacleRadius: 0.4,
    hammerWorkLeft: 4, hammerMaterial: 'wood',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse' },
    // MakeLargeBurnable(inst, nil, nil, true) and MakeLargePropagator.
    burnable: { burnTime: 30, fxLevel: 4, propagator: 'large' },
    skinInit: bookstation_init_fn,
    prepare: () => PreloadSounds('wickerbottom_rework/bookstation/place', 'dontstarve/wilson/chest_open', 'dontstarve/wilson/chest_close',
        'dontstarve/common/destroy_smoke', 'dontstarve/common/destroy_wood'),
    onbuilt, oninit, onturnon, onturnoff, onhit,
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
    ondispose: ({ model }) => { bookstationOf(model)?.dispose(); delete model.userData.bookstation; },
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
