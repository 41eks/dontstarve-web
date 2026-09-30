import type { ItemSlot } from './slots';
import type { InventoryStack } from './types';

/** One ingredient per cook pot slot; independent of the item's inventory stack limit. */
export class PreparedFoodSlot implements ItemSlot {
  private stack: InventoryStack | null = null;

  constructor(initialStack: InventoryStack | null = null) {
    this.set(initialStack);
  }

  get(): InventoryStack | null {
    return this.stack ? { ...this.stack } : null;
  }

  set(stack: InventoryStack | null): void {
    if (stack && stack.count !== 1) throw new RangeError('Prepared food slots hold one item');
    this.stack = stack ? { ...stack } : null;
  }

  accepts(): boolean {
    return true;
  }

  maxStack(): number {
    return 1;
  }
}
