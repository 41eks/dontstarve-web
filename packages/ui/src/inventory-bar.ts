import { AssetElement } from './assets';
import { createAtlasImage } from '@dontstarve-web/animation/atlasImage';
import {
  INVENTORY_SLOT_COUNT,
  PLAYER_EQUIPMENT_CONTAINER_ID,
  PLAYER_INVENTORY_CONTAINER_ID,
  equipmentSlotAddress,
  inventorySlotAddress,
  cursorSlotAddress,
  PLAYER_CURSOR_CONTAINER_ID,
  type EquipmentKind,
  type SlotAddress,
} from '@dontstarve-web/inventory';
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { SlotContextMenuRequest } from './slot/slot-input';
import { createSlotContainer, type SlotContainer } from './slot/slot-container';
import type {
  SlotContextMenuDetail,
  SlotItem,
  SlotModel,
  SlotSelectDetail,
} from './slot/slot-model';
import { createSlotRenderer, type SlotRenderer } from './slot/slot-renderer';
import type { InventoryReceiveSource } from './slot/slot-receive-animation';
import { slotTransferController, type SlotTransferRequest } from './slot/slot-transfer';
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

  private readonly cursor = createSlotContainer({ id: PLAYER_CURSOR_CONTAINER_ID, kind: 'inventory', slotKeys: ['0'] });
  private stopCursor?: () => void;

  private readonly selectedSlot = createSignal<SlotAddress | null>(null);
  private readonly contextMenuState = createSignal<SlotContextMenuRequest | null>(null);
  readonly contextMenu = readonlySignal(this.contextMenuState);
  private readonly renderers: SlotRenderer[] = [];
  private initialized = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get containers(): readonly SlotContainer[] {
    return [this.inventory, this.equipment, this.cursor];
  }

  setSlot(address: SlotAddress, item: InventoryBarItem | null): void {
    this.requireSlot(address).setItem(item);
  }

  animateReceive(address: SlotAddress, source: InventoryReceiveSource, amount: number): void {
    this.requireSlot(address);
    this.renderers.find(({ button }) => button.dataset.containerId === address.containerId
      && button.dataset.slotKey === address.slotKey)?.animateReceive(source, amount);
  }

  cancelReceiveAnimations(): void {
    this.renderers.forEach((renderer) => renderer.cancelReceiveAnimation());
  }

  getSlot(address: SlotAddress): InventoryBarItem | null {
    return this.requireSlot(address).getItem();
  }

  disconnectedCallback(): void {
    this.disposeRenderers();
  }

  protected render(): void {
    if (!this.stopCursor) this.stopCursor = slotTransferController.bindCursor(this.cursor.getSlot(cursorSlotAddress().slotKey), origin => {
      this.dispatchEvent(new CustomEvent('game:cursor-return-request', { bubbles: true, composed: true, detail: { origin } }));
    });
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

    const backdrop = createAtlasImage('inventory-bar__backdrop', 'images/hud.xml', 'inventory_bg.tex');
    root.querySelector('.inventory-bar__backdrop')!.replaceWith(backdrop);
    void backdrop.ready.then(() => {
      backdrop.style.aspectRatio = `${backdrop.dataset.width} / ${backdrop.dataset.height}`;
    }).catch((error: unknown) => console.error('Unable to load inventory background', error));

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
      selectedSlot: this.selectedSlot.get,
      onSelect: (slot) => this.selectSlot(slot),
      onContextMenu: (request) => this.openSlotContextMenu(request),
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

  private openSlotContextMenu(request: SlotContextMenuRequest): void {
    this.contextMenuState.set(request);
    this.dispatchEvent(new CustomEvent<SlotContextMenuDetail>('game:slot-context-menu', {
      bubbles: true,
      composed: true,
      detail: { slot: { ...request.slot }, shiftKey: request.shiftKey },
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
      : address.containerId === this.equipment.id ? this.equipment
      : address.containerId === this.cursor.id ? this.cursor : undefined;
    if (!container) throw new RangeError(`Unknown inventory container: ${address.containerId}`);
    return container.getSlot(address.slotKey);
  }

  private disposeRenderers(): void {
    this.stopCursor?.(); this.stopCursor = undefined;
    this.renderers.forEach((renderer) => renderer.disconnect());
  }
}
