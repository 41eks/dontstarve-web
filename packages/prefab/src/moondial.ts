import type * as THREE from 'three';
import { createEffect, WorldContentKey, type WorldContentSignal, type WorldMoonState, type WorldMoonPhase } from '@dontstarve-web/signals';
import { loadSymbolOverride, type LoadedSymbolOverride, type SpriteController } from '@dontstarve-web/animation/sprite';
import { smallHash } from '@dontstarve-web/animation/animationAssets';
import { moondial_init_fn } from '@dontstarve-web/animation/prefabskin';
import definitions from './definitions.json' with { type: 'json' };
import {
    buildingRecipeLoot,
    type AnimatedBuildingBuiltContext,
    type AnimatedBuildingDefinition,
    type AnimatedBuildingEventContext,
    type AnimatedBuildingHammerContext,
    type AnimatedBuildingPreparedResources,
} from './animatedBuildingPlacement';
import { actionEntity } from './actionEntity';
import { setPrefabLightOverride, setPrefabLocalLight } from './localLight';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { TILE_SIZE } from './tile';

export const MOONDIAL_ID = 'moondial' as const;
export type MoondialId = typeof MOONDIAL_ID;
export const MOONDIAL_SKIN_ARCHIVES: Readonly<Record<string, string>> = definitions.animatedBuildings.moondial.skinArchives;

const WANING_BUILD = 'moondial_waning_build.zip';
const REFLECTION_SYMBOLS = ['reflection_quarter', 'reflection_half', 'reflection_threequarter'] as const;
const SOUND = {
    fill: 'dontstarve/common/together/moondial/fill',
    full: 'dontstarve/common/together/moondial/full_LP',
    water: 'dontstarve/common/together/moondial/water_movement',
    craft: 'dontstarve/common/together/moondial/craft',
} as const satisfies Record<string, SoundEventPath>;

/** moondial.lua lightstates; radius is in DST units. */
const LIGHT_STATES: Readonly<Record<WorldMoonPhase, { override: number; radius: number }>> = {
    new: { override: 0, radius: 0 },
    quarter: { override: 0, radius: 0 },
    half: { override: .1, radius: .7 },
    threequarter: { override: .1, radius: 1.5 },
    full: { override: .5, radius: 5 },
};

interface MoondialResources extends AnimatedBuildingPreparedResources {
    readonly waning: Readonly<Record<string, LoadedSymbolOverride>>;
}

/** moondial.lua's phase look plus SGmoondial.lua's idle / next / hit / placed states. */
class Moondial {
    private readonly context: AnimatedBuildingEventContext;
    private resources: MoondialResources;
    private readonly cleanups: (() => void)[] = [];
    private readonly moon?: WorldContentSignal<WorldMoonState>;
    private readonly pending = new Set<() => void>();
    private readonly sounds = new Set<SoundHandle>();
    private loop?: SoundHandle;
    private phase: WorldMoonPhase = 'new';
    private waxing = true;
    private disposed = false;

    constructor(context: AnimatedBuildingEventContext) {
        this.context = context;
        this.resources = context.prepared as MoondialResources;
        const model = context.model;
        actionEntity(model, MOONDIAL_ID).addTag('structure');
        this.moon = context.world?.getWatchWorldContent?.(WorldContentKey.Moon, stop => this.cleanups.push(stop));
        if (!this.moon) { this.onMoonPhaseChanged(false); this.idle(); return; }
        // WatchWorldState("moonphase", onmoonphasechagned): the first run is the constructor's own call (phase == nil).
        let first = true;
        createEffect(() => {
            const { phase, waxing } = this.moon!.get();
            const changed = phase !== this.phase;
            this.phase = phase; this.waxing = waxing;
            if (first) { first = false; this.onMoonPhaseChanged(false); this.idle(); } else if (changed) this.onMoonPhaseChanged(true);
        });
    }

    private get sprite(): SpriteController { return this.context.model.userData.animationController; }
    private get position(): THREE.Vector3 { return this.context.model.position; }

    /** moondial.lua onmoonphasechagned. */
    private onMoonPhaseChanged(transition: boolean): void {
        this.applyLook();
        if (transition) this.next();
    }

