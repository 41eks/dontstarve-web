import * as THREE from 'three';
import { createEffect, watchSignal, type ClockState, type ReadonlySignal } from '@dontstarve-web/signals';
import { OceanRenderPipeline, type OceanColourMap } from './oceanRenderPipeline';

// components/oceancolor.lua / tuning.lua OCEAN_SHADER: display-space clear colour.
const FLOOR = new THREE.Vector3(0, 19 / 255, 20 / 255);

/** OceanColor's phase interpolation, with rendering resources owned by its pipeline. */
export class OceanSurface {
  private clock?: ReadonlySignal<ClockState>;
  private stopWatching?: () => void;
  private phase: ClockState['phase'] = 'day';
  private progress = 1;
  private delay = 0;
  private blend = 0;
  private startBlend = 0;
  private endBlend = 0;
  private readonly startFloor = FLOOR.clone();
  private readonly endFloor = FLOOR.clone();
  private readonly floor = FLOOR.clone();
  private readonly pipeline: OceanRenderPipeline;

  constructor(material: THREE.MeshLambertMaterial, map: OceanColourMap) {
    this.pipeline = new OceanRenderPipeline(material.map!, map);
  }

  attach(mesh: THREE.Mesh): void { this.pipeline.attach(mesh); }
  rebuildColours(): void { this.pipeline.rebuildColours(); }

  bindClock(source: ReadonlySignal<ClockState>): void {
    this.stopWatching?.();
    this.clock = watchSignal(source, cleanup => { this.stopWatching = cleanup; });
    this.changePhase(this.clock.peek().phase, true);
    createEffect(() => this.changePhase(this.clock!.get().phase));
  }

  private changePhase(phase: ClockState['phase'], immediate = false): void {
    if (!immediate && phase === this.phase) return;
    this.phase = phase;
    this.startFloor.copy(this.floor);
    if (phase === 'day') this.endFloor.copy(FLOOR);
    else this.endFloor.set(0, 0, 0);
    this.startBlend = this.blend;
    this.endBlend = phase === 'day' ? 0 : 1;
    this.delay = phase === 'night' ? 6 : 0;
    this.progress = immediate ? 1 : 0;
    if (immediate) this.applyBlend();
  }

  private applyBlend(): void {
    this.blend = THREE.MathUtils.lerp(this.startBlend, this.endBlend, this.progress);
    this.floor.copy(this.startFloor).lerp(this.endFloor, this.progress);
    this.pipeline.setPhase(this.blend, this.floor);
  }

  update(dt: number): void {
    this.pipeline.update(dt);
    if (this.progress >= 1) return;
    const waiting = Math.min(this.delay, dt);
    this.delay -= waiting;
    this.progress = Math.min(1, this.progress + (dt - waiting) * (this.phase === 'day' ? 1 : 0.1));
    this.applyBlend();
  }

  dispose(): void {
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.clock = undefined;
    this.pipeline.dispose();
  }
}
