import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { ItemEntity } from './entity';
import type { ItemSlot } from './slots';
import type { InventoryStack, InventoryItemSpec } from './types';

/** One ingredient per cook pot slot; independent of the item's inventory stack limit. */
export class PreparedFoodSlot implements ItemSlot {
  private readonly entityState = createSignal<ItemEntity | null>(null);
  /** The inst in this slot; UI subscribes to it. */
  readonly entity = readonlySignal(this.entityState);
  private readonly itemTest: (spec: InventoryItemSpec, itemId?: string) => boolean;

  constructor(itemTest: (spec: InventoryItemSpec, itemId?: string) => boolean = () => true) {
    this.itemTest = itemTest;
  }

  get(): InventoryStack | null {
    return this.entityState.peek()?.snapshot(false) ?? null;
  }

  getEntity(): ItemEntity | null { return this.entityState.peek(); }
  setEntity(entity: ItemEntity | null): void {
    if (entity && entity.components.stackable.count !== 1) { throw new RangeError('Prepared food slots hold one item'); }
    this.entityState.set(entity);
  }

  accepts(spec: InventoryItemSpec, itemId?: string): boolean {
    return this.itemTest(spec, itemId);
  }

  maxStack(): number {
    return 1;
  }
}
