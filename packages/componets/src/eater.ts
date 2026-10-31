import type { Health } from './health';
import type { Edible } from './edible';
import type { Hunger } from './hunger';
import type { Sanity } from './sanity';

// constants.lua FOODGROUP.OMNI
const OMNI = ['MEAT', 'VEGGIE', 'INSECT', 'SEEDS', 'GENERIC', 'GOODIES'];

interface EaterInstance {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  PushEvent(name: string, data: unknown): void;
  readonly components: { health?: Health; hunger?: Hunger; sanity?: Sanity };
}

export interface EaterFood {
  readonly prefab: string;
  readonly components?: { edible?: Edible };
  readonly isRemoved?: boolean;
  flush?(): void;
  hasTag(tag: string): boolean;
}
/** eater.lua: validate the food, read its edible values, apply stats and consume one. */
export class Eater {
  private readonly inst: EaterInstance;
  private diet: readonly string[] = [];
  private oneat?: () => void;
  constructor(inst: EaterInstance) { this.inst = inst; this.SetDiet(['OMNI']); }
  SetDiet(types: readonly string[]): void {
    for (const type of this.diet) this.inst.removeTag(`${type}_eater`);
    this.diet = types;
    for (const type of types) this.inst.addTag(`${type}_eater`);
  }
  SetOnEatFn(fn: () => void): void { this.oneat = fn; }
  CanEat(food: EaterFood): boolean {
    return !food.isRemoved && !!food.components?.edible
      && this.diet.some(type => (type === 'OMNI' ? OMNI : [type]).some(type => food.hasTag(`edible_${type}`)));
  }
  Eat(food: EaterFood, feeder: unknown = this.inst): boolean {
    food.flush?.();
    const edible = food.components?.edible;
    if (!edible || !this.CanEat(food)) return false;
    const health = edible.GetHealth(), hunger = edible.GetHunger(), sanity = edible.GetSanity();
    if (health !== 0) this.inst.components.health?.DoDelta(health, false, food.prefab);
    if (hunger !== 0) this.inst.components.hunger?.DoDelta(hunger);
    if (sanity !== 0) this.inst.components.sanity?.DoDelta(sanity);
    this.inst.PushEvent('oneat', { food, feeder }); this.oneat?.();
    edible.OnEaten(this.inst);
    return edible.HandleEatRemove();
  }
  dispose(): void { this.SetDiet([]); this.oneat = undefined; }
}
