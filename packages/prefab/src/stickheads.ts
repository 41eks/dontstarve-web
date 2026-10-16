import type * as THREE from 'three';
import definitions from './definitions.json' with { type: 'json' };
import { createArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { createEffect, createMemo, WorldContentKey, type Memo } from '@dontstarve-web/signals';
import { FliesController, FLIES_SOUND } from './flies';
import { actionEntity } from './actionEntity';
import { PreloadSounds } from './sound';
import type {
    AnimatedBuildingDefinition,
    AnimatedBuildingEventContext,
    AnimatedBuildingHammerContext,
    AnimatedBuildingPreparedResources,
    BuildingRenderEffect,
} from './animatedBuildingPlacement';

export const PIG_HEAD_ID = 'pighead' as const;
export type PigHeadId = typeof PIG_HEAD_ID;
export const MERM_HEAD_ID = 'mermhead' as const;
export type MermHeadId = typeof MERM_HEAD_ID;
type StickHeadId = PigHeadId | MermHeadId;

interface StickHeadResources extends AnimatedBuildingPreparedResources { readonly flies: ArchiveSprite; }

/** stickheads.lua create_common: SpawnChild("flies") beside the head; the sprite is released with the head's art. */
async function prepare(): Promise<StickHeadResources> {
    const assets = new ArchiveSpriteAssets();
    try {
        const [flies] = await Promise.all([
            createArchiveSprite(assets, { animationArchive: 'flies.zip', buildArchives: ['flies.zip'],
                bank: 'flies', animation: 'swarm_pre', loop: false }, { name: 'flies' }),
            PreloadSounds(FLIES_SOUND),
        ]);
        return { materials: [], flies, dispose: () => { flies.dispose(); assets.dispose(); } };
    } catch (error) { assets.dispose(); throw error; }
}

/** inst.awake plus the isfullmoon watcher; `awake` is never saved and is rebuilt from the world on load. */
class StickHead {
    private awake = false;
    private readonly cleanups: (() => void)[] = [];
    private readonly fliesController?: FliesController;
    private readonly fullMoon?: Memo<boolean>;
    readonly flies: ArchiveSprite;
    private readonly context: AnimatedBuildingEventContext;
    private readonly id: StickHeadId;

    constructor(id: StickHeadId, context: AnimatedBuildingEventContext) {
        this.id = id; this.context = context;
        const { model, world } = context;
        this.flies = (context.prepared as StickHeadResources).flies;
        model.add(this.flies.model);
        if (world?.scheduler) this.fliesController = new FliesController(this.flies, model.position, world.scheduler, world.getWatchWorldContent);
        const moon = world?.getWatchWorldContent?.(WorldContentKey.Moon, stop => this.cleanups.push(stop));
        const cycle = world?.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
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
        return [{ object: this.flies.model, footPosition: this.context.model.position, sortLayer: 2 }];
    }

    update(dt: number): void { this.fliesController?.update(dt); }

    dispose(): void {
        this.cleanups.splice(0).forEach(stop => stop());
        this.fliesController?.dispose();
        this.flies.model.removeFromParent();
    }
}

const headOf = (model: THREE.Object3D): StickHead => model.userData.stickhead;

/** OnFinish: a full moon adds nightmarefuel; recipe loot itself comes from the deconstruct recipe. */
function bonusLoot({ model }: AnimatedBuildingEventContext): { itemId: string; count: number }[] {
    return headOf(model).isFullMoon ? [{ itemId: 'nightmarefuel', count: 1 }] : [];
}

/** stickheads.lua create_common: both heads share work, burn, loot and full-moon behaviour; only art and recipe loot differ. */
const stickHead = (id: StickHeadId): AnimatedBuildingDefinition => ({
    ...definitions.animatedBuildings[id],
    hammerWorkLeft: 3, hammerMaterial: 'wood',
    hammerEffect: { archive: 'structure_collapse_fx.zip', animation: 'collapse_small', name: 'collapse_small' },
    // MakeSmallBurnable(inst, nil, nil, true): SMALL_BURNTIME, fire level 2, small propagator, burnt structure.
    burnable: { burnTime: 10, fxLevel: 2, propagator: 'small' },
    prepare,
    oninit: context => { context.model.userData.stickhead = new StickHead(id, context); },
    onhit: (context: AnimatedBuildingHammerContext) => headOf(context.model).hit(),
    hammerBonusLoot: bonusLoot,
    onupdate: ({ model }, dt) => headOf(model).update(dt),
    renderEffects: ({ model }) => headOf(model).renderEffects,
    ondispose: ({ model }) => headOf(model).dispose(),
});

export const PIG_HEAD_DEFINITION = stickHead(PIG_HEAD_ID);
export const MERM_HEAD_DEFINITION = stickHead(MERM_HEAD_ID);
