import { ItemEntity } from './entity';
import type { ItemSlot } from './slots';
import type { InventoryStack } from './types';

/** One ingredient per cook pot slot; independent of the item's inventory stack limit. */
export class PreparedFoodSlot implements ItemSlot {
  private entity: ItemEntity | null = null;

  constructor(initialStack: InventoryStack | null = null) {
    this.set(initialStack);
  }

  get(): InventoryStack | null {
    return this.entity?.snapshot(false) ?? null;
  }

  set(stack: InventoryStack | null): void {
    if (stack && stack.count !== 1) throw new RangeError('Prepared food slots hold one item');
    this.entity = stack ? new ItemEntity(stack) : null;
  }

  getEntity(): ItemEntity | null { return this.entity; }
  setEntity(entity: ItemEntity | null): void {
    if (entity && entity.components.stackable.count !== 1) throw new RangeError('Prepared food slots hold one item');
    this.entity = entity;
  }

  accepts(): boolean {
    return true;
  }

  maxStack(): number {
    return 1;
  }
}
