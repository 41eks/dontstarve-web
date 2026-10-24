import type { Vector3 } from 'three';

/** Entity primitive configured by Lua AddMiniMapEntity(), independent of terrain
 * rendering. Position is the owner's existing ground-contact transform.
 */
export class MiniMapEntity {
  private iconValue = '';
  private priorityValue = 0;
  private cacheValue = true;
  private fogValue = false;
  private enabledValue = true;

  readonly position: Vector3;

  constructor(position: Vector3) { this.position = position; }

  get icon(): string { return this.iconValue; }
  get priority(): number { return this.priorityValue; }
  get canUseCache(): boolean { return this.cacheValue; }
  get drawOverFogOfWar(): boolean { return this.fogValue; }
  get enabled(): boolean { return this.enabledValue; }

  SetIcon(icon: string): void { this.iconValue = icon; }
  SetPriority(priority: number): void { this.priorityValue = priority; }
  SetCanUseCache(canUseCache: boolean): void { this.cacheValue = canUseCache; }
  SetDrawOverFogOfWar(draw: boolean): void { this.fogValue = draw; }
  SetEnabled(enabled: boolean): void { this.enabledValue = enabled; }
  dispose(): void { this.enabledValue = false; }
}
