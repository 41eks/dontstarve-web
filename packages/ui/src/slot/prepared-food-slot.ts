import { createSignal } from '../signal';
import type { SlotAddress, SlotItem, SlotModel } from './slot-model';

/** UI mirror of the authoritative PreparedFoodSlot in packages/inventory. */
export class PreparedFoodSlot implements SlotModel {
  readonly address: SlotAddress;
  private readonly item = createSignal<SlotItem | null>(null);

  constructor(address: SlotAddress) {
    this.address = { ...address };
  }

  getItem(): SlotItem | null {
    return this.item.get();
  }

  setItem(item: SlotItem | null): void {
    this.item.set(item);
  }

  accepts(): boolean {
    return true;
  }

  maxStack(): number {
    return 1;
  }
}
