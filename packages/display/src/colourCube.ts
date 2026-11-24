import * as THREE from 'three';
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  readonlySignal,
  watchSignal,
  type Memo,
  type ReadonlySignal,
} from '@dontstarve-web/signals';
import type { ColourCubeAssets } from './colourCubeAssets';
import { transitionSeconds, watchLightingWorld } from './lightingPhase';

/** The player's state that colourcube.lua grades the screen by. */
export interface ColourCubeInputs {
  sanityPercent?: ReadonlySignal<number>;
  /** sanity:IsLunacyMode(): colourcube.lua drops the insanity grading and distortion. */
  lunacyMode?: ReadonlySignal<boolean>;
  /** playervision:HasGhostVision(); replaces the ambient colour cube. */
  ghostVision?: ReadonlySignal<boolean>;
}

/** The cubes a blend runs between: the ambient (or ghost) cube and the insanity cube, each from source to destination. */
export interface ColourCubeLayers {
  readonly source: THREE.DataTexture;
  readonly destination: THREE.DataTexture;
  readonly insanitySource: THREE.DataTexture;
  readonly insanityDestination: THREE.DataTexture;
}

const SANITY_GRADING_STEPS = 10;
// postprocess_distort.ksh's orbit repeats every 2π / TIME_SCALE seconds.
const DISTORTION_PERIOD = (Math.PI * 2) / 50;

/**
 * components/colourcube.lua: the season/phase cube (or playervision's ghost cube) blended from the previous one, the
 * insanity cube by sanity on the nearest 10%, and the sanity distortion. It is presentation state only; the lighting
 * pipeline follows `layers`, `blend` and `insanityIntensity`, which notify only when their values change.
 */
export class ColourCube {
  private readonly layersState;
  readonly layers: ReadonlySignal<ColourCubeLayers>;
  private readonly blendState = createSignal(1);
  /** From source (0) to destination (1). */
  readonly blend = readonlySignal(this.blendState);
  /** Sanity clamped to [0, 1]. */
  readonly sanityPercent: Memo<number>;
  /** DST's quadratic insanity grading on the nearest 10% sanity level. */
  readonly insanityIntensity: Memo<number>;
  readonly distortionIntensity: Memo<number>;
  /** outQuad(1 - percent, 0, 0.2, 1) with DST's default modifier 1, at half speed. */
  private readonly distortionSpeed: Memo<number>;
  /** postprocess_distort.ksh's time, wrapped to its period; sampled each frame like any animation time. */
  distortionTime = 0;
  private blendRemaining = 0;
  private blendTotal = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor(assets: ColourCubeAssets, { sanityPercent, lunacyMode, ghostVision }: ColourCubeInputs = {}) {
    const register = (stop: () => void) => this.cleanups.push(stop);
    const world = watchLightingWorld(register);
    // The player's state outlives a world, so the cube follows it through its own bridges.
    const ghost = ghostVision ? watchSignal(ghostVision, register) : undefined;
    const sanity = sanityPercent ? watchSignal(sanityPercent, register) : undefined;
    const lunacy = lunacyMode ? watchSignal(lunacyMode, register) : undefined;
    const phase = world.phase.peek();
    const initial = assets.cube(world.season.peek(), phase, ghost?.peek() ?? false);
    const insanity = assets.insanityCube(phase);
    this.layersState = createSignal<ColourCubeLayers>({
      source: initial,
      destination: initial,
      insanitySource: insanity,
      insanityDestination: insanity,
    });
    this.layers = readonlySignal(this.layersState);

    this.sanityPercent = createMemo(() => {
      const percent = sanity?.get() ?? 1;
      if (!Number.isFinite(percent)) {
        throw new Error('Sanity percent must be finite');
      }
      return THREE.MathUtils.clamp(percent, 0, 1);
    });
    // In lunacy mode colourcube.lua's SetOnlyLunacyIntensityParams sets the insanity cube's lerp to 0 and the
    // distortion factor to 1, so neither shows; the lunacy cube and overlay are not ported.
    this.insanityIntensity = createMemo(() => {
      const grading = Math.round(this.sanityPercent.get() * SANITY_GRADING_STEPS) / SANITY_GRADING_STEPS;
      return lunacy?.get() ? 0 : (1 - grading) ** 2;
    });
    this.distortionIntensity = createMemo(() => (lunacy?.get() ? 0 : (1 - this.sanityPercent.get()) ** 2));
    this.distortionSpeed = createMemo(() => 0.2 * (1 - this.sanityPercent.get() ** 2) * 0.5);
    register(() => {
      for (const memo of [this.distortionSpeed, this.distortionIntensity, this.insanityIntensity, this.sanityPercent]) {
        memo.dispose();
      }
    });

    // Only the previous season and vision are kept, to choose the transition's duration.
    let previousSeason = world.season.peek();
    let previousGhost = ghost?.peek() ?? false;
    register(
      createEffect(() => {
        const season = world.season.get();
        const phase = world.phase.get();
        const vision = ghost?.get() ?? false;
        const duration = transitionSeconds(phase, season !== previousSeason, vision !== previousGhost);
        previousSeason = season;
        previousGhost = vision;
        this.transition(assets.cube(season, phase, vision), assets.insanityCube(phase), duration);
      }),
    );
  }

  private transition(destination: THREE.DataTexture, insanityDestination: THREE.DataTexture, duration: number): void {
    const layers = this.layersState.peek();
    if (destination === layers.destination && insanityDestination === layers.insanityDestination) {
      return;
    }
    batch(() => {
      this.layersState.set({
        source: layers.destination,
        destination,
        insanitySource: layers.insanityDestination,
        insanityDestination,
      });
      this.blendState.set(0);
    });
    this.blendRemaining = duration;
    this.blendTotal = duration;
  }

  update(dt: number): void {
    const elapsed = Math.max(0, dt);
    // Keep trigonometric inputs small on every GPU, including after a long session or a large simulation step.
    // Wrapping does not change the orbit.
    this.distortionTime =
      (this.distortionTime + ((elapsed * this.distortionSpeed.peek()) % DISTORTION_PERIOD)) % DISTORTION_PERIOD;
    if (this.blendRemaining > 0) {
      this.blendRemaining = Math.max(0, this.blendRemaining - elapsed);
      // A paused frame writes the same value, which notifies nothing.
      this.blendState.set(1 - this.blendRemaining / this.blendTotal);
    }
  }

  dispose(): void {
    this.cleanups.splice(0).forEach(stop => stop());
  }
}
