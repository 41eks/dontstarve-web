import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { SlotAddress, SlotItem, SlotModel } from './slot-model';

/** UI mirror of the authoritative PreparedFoodSlot in packages/inventory. */
export class PreparedFoodSlot implements SlotModel {
  readonly address: SlotAddress;
  private readonly itemState = createSignal<SlotItem | null>(null);
  readonly item = readonlySignal(this.itemState);

  constructor(address: SlotAddress) {
    this.address = { ...address };
  }

  getItem(): SlotItem | null {
    return this.itemState.get();
  }

  setItem(item: SlotItem | null): void {
    this.itemState.set(item);
  }

  accepts(): boolean {
    return true;
  }

  maxStack(): number {
    return 1;
  }
}
