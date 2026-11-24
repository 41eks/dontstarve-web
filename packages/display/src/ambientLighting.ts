import * as THREE from 'three';
import { createEffect, seasonstate, type ReadonlySignal } from '@dontstarve-web/signals';
import {
  currentSeason,
  lightPhase,
  peekLightPhase,
  transitionSeconds,
  type DstLightPhase,
  type DstSeason,
} from './lightingPhase';

const DAY_AMBIENT = new THREE.Vector3(255 / 255, 230 / 255, 158 / 255);
const SPRING_DAY_AMBIENT = new THREE.Vector3(255 / 255, 244 / 255, 213 / 255);
const DUSK_AMBIENT = new THREE.Vector3(150 / 255, 150 / 255, 150 / 255);
const SPRING_DUSK_AMBIENT = new THREE.Vector3(171 / 255, 146 / 255, 147 / 255);
const NIGHT_AMBIENT = new THREE.Vector3(0, 0, 0);
const FULL_MOON_AMBIENT = new THREE.Vector3(84 / 255, 122 / 255, 156 / 255);

function ambientFor(season: DstSeason, phase: DstLightPhase): THREE.Vector3 {
  if (phase === 'full_moon') {
    return FULL_MOON_AMBIENT;
  }
  if (phase === 'night') {
    return NIGHT_AMBIENT;
  }
  if (phase === 'dusk') {
    return season === 'spring' ? SPRING_DUSK_AMBIENT : DUSK_AMBIENT;
  }
  return season === 'spring' ? SPRING_DAY_AMBIENT : DAY_AMBIENT;
}

/**
 * components/ambientlighting.lua: the phase/season ambient colour, blended over the phase's (or a new season's) time,
 * scaled by weathertick's light. `apply` receives the lit colour whenever it changes; the world materials and the
 * lightmap draw with it.
 */
export class AmbientLighting {
  /** The current colour scaled by the weather light. */
  readonly lit = new THREE.Vector3();
  private readonly start = new THREE.Vector3();
  private readonly current = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private weatherLight = 1;
  private blendRemaining = 0;
  private blendTotal = 0;
  private readonly apply: (lit: THREE.Vector3) => void;
  private readonly stop: () => void;

  constructor(apply: (lit: THREE.Vector3) => void) {
    this.apply = apply;
    this.current.copy(ambientFor(seasonstate.peek().season, peekLightPhase()));
    this.start.copy(this.current);
    this.target.copy(this.current);
    this.applyLit();
    let previousSeason = seasonstate.peek().season;
    this.stop = createEffect(() => {
      const season = currentSeason();
      const phase = lightPhase();
      const duration = transitionSeconds(phase, season !== previousSeason, false);
      previousSeason = season;
      this.transition(ambientFor(season, phase), duration);
    });
  }

  /**
   * OnWeatherTick: the colour is scaled by the weather's `light` (weather.lua CalculateLight) while `light` is bound.
   * Unbinding returns to full light, as caveweather.lua's constant 1.
   */
  bindWeatherLight(light: ReadonlySignal<number>): () => void {
    const stop = createEffect(() => {
      this.weatherLight = THREE.MathUtils.clamp(light.get(), 0, 1);
      this.applyLit();
    });
    return () => {
      stop();
      this.weatherLight = 1;
      this.applyLit();
    };
  }

  private transition(target: THREE.Vector3, duration: number): void {
    if (this.target.equals(target)) {
      return;
    }
    this.start.copy(this.current);
    this.target.copy(target);
    this.blendRemaining = duration;
    this.blendTotal = duration;
  }

  update(dt: number): void {
    if (this.blendRemaining > 0) {
      this.blendRemaining = Math.max(0, this.blendRemaining - Math.max(0, dt));
      this.current.lerpVectors(this.start, this.target, 1 - this.blendRemaining / this.blendTotal);
      this.applyLit();
    }
  }

  private applyLit(): void {
    this.lit.copy(this.current).multiplyScalar(this.weatherLight);
    this.apply(this.lit);
  }

  dispose(): void {
    this.stop();
  }
}
