import type { Health } from './health';
import type { Edible } from './edible';
export interface EaterFood {
  readonly prefab: string;
  readonly components?: { edible?: Edible };
  hasTag(tag: string): boolean;
  PushEvent?(name: string, data: unknown): void;
}
/** eater.lua's diet and consumption branch for small livestock without hunger/sanity components. */
export class Eater {
  private readonly inst: { addTag(tag: string): void; removeTag(tag: string): void; PushEvent(name: string, data: unknown): void; components: { health?: Health } };
  private diet: readonly string[] = [];
  private oneat?: () => void;
  constructor(inst: Eater['inst']) { this.inst = inst; }
  SetDiet(types: readonly string[]): void {
    for (const type of this.diet) this.inst.removeTag(`${type.toLowerCase()}_eater`);
    this.diet = types;
    for (const type of types) this.inst.addTag(`${type.toLowerCase()}_eater`);
  }
  SetOnEatFn(fn: () => void): void { this.oneat = fn; }
  CanEat(food: EaterFood): boolean { return !!food.components?.edible && this.diet.some(type => food.hasTag(`edible_${type}`)); }
  Eat(food: EaterFood, consume: () => boolean, feeder?: unknown): boolean {
    if (!this.CanEat(food)) return false;
    const health = food.components!.edible!.GetHealth();
    if (health !== 0) this.inst.components.health?.DoDelta(health, false, food.prefab);
    this.inst.PushEvent('oneat', { food, feeder }); this.oneat?.();
    food.PushEvent?.('oneaten', { eater: this.inst });
    return consume();
  }
  dispose(): void { this.SetDiet([]); this.oneat = undefined; }
}
