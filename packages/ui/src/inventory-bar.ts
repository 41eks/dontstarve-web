import { AssetElement } from './assets';
import {
  INVENTORY_SLOT_COUNT,
  PLAYER_EQUIPMENT_CONTAINER_ID,
  PLAYER_INVENTORY_CONTAINER_ID,
  equipmentSlotAddress,
  inventorySlotAddress,
  type EquipmentKind,
  type SlotAddress,
} from '@three-roaming/inventory';
import { createSignal } from './signal';
import { createSlotContainer, type SlotContainer } from './slot/slot-container';
import type {
  SlotContextMenuDetail,
  SlotItem,
  SlotModel,
  SlotSelectDetail,
} from './slot/slot-model';
import { createSlotRenderer, type SlotRenderer } from './slot/slot-renderer';
import type { SlotTransferRequest } from './slot/slot-transfer';
import styles from './styles/inventory-bar.css?inline';
import slotStyles from './styles/slot.css?inline';

export type InventoryBarItem = SlotItem;

export {
  INVENTORY_SLOT_COUNT,
  PLAYER_EQUIPMENT_CONTAINER_ID,
  PLAYER_INVENTORY_CONTAINER_ID,
  equipmentSlotAddress,
  inventorySlotAddress,
};
export type { EquipmentKind };

interface SlotDescriptor {
  slot: SlotModel;
  label: string;
  backgroundAsset: string;
}

const equipmentSlots = [
  { kind: 'hand', label: '手部装备', asset: 'equip_slot.tex.png' },
  { kind: 'body', label: '身体装备', asset: 'equip_slot_body.tex.png' },
  { kind: 'head', label: '头部装备', asset: 'equip_slot_head.tex.png' },
] as const;

export class DstInventoryBarElement extends AssetElement {
  private readonly inventory = createSlotContainer({
    id: PLAYER_INVENTORY_CONTAINER_ID,
    kind: 'inventory',
    slotKeys: Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index) => String(index)),
  });

  private readonly equipment: SlotContainer = createSlotContainer({
    id: PLAYER_EQUIPMENT_CONTAINER_ID,
    kind: 'equipment',
    slotKeys: equipmentSlots.map(({ kind }) => kind),
    accepts: (slotKey, item) => item.equippable === slotKey,
  });

  private readonly selectedSlot = createSignal<SlotAddress | null>(null);
  private readonly renderers: SlotRenderer[] = [];
  private initialized = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get containers(): readonly SlotContainer[] {
    return [this.inventory, this.equipment];
  }

  setSlot(address: SlotAddress, item: InventoryBarItem | null): void {
    this.requireSlot(address).setItem(item);
  }

  getSlot(address: SlotAddress): InventoryBarItem | null {
    return this.requireSlot(address).getItem();
  }

  disconnectedCallback(): void {
    this.disposeRenderers();
  }

  protected render(): void {
    if (this.initialized) {
      this.shadowRoot!
        .querySelector<HTMLImageElement>('.inventory-bar__inspect img')!
        .src = this.asset('bag/self_inspect_wilson.tex.png');
      this.renderers.forEach((renderer) => {
        renderer.refresh();
        renderer.connect();
      });
      return;
    }
    this.initialized = true;

    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>${slotStyles}\n${styles}</style>
      <section class="inventory-bar" aria-label="物品栏">
        <div class="inventory-bar__backdrop" aria-hidden="true"></div>
        <div class="inventory-bar__items" role="group" aria-label="背包">
          <div class="inventory-bar__item-group"></div>
          <div class="inventory-bar__item-group"></div>
          <div class="inventory-bar__item-group"></div>
        </div>
        <div class="inventory-bar__equipment" role="group" aria-label="装备"></div>
        <button class="inventory-bar__inspect" type="button" aria-label="查看角色">
          <img src="${this.asset('bag/self_inspect_wilson.tex.png')}" alt="" draggable="false" />
        </button>
      </section>
    `;

    const inventoryGroups = root.querySelectorAll<HTMLElement>('.inventory-bar__item-group');
    this.inventory.slots.forEach((slot, index) => {
      const renderer = this.createRenderer({
        slot,
        label: `物品栏 ${index + 1}`,
        backgroundAsset: 'ingredient_slot.tex.png',
      });
      inventoryGroups[Math.floor(index / 5)].append(renderer.button);
    });

    const equipment = root.querySelector<HTMLElement>('.inventory-bar__equipment')!;
    equipmentSlots.forEach(({ kind, label, asset }) => {
      const renderer = this.createRenderer({
        slot: this.equipment.getSlot(kind),
        label,
        backgroundAsset: asset,
      });
      equipment.append(renderer.button);
    });

    this.renderers.forEach((renderer) => {
      renderer.refresh();
      renderer.connect();
    });
    root.querySelector<HTMLButtonElement>('.inventory-bar__inspect')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('game:self-inspect', {
        bubbles: true,
        composed: true,
      }));
    });
  }

  private createRenderer(descriptor: SlotDescriptor): SlotRenderer {
    const renderer = createSlotRenderer({
      ...descriptor,
      backgroundUrl: () => this.asset(`bag/${descriptor.backgroundAsset}`),
      archiveUrl: () => this.dataAsset('databundles/images.zip'),
      selectedSlot: this.selectedSlot.get,
      onSelect: (slot) => this.selectSlot(slot),
      onContextMenu: (slot, event) => this.openSlotContextMenu(slot, event),
      onTransfer: (request) => this.dispatchTransfer(request),
    });
    this.renderers.push(renderer);
    return renderer;
  }

  /**
   * Returns true when a listener cancelled `game:slot-select`, meaning it claimed
   * the click (e.g. to start placement) and the slot must not pick the item up.
   */
  private selectSlot(slot: SlotModel): boolean {
    this.selectedSlot.set({ ...slot.address });
    const select = new CustomEvent<SlotSelectDetail>('game:slot-select', {
      bubbles: true,
      composed: true,
      cancelable: true,
      detail: { slot: { ...slot.address } },
    });
    this.dispatchEvent(select);
    return select.defaultPrevented;
  }

  private openSlotContextMenu(slot: SlotModel, event: MouseEvent): void {
    this.dispatchEvent(new CustomEvent<SlotContextMenuDetail>('game:slot-context-menu', {
      bubbles: true,
      composed: true,
      detail: { slot: { ...slot.address }, shiftKey: event.shiftKey },
    }));
  }

  private dispatchTransfer(detail: SlotTransferRequest): void {
    this.dispatchEvent(new CustomEvent<SlotTransferRequest>('game:slot-transfer-request', {
      bubbles: true,
      composed: true,
      detail,
    }));
  }

  private requireSlot(address: SlotAddress): SlotModel {
    const container = address.containerId === this.inventory.id
      ? this.inventory
      : address.containerId === this.equipment.id ? this.equipment : undefined;
    if (!container) throw new RangeError(`Unknown inventory container: ${address.containerId}`);
    return container.getSlot(address.slotKey);
  }

  private disposeRenderers(): void {
    this.renderers.forEach((renderer) => renderer.disconnect());
    this.renderers.length = 0;
  }
}
