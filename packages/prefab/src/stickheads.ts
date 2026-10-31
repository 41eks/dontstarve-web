import type { PrefabInstance } from './prefabInstance';
import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import type * as THREE from 'three';
import definitions from './definitions.json' with { type: 'json' };
import { createEffect, createMemo, WorldContentKey, type Memo } from '@dontstarve-web/signals';
import { TileTracker } from '../../componets/src/tileManager';
import { FliesController } from './flies';
import { actionEntity } from './actionEntity';
import { prefabInstance, createArchiveEntity } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import type {
    AnimatedBuildingDefinition,
    AnimatedBuildingEventContext,
    BuildingRenderEffect,
} from './animatedBuildingPlacement';

export const PIG_HEAD_ID = 'pighead' as const;
export type PigHeadId = typeof PIG_HEAD_ID;
export const MERM_HEAD_ID = 'mermhead' as const;
export type MermHeadId = typeof MERM_HEAD_ID;
type StickHeadId = PigHeadId | MermHeadId;

/** inst.awake plus the isfullmoon watcher; `awake` is never saved and is rebuilt from the world on load. */
class StickHead {
    private awake = false;
    private readonly cleanups: (() => void)[] = [];
    private readonly fliesController?: FliesController;
    private readonly fullMoon?: Memo<boolean>;
    readonly flies: ReturnType<typeof createArchiveEntity>;
    private readonly context: AnimatedBuildingEventContext;
    private readonly id: StickHeadId;

    constructor(id: StickHeadId, context: AnimatedBuildingEventContext) {
        this.id = id; this.context = context;
        const { model, world } = context;
        // create_common: SpawnChild("flies") beside the head, drawn from the placement's shared flies archive.
        if (!context.sprites) throw new Error('Stick heads need the placement sprite resources');
        this.flies = createArchiveEntity('flies', context.sprites.archive({ animationArchive: 'flies.zip', buildArchives: ['flies.zip'], bank: 'flies' }),
            { name: 'swarm_pre' }, 'flies', flies => { flies.persists = false; });
        const flies = this.flies.display.model;
        model.add(flies);
        // The decorative child must not enlarge the head's pickup target, whenever its sprite is rebuilt.
        this.cleanups.push(createEffect(() => {
            this.flies.instance.sprite.art.get();
            flies.traverse(object => { object.raycast = () => {}; });
        }));
        // OnEntitySleep/OnEntityWake: the swarm's frames exist only while the head's tile is active.
        this.cleanups.push(watchTileActivity(model, world?.tickingarea, active => this.flies.instance.setActive(active)));
        if (world?.scheduler) this.fliesController = new FliesController(this.flies.instance, model.position, world.scheduler, world.getWatchWorldContent);
        // The head never moves, so its private tile key gates the moon and phase inputs by tickingarea: outside it they hold their last value.
        const options = { tile: new TileTracker(() => model.position).tile };
        const moon = world?.getWatchWorldContent?.(WorldContentKey.Moon, stop => this.cleanups.push(stop), options);
        const cycle = world?.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.cleanups.push(stop), options);
        if (moon && cycle) {
            // worldstate.lua: isfullmoon = isnight and moonphase == "full". The first run is the constructor's OnFullMoon call.
            const fullMoon = createMemo(() => moon.get().phase === 'full' && cycle.get() === 'night');
            this.fullMoon = fullMoon;
            // The memo and effect read the local signals, so their stop callbacks release them.
            createEffect(() => this.onFullMoon(fullMoon.get()));
        }
    }

    private get burnt(): boolean { return actionEntity(this.context.model, this.id).hasTag('burnt'); }
    get isFullMoon(): boolean { return this.fullMoon?.peek() ?? false; }
    get idle(): string { return this.awake ? 'idle_awake' : 'idle_asleep'; }

    /** OnFullMoon: wake or sleep, then settle on the idle pose. */
    onFullMoon(isfullmoon: boolean): void {
        if (this.burnt) return;
        const { animation } = this.context;
        if (isfullmoon === this.awake) return;
        this.awake = isfullmoon;
        animation.playOnce(isfullmoon ? 'wake' : 'sleep', () => animation.playOnce(this.idle));
    }

    /** OnWorked: hit, then back to the current idle pose. */
    hit(): void {
        const { animation } = this.context;
        animation.playOnce('hit', () => animation.start(this.idle));
    }

    get renderEffects(): BuildingRenderEffect[] {
        return [{ object: this.flies.display.model, sortLayer: 2 }];
    }

    /** The flies' display advances their declared clip. */
    update(dt: number): void { this.flies.display.update(dt); }

    dispose(): void {
        this.cleanups.splice(0).forEach(stop => stop());
        this.fliesController?.dispose();
        this.flies.instance.remove(); this.flies.display.dispose();
    }
}

interface StickHeadInstance extends PrefabInstance { head: StickHead }
const headOf = (model: THREE.Object3D): StickHead => (prefabInstance(model)! as StickHeadInstance).head;

function onworked(inst: PrefabInstance): void {
    if (!inst.hasTag('burnt')) (inst as StickHeadInstance).head.hit();
}

function onhammered(inst: PrefabInstance): void {
    if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
    inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
    if ((inst as StickHeadInstance).head.isFullMoon) inst.components.lootdropper!.SpawnLootPrefab('nightmarefuel');
    inst.components.lootdropper!.DropLoot();
    inst.remove();
}

/** stickheads.lua create_common: both heads share work, burn, loot and full-moon behaviour; only art and recipe loot differ. */
const stickHead = (id: StickHeadId): AnimatedBuildingDefinition => ({
    ...definitions.animatedBuildings[id],
    // MakeSmallBurnable(inst, nil, nil, true): SMALL_BURNTIME, fire level 2, small propagator, burnt structure.
    burnable: { burnTime: 10, fxLevel: 2, propagator: 'small' },
    oninit: context => {
        const workable = context.instance.components.workable = new Workable(context.instance);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(3);
        workable.SetOnWorkCallback(onworked);
        workable.SetOnFinishCallback(onhammered);
        context.instance.components.lootdropper = createStructureLootDropper(context.instance);
        (context.instance as StickHeadInstance).head = new StickHead(id, context);
    },
    onupdate: ({ model }, dt) => headOf(model).update(dt),
    renderEffects: ({ model }) => headOf(model).renderEffects,
    ondispose: ({ model }) => headOf(model).dispose(),
});

export const PIG_HEAD_DEFINITION = stickHead(PIG_HEAD_ID);
export const MERM_HEAD_DEFINITION = stickHead(MERM_HEAD_ID);
