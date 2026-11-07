import { Workable } from '../../componets/src/workable';
import { createStructureLootDropper } from './structureLoot';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import { createEffect, createSignal, WorldContentKey, type WorldContentSignal, type WorldMoonState, type WorldMoonPhase } from '@dontstarve-web/signals';
import { AnimState } from '@dontstarve-web/animation/animState';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingPersist, type BuildingDeclaration } from './building';
import { PrefabInstance } from './prefabInstance';
import type { ReadonlyVector3 } from './transform';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { TILE_SIZE } from './tile';
import type { PrefabWorldContext } from './worldContext';

export const MOONDIAL_ID = 'moondial' as const;
export type MoondialId = typeof MOONDIAL_ID;
const declaration: BuildingDeclaration = definitions.animatedBuildings.moondial;
export const MOONDIAL_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives!;

/** moondial.lua MakePlacer("moondial_placer", "moondial", "moondial_build", "idle_new"). */
export const MOONDIAL_PLACER = buildingPlacer(declaration);

const WANING_BUILD = 'moondial_waning_build';
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

/** moondial.lua's phase look plus SGmoondial.lua's idle / next / hit / placed states. */
class Moondial {
    private readonly inst: PrefabInstance;
    /** The phase look inputs; the effect in the constructor dresses the current and every rebuilt sprite from them. */
    private readonly look = createSignal<{ phase: WorldMoonPhase; waxing: boolean }>({ phase: 'new', waxing: true });
    private readonly cleanups: (() => void)[] = [];
    private readonly moon?: WorldContentSignal<WorldMoonState>;
    private readonly pending = new Set<() => void>();
    private readonly sounds = new Set<SoundHandle>();
    private loop?: SoundHandle;
    private phase: WorldMoonPhase = 'new';
    private waxing = true;
    private disposed = false;

    constructor(inst: PrefabInstance, animState: AnimState) {
        this.inst = inst;
        // Reflection symbols, light override and light for the current phase; the display dresses every drawn sprite in the AnimState.
        this.cleanups.push(createEffect(() => {
            const { phase, waxing } = this.look.get();
            const waxingLook = (waxing && phase !== 'new') || phase === 'full';
            for (const symbol of REFLECTION_SYMBOLS) {
                if (waxingLook) animState.ClearOverrideSymbol(symbol);
                else animState.OverrideSymbol(symbol, WANING_BUILD, symbol);
            }
            const light = LIGHT_STATES[phase];
            inst.sprite.setLightOverride(light.override);
            inst.light.set(light.radius > 0
                ? { radius: light.radius * (TILE_SIZE / 4), intensity: .6, falloff: .7, colour: [15 / 255, 160 / 255, 180 / 255] } : null);
        }));
        this.moon = inst.worldServices?.getWatchWorldContent?.(WorldContentKey.Moon, stop => this.cleanups.push(stop));
        if (!this.moon) { this.idle(); return; }
        // WatchWorldState("moonphase", onmoonphasechagned): the first run is the constructor's own call (phase == nil).
        let first = true;
        createEffect(() => {
            const { phase, waxing } = this.moon!.get();
            const changed = phase !== this.phase;
            this.phase = phase; this.waxing = waxing;
            this.look.set({ phase, waxing });
            if (first) { first = false; this.idle(); } else if (changed) this.next();
        });
    }

    private get sprite(): SpriteState { return this.inst.sprite; }
    private get position(): ReadonlyVector3 { return this.inst.position; }

    private phaseAnimation(prefix: string): string { return `${prefix}_${this.phase}`; }

    /** CalcTransitionAnimName. */
    private transitionAnimation(): string {
        if (this.phase === 'full') return 'wax_to_full';
        if (this.phase === 'new') return 'wane_to_new';
        return `${this.waxing ? 'wax' : 'wane'}_to_${this.phase}`;
    }

    private after(frames: number, run: () => void): void {
        const scheduler = this.inst.worldServices?.scheduler;
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

    placed(): void {
        this.exit();
        this.sprite.playOnce(this.phaseAnimation('place'), () => this.idle());
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
        this.inst.light.set(null);
        this.inst.sprite.setLightOverride(null);
    }
}

/** onhammered: DropLoot, rock_break_fx (its Stone_break sound), inst:Remove(). */
function onworked(inst: PrefabInstance): void { (inst as MoondialInstance).moondial.hit(); }

function onhammered(inst: PrefabInstance): void {
    inst.components.lootdropper!.DropLoot();
    PlaySound('dontstarve/wilson/rock_break', inst.position);
    inst.remove();
}

/** moondial.lua fn(), as far as it is ported: the phase look, SGmoondial and the hammer workable. */
export class MoondialInstance extends PrefabInstance {
    readonly moondial: Moondial;

    constructor(world: PrefabWorldContext, sprites: SpriteResources) {
        super(MOONDIAL_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
        this.worldServices = world;
        MakeBuildingPersist(this);
        this.addTag('structure');
        const animState = new AnimState();
        this.sprite.setAnimState(animState.json, sprites.archives);
        const workable = this.components.workable = new Workable(this);
        workable.SetWorkAction('HAMMER');
        workable.SetWorkLeft(4);
        workable.SetOnWorkCallback(onworked);
        workable.SetOnFinishCallback(onhammered);
        this.components.lootdropper = createStructureLootDropper(this);
        const moondial = this.moondial = new Moondial(this, animState);
        this.ListenForEvent('onbuilt', () => moondial.placed());
        this.onRemove(() => moondial.dispose());
    }
}

export function moondialPrefabs(world: PrefabWorldContext) {
    return { [MOONDIAL_ID]: buildingPrefab(declaration, 'moondial', .45, (_position, sprites) => new MoondialInstance(world, sprites), world) };
}
