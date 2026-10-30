import { spawnLightEntity } from './localLight';
import type { PrefabInstance } from './prefabInstance';
import { YELLOWSTAFF_COLOUR } from './staff';
import { TILE_SIZE } from './tile';

/** staff_castinglight.lua's expanding light: a non-persistent FX light entity parented to the caster. */
export class StaffCastingLight {
  private readonly entity: ReturnType<typeof spawnLightEntity>;
  private elapsed = 0;
  private active = false;
  private duration = 1.9;
  private delay = 0.33;
  private colour: readonly [number, number, number] = YELLOWSTAFF_COLOUR;

  constructor(owner: PrefabInstance) {
    this.entity = spawnLightEntity('staff_castinglight', owner);
  }

  get instance(): PrefabInstance { return this.entity.instance; }

  /** staff_castinglight.lua SetUp(colour, duration, delay); the staff's own cast waits .33 seconds for 1.9. */
  start(colour: readonly [number, number, number] = YELLOWSTAFF_COLOUR, duration = 1.9, delay = 0.33): void {
    this.colour = colour;
    this.duration = duration;
    this.delay = delay;
    this.elapsed = 0;
    this.active = true;
    this.refresh(0);
  }

  update(dt: number): void {
    if (!this.active) return;
    this.elapsed += dt;
    if (this.elapsed >= this.delay + this.duration) this.stop();
    else this.refresh(Math.max(0, (this.elapsed - this.delay) / this.duration));
  }

  stop(): void {
    this.active = false;
    this.entity.instance.light.set(null);
  }

  /** The caster is removed: the light entity goes with it. */
  dispose(): void {
    this.stop();
    this.entity.remove();
  }

  private refresh(progress: number): void {
    const k = progress ** 5;
    this.entity.instance.light.set({
      radius: (0.3 + 10 * k) * (TILE_SIZE / 4),
      intensity: 0.8 - 0.6 * k,
      falloff: 0.9 - 0.4 * k,
      colour: this.colour,
    });
  }
}
