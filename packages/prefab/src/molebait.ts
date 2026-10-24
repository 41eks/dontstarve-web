import type { ItemEntity } from '@dontstarve-web/inventory';
import { Edible } from '../../componets/src/edible';
import { Bait } from '../../componets/src/bait';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { MoleBaitTarget } from '../../stategraphs/src/moleactions';
import catalog from './groundItems.json';
import type { Vector3 } from 'three';

/** The source catalog records actual molebait + bait components, including minerals and trinkets. */
export function configureMoleBaitEntity(entity: ItemEntity): void {
  const definition = (catalog.items as Record<string, { moleBait?: boolean; elementalFoodHunger?: number }>)[entity.prefab];
  if (definition?.elementalFoodHunger !== undefined && !entity.components.edible) {
    const edible = new Edible(() => entity.components.perishable.stage.peek());
    edible.hungervalue = definition.elementalFoodHunger; entity.components.edible = edible; entity.addTag('edible_ELEMENTAL');
  }
  if (!definition?.moleBait) return;
  entity.addTag('molebait');
  entity.components.bait = entity.component('bait', () => new Bait(entity));
}
/** A shared target wrapper preserves the source's five-second selection lock between moles. */
export class MoleBait implements MoleBaitTarget {
  private readonly selection: ComponentTimer;
  readonly timer;
  readonly entity: ItemEntity;
  private readonly walkable: (p: Vector3) => boolean;
  constructor(entity: ItemEntity, scheduler: GameTimeScheduler, walkable: (p: Vector3) => boolean) {
    this.entity = entity; this.walkable = walkable;
    this.selection = new ComponentTimer(scheduler, () => undefined); this.timer = this.selection.snapshot;
  }
  get prefab(): string { return this.entity.prefab; }
  get components() { return { bait: this.entity.components.bait }; }
  hasTag(tag: string): boolean { return tag === 'INLIMBO' ? !!this.entity.components.inventoryitem.owner || this.entity.hasTag(tag) : this.entity.hasTag(tag); }
  isValid(): boolean { return !this.entity.isRemoved; }
  getPosition(): Vector3 { return this.entity.getPosition(); }
  getPhysicsRadius(): number { return 0; }
  canSteal(): boolean { return this.isValid() && !this.entity.components.inventoryitem.owner && !this.entity.components.burnable?.IsBurning(); }
  isOnValidGround(): boolean { return this.walkable(this.getPosition()); }
  reserve(): boolean { if (this.timer.peek().status === 'scheduled') return false; this.selection.start(5); return true; }
  releaseReservation(): void { this.selection.stop(); }
  PushEvent(name: string, data?: unknown): void { this.entity.PushEvent(name, data); }
  dispose(): void { this.selection.stop(); }
}