    /** Reflection symbols, light override and light for the current phase. Reskinning rebuilds the sprite, so it reapplies. */
    private applyLook(): void {
        const phase = this.phase, sprite = this.sprite;
        const waxingLook = (this.waxing && phase !== 'new') || phase === 'full';
        for (const symbol of REFLECTION_SYMBOLS) sprite.overrideSymbol(symbol, waxingLook ? undefined : this.resources.waning[symbol]);
        const light = LIGHT_STATES[phase], model = this.context.model;
        setPrefabLightOverride(model, light.override);
        setPrefabLocalLight(model, light.radius > 0
            ? { radius: light.radius * (TILE_SIZE / 4), intensity: .6, falloff: .7, colour: [15 / 255, 160 / 255, 180 / 255] } : null);
    }

    refreshArt(resources: MoondialResources): void {
        this.resources = resources;
        this.applyLook();
    }

    private phaseAnimation(prefix: string): string { return `${prefix}_${this.phase}`; }

    /** CalcTransitionAnimName. */
    private transitionAnimation(): string {
        if (this.phase === 'full') return 'wax_to_full';
        if (this.phase === 'new') return 'wane_to_new';
        return `${this.waxing ? 'wax' : 'wane'}_to_${this.phase}`;
    }

    private after(frames: number, run: () => void): void {
        const scheduler = this.context.world?.scheduler;
        if (!scheduler) return;
        const cancel = scheduler.schedule(frames * FRAMES, () => { this.pending.delete(cancel); if (!this.disposed) run(); });
        this.pending.add(cancel);
    }

    private playSound(path: SoundEventPath): void {
        for (const sound of this.sounds) if (!sound.isPlaying()) this.sounds.delete(sound);
        this.sounds.add(PlaySound(path, this.position));
    }

    /** Leaving any state cancels its timeline; idle's onexit kills the looping sound. */
    private exit(): void {
        for (const cancel of this.pending) cancel();
        this.pending.clear();
        this.loop?.stop(); this.loop = undefined;
    }

    private idle(): void {
        this.exit();
        this.sprite.start(this.phaseAnimation('idle'));
        if (this.phase === 'full') this.loop = PlaySound(SOUND.full, this.position);
    }

    private next(): void {
        this.exit();
        this.sprite.playOnce(this.transitionAnimation(), () => this.idle());
        this.after(4, () => this.playSound(SOUND.fill));
    }

    hit(): void {
        this.exit();
        this.sprite.playOnce(this.phaseAnimation('hit'), () => this.idle());
        this.after(9, () => this.playSound(SOUND.water));
    }

    placed(onComplete: () => void): void {
        this.exit();
        this.sprite.playOnce(this.phaseAnimation('place'), () => { this.idle(); onComplete(); });
        this.after(5, () => this.playSound(SOUND.craft));
        this.after(7, () => { if (this.phase !== 'new') this.playSound(SOUND.water); });
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.exit();
        for (const sound of this.sounds) sound.stop();
        this.sounds.clear();
        for (const cleanup of this.cleanups) cleanup();
        setPrefabLocalLight(this.context.model, null);
        setPrefabLightOverride(this.context.model, null);
    }
}

const moondialOf = (model: THREE.Object3D): Moondial => model.userData.moondial;

async function prepare(): Promise<MoondialResources> {
    const [loaded] = await Promise.all([
        loadSymbolOverride(`${import.meta.env.BASE_URL}dst/data/anim`, WANING_BUILD, REFLECTION_SYMBOLS[0]),
        PreloadSounds(...Object.values(SOUND), 'dontstarve/wilson/rock_break'),
    ]);
    // One waning atlas serves the three reflection symbols; the materials belong to the instance's art.
    return {
        materials: loaded.materials,
        waning: Object.fromEntries(REFLECTION_SYMBOLS.map(symbol => [symbol, { ...loaded, symbolHash: smallHash(symbol) }])),
    };
}

/** onhammered: DropLoot, rock_break_fx (its Stone_break sound), inst:Remove(). */
function onhammered({ position, dropLoot, remove }: AnimatedBuildingHammerContext): void {
    dropLoot(buildingRecipeLoot(MOONDIAL_ID));
    PlaySound('dontstarve/wilson/rock_break', position);
    remove();
}

export const MOONDIAL_DEFINITION: AnimatedBuildingDefinition = {
    ...definitions.animatedBuildings.moondial,
    hammerWorkLeft: 4,
    skinInit: moondial_init_fn,
    prepare,
    onhammered,
    oninit: context => { context.model.userData.moondial = new Moondial(context); },
    onbuilt: (context: AnimatedBuildingBuiltContext) => moondialOf(context.model).placed(context.onComplete),
    onhit: ({ model }) => moondialOf(model).hit(),
    onreskin: ({ model, prepared }) => moondialOf(model).refreshArt(prepared as MoondialResources),
    ondispose: ({ model }) => moondialOf(model).dispose(),
};
