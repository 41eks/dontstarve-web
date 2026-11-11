import { addComponent } from './components';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Edible } from '../../componets/src/edible';
import { Bait } from '../../componets/src/bait';
import type { EntityTask } from './prefabInstance';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { MoleBaitTarget } from '../../stategraphs/src/moleactions';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { Vector3 } from 'three';

/** The source catalog records actual molebait + bait components, including minerals and trinkets. */
export function configureMoleBaitEntity(entity: ItemEntity): void {
  const definition = GROUND_ITEM_DEFINITIONS[entity.prefab];
  if (definition?.elementalFoodHunger !== undefined && !entity.components.edible) {
    const edible = addComponent(entity, 'edible', Edible, () => entity.components.perishable.stage.peek());
    edible.hungervalue = definition.elementalFoodHunger; entity.addTag('edible_ELEMENTAL');
  }
  if (!definition?.moleBait) return;
  entity.addTag('molebait');
  addComponent(entity, 'bait', Bait);
}
/** A shared target wrapper preserves the source's five-second selection lock between moles. */
export class MoleBait implements MoleBaitTarget {
  /** target.selectedasmoletarget, cleared by molebrain's SelectedTargetTimeout or the STEALMOLEBAIT action. */
  private selectedasmoletarget = false;
  private selectedTimeout?: EntityTask;
  readonly entity: ItemEntity;
  private readonly walkable: (p: Vector3) => boolean;
  constructor(entity: ItemEntity, scheduler: GameTimeScheduler, walkable: (p: Vector3) => boolean) {
    this.entity = entity; this.walkable = walkable;
    if (!entity.worldServices?.scheduler) entity.BindScheduler(scheduler);
  }
  get prefab(): string { return this.entity.prefab; }
  get components() { return { bait: this.entity.components.bait }; }
  hasTag(tag: string): boolean { return tag === 'INLIMBO' ? !!this.entity.components.inventoryitem.owner || this.entity.hasTag(tag) : this.entity.hasTag(tag); }
  isValid(): boolean { return !this.entity.isRemoved; }
  getPosition(): Vector3 { return this.entity.getPosition(); }
  getPhysicsRadius(): number { return 0; }
  canSteal(): boolean { return this.isValid() && !this.entity.components.inventoryitem.owner && !this.entity.components.burnable?.IsBurning(); }
  isOnValidGround(): boolean { return this.walkable(this.getPosition()); }
  reserve(): boolean {
    if (this.selectedasmoletarget) return false;
    this.selectedasmoletarget = true;
    this.selectedTimeout?.Cancel();
    this.selectedTimeout = this.entity.DoTaskInTime(5, () => { this.selectedasmoletarget = false; });
    return true;
  }
  releaseReservation(): void { this.selectedasmoletarget = false; }
  PushEvent(name: string, data?: unknown): void { this.entity.PushEvent(name, data); }
  dispose(): void { this.selectedTimeout?.Cancel(); }
}
