import type * as THREE from 'three';
import { clockstate, moonphasestate, seasonstate, type ReadonlySignal } from '@dontstarve-web/signals';
import { AmbientLighting } from './ambientLighting';
import { ColourCube, type ColourCubeInputs } from './colourCube';
import { ColourCubeAssets } from './colourCubeAssets';
import type { DstLightPhase, DstSeason } from './lightingPhase';
import { LightingPipeline } from './lightingPipeline';
import { DstLocalLighting, sampleLightLevel } from './localLighting';

export type DstLightingState = ColourCubeInputs;

/**
 * The world's lighting: ambientlighting.lua's colour, colourcube.lua's grading and the local lightmap, drawn by one
 * pipeline. It owns its colour cubes and render targets; the application gives it the renderer and the player's
 * state, steps it each frame and binds the forest weather's light.
 */
export class DstLightingRenderer {
  /** Loads the colour cubes from `colourCubeRoot` (images/colour_cubes). */
  static async create(
    renderer: THREE.WebGLRenderer,
    colourCubeRoot: string,
    initialState: DstLightingState = {},
  ): Promise<DstLightingRenderer> {
    return new DstLightingRenderer(renderer, await ColourCubeAssets.load(colourCubeRoot), initialState);
  }

  /** The renderer it draws with, which the application owns. */
  readonly renderer: THREE.WebGLRenderer;
  private readonly assets: ColourCubeAssets;
  private readonly localLighting = new DstLocalLighting();
  private readonly ambient: AmbientLighting;
  /** colourcube.lua's state, which the pipeline draws. */
  readonly colourCube: ColourCube;
  private readonly pipeline: LightingPipeline;
  private disposed = false;

  private constructor(renderer: THREE.WebGLRenderer, assets: ColourCubeAssets, initialState: DstLightingState) {
    this.renderer = renderer;
    this.assets = assets;
    this.colourCube = new ColourCube(assets, initialState);
    this.ambient = new AmbientLighting(lit => this.localLighting.setAmbientColour(lit));
    this.pipeline = new LightingPipeline(renderer, this.colourCube, this.localLighting, assets.size);
  }

  getSeason(): DstSeason {
    return seasonstate.peek().season;
  }

  getPhase(): DstLightPhase {
    const { phase } = clockstate.peek();
    return phase === 'night' && moonphasestate.peek() === 'full' ? 'full_moon' : phase;
  }

  getSanityPercent(): number {
    return this.colourCube.sanityPercent.peek();
  }

  /** ambientlighting.lua OnWeatherTick: see AmbientLighting.bindWeatherLight. */
  bindWeatherLight(light: ReadonlySignal<number>): () => void {
    return this.ambient.bindWeatherLight(light);
  }

  /** The light level at `position` from the current ambient and the listed display lights. */
  sampleLightLevel(position: THREE.Vector3, exclude?: THREE.Object3D): number {
    return sampleLightLevel(position, this.ambient.lit, exclude);
  }

  update(dt: number): void {
    this.colourCube.update(dt);
    this.ambient.update(dt);
  }

  prewarm(scene: THREE.Scene, camera: THREE.Camera, signal?: AbortSignal): Promise<void> {
    return this.pipeline.prewarm(scene, camera, signal);
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    this.pipeline.render(scene, camera, this.ambient.lit);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.colourCube.dispose();
    this.ambient.dispose();
    this.localLighting.dispose();
    this.pipeline.dispose();
    this.assets.dispose();
  }
}
