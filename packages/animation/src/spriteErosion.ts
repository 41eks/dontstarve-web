import type { Object3D } from 'three';

const erosion = new WeakMap<Object3D, number>();

/** AnimState:SetErosionParams's amount, independent for each entity in a shared instance batch. */
export function setSpriteErosion(model: Object3D, amount: number): void {
  erosion.set(model, Math.max(0, Math.min(1, amount)));
}
export function getSpriteErosion(model: Object3D): number { return erosion.get(model) ?? 0; }
