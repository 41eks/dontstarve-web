import * as THREE from 'three';
import { createEffect, seasonstate, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { ColourCubeAssets } from './colourCubeAssets';
import { currentSeason, lightPhase, peekLightPhase, transitionSeconds } from './lightingPhase';

/** The player's state that colourcube.lua grades the screen by. */
export interface ColourCubeInputs {
  sanityPercent?: ReadonlySignal<number>;
  /** sanity:IsLunacyMode(): colourcube.lua drops the insanity grading and distortion. */
  lunacyMode?: ReadonlySignal<boolean>;
  /** playervision:HasGhostVision(); replaces the ambient colour cube. */
  ghostVision?: ReadonlySignal<boolean>;
}

const SANITY_GRADING_STEPS = 10;
// postprocess_distort.ksh's orbit repeats every 2π / TIME_SCALE seconds.
const DISTORTION_PERIOD = (Math.PI * 2) / 50;

/**
 * components/colourcube.lua: the season/phase cube (or playervision's ghost cube) blended from the previous one, the
 * insanity cube by sanity on the nearest 10%, and the sanity distortion. It is presentation state only: the lighting
 * pipeline draws it, re-blending the combined cube when `bakeVersion` changes.
 */
export class ColourCube {
  source: THREE.DataTexture;
  destination: THREE.DataTexture;
  insanitySource: THREE.DataTexture;
  insanityDestination: THREE.DataTexture;
  /** From source (0) to destination (1). */
  blend = 1;
  insanityIntensity = 0;
  distortionIntensity = 0;
  /** postprocess_distort.ksh's time, wrapped to its period. */
  distortionTime = 0;
  /** Changes whenever a combine_colour_cubes input (the cubes, blend or insanity intensity) changes. */
  bakeVersion = 1;
  private sanity = 1;
  private distortionSpeed = 0;
  private blendRemaining = 0;
  private blendTotal = 0;
  private readonly cleanups: (() => void)[] = [];

  constructor(assets: ColourCubeAssets, { sanityPercent, lunacyMode, ghostVision }: ColourCubeInputs = {}) {
    // The player's vision outlives a world, so the cube follows it through its own bridge.
    const ghost = ghostVision ? watchSignal(ghostVision, stop => this.cleanups.push(stop)) : undefined;
    const phase = peekLightPhase();
    this.destination = this.source = assets.cube(seasonstate.peek().season, phase, ghost?.peek() ?? false);
    this.insanityDestination = this.insanitySource = assets.insanityCube(phase);
    const applySanity = () => this.applySanity(sanityPercent?.peek() ?? 1, lunacyMode?.peek() ?? false);
    for (const stop of [sanityPercent?.subscribe(applySanity), lunacyMode?.subscribe(applySanity)]) {
      if (stop) {
        this.cleanups.push(stop);
      }
    }
    applySanity();
    // Only the previous season and vision are kept, to choose the transition's duration.
    let previousSeason = seasonstate.peek().season;
    let previousGhost = ghost?.peek() ?? false;
    this.cleanups.push(
      createEffect(() => {
        const season = currentSeason();
        const phase = lightPhase();
        const vision = ghost?.get() ?? false;
        const duration = transitionSeconds(phase, season !== previousSeason, vision !== previousGhost);
        previousSeason = season;
        previousGhost = vision;
        this.transition(assets.cube(season, phase, vision), assets.insanityCube(phase), duration);
      }),
    );
  }

  get sanityPercent(): number {
    return this.sanity;
  }

  /**
   * DST's quadratic grading on the nearest 10% sanity level. In lunacy mode colourcube.lua's
   * SetOnlyLunacyIntensityParams sets the insanity cube's lerp to 0 and the distortion factor to 1, so neither shows;
   * the lunacy cube and overlay are not ported.
   */
  private applySanity(percent: number, lunacy: boolean): void {
    if (!Number.isFinite(percent)) {
      throw new Error('Sanity percent must be finite');
    }
    this.sanity = THREE.MathUtils.clamp(percent, 0, 1);
    const gradingPercent = Math.round(this.sanity * SANITY_GRADING_STEPS) / SANITY_GRADING_STEPS;
    this.setInsanityIntensity(lunacy ? 0 : (1 - gradingPercent) ** 2);
    this.distortionIntensity = lunacy ? 0 : (1 - this.sanity) ** 2;
    // outQuad(1 - percent, 0, 0.2, 1), with DST's default distortion modifier 1.
    // Slow the orbit to half speed without changing its amplitude or grading.
    this.distortionSpeed = 0.2 * (1 - this.sanity ** 2) * 0.5;
  }

  private setInsanityIntensity(value: number): void {
    if (this.insanityIntensity !== value) {
      this.insanityIntensity = value;
      this.bakeVersion++;
    }
  }

  private setBlend(value: number): void {
    if (this.blend !== value) {
      this.blend = value;
      this.bakeVersion++;
    }
  }

  private transition(destination: THREE.DataTexture, insanityDestination: THREE.DataTexture, duration: number): void {
    if (destination === this.destination && insanityDestination === this.insanityDestination) {
      return;
    }
    this.insanitySource = this.insanityDestination;
    this.insanityDestination = insanityDestination;
    this.source = this.destination;
    this.destination = destination;
    this.blend = 0;
    this.bakeVersion++;
    this.blendRemaining = duration;
    this.blendTotal = duration;
  }

  update(dt: number): void {
    const elapsed = Math.max(0, dt);
    // Keep trigonometric inputs small on every GPU, including after a long session or a large simulation step.
    // Wrapping does not change the orbit.
    this.distortionTime =
      (this.distortionTime + ((elapsed * this.distortionSpeed) % DISTORTION_PERIOD)) % DISTORTION_PERIOD;
    if (this.blendRemaining > 0) {
      this.blendRemaining = Math.max(0, this.blendRemaining - elapsed);
      this.setBlend(1 - this.blendRemaining / this.blendTotal);
    }
  }

  dispose(): void {
    this.cleanups.splice(0).forEach(stop => stop());
  }
}
