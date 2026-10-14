import type { ItemEntity } from '../../inventory/src/entity';

/** bait.lua OnStolen: the bait transfers itself to the thief's inventory. */
export class Bait {
  private readonly stop: () => void;
  constructor(inst: ItemEntity) {
    this.stop = inst.ListenForEvent('onstolen', data => {
      const thief = (data as { thief?: { components: { inventory?: { GiveItem(item: ItemEntity): boolean } } } })?.thief;
      if (!inst.isRemoved && !inst.components.inventoryitem.owner) thief?.components.inventory?.GiveItem(inst);
    });
  }
  IsFree(): boolean { return true; }
  dispose(): void { this.stop(); }
}
