import { createAtlasImage } from '@dontstarve-web/animation/atlasImage';
import { SlotReceiveAnimation, type InventoryReceiveSource } from './slot-receive-animation';
import { createEffect } from '../signal';
import { sameSlotAddress, type SlotAddress, type SlotModel } from './slot-model';
import { slotTransferController, type SlotTransferRequest } from './slot-transfer';

export interface CreateSlotRendererOptions {
  slot: SlotModel;
  label: string;
  backgroundAsset: string;
  backgroundAtlas?: string;
  backgroundUrl(): string;
  selectedSlot?(): SlotAddress | null;
  /** Return true to claim the click and skip the transfer pick-up. */
  onSelect?(slot: SlotModel): boolean;
  onContextMenu?(slot: SlotModel, event: MouseEvent): void;
  onTransfer?(request: SlotTransferRequest): void;
}

export interface SlotRenderer {
  readonly button: HTMLButtonElement;
  connect(): void;
  disconnect(): void;
  refresh(): void;
  animateReceive(source: InventoryReceiveSource, amount: number): void;
  cancelReceiveAnimation(): void;
}

export function createSlotRenderer(options: CreateSlotRendererOptions): SlotRenderer {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'inventory-slot is-empty';
  button.dataset.containerId = options.slot.address.containerId;
  button.dataset.slotKey = options.slot.address.slotKey;
  button.dataset.emptyLabel = options.label;
  button.dataset.backgroundAsset = options.backgroundAsset;
  button.setAttribute('aria-label', options.label);
  button.setAttribute('aria-selected', 'false');
  button.innerHTML = `
    <img class="inventory-slot__background" alt="" draggable="false" />
    <span class="inventory-slot__content" aria-hidden="true"></span>
    <span class="inventory-slot__count" aria-hidden="true"></span>
  `;
  if (options.backgroundAtlas) {
    const background = createAtlasImage('inventory-slot__background', options.backgroundAtlas, options.backgroundAsset);
    button.querySelector('.inventory-slot__background')!.replaceWith(background);
  }

  let disposeEffect: (() => void) | undefined;
  let unregister: (() => void) | undefined;
  let suppressNextClick = false;
  const receiveAnimation = new SlotReceiveAnimation(button, () => options.slot.getItem());

  const update = () => {
    const item = options.slot.getItem();
    const selected = sameSlotAddress(options.selectedSlot?.() ?? null, options.slot.address);
    const content = button.querySelector<HTMLElement>('.inventory-slot__content')!;
    const count = button.querySelector<HTMLElement>('.inventory-slot__count')!;
    button.classList.toggle('is-empty', item === null);
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-selected', String(selected));
    button.dataset.itemId = item?.id ?? '';
    button.dataset.skinId = item?.skinId ?? '';
    button.setAttribute('aria-label', item
      ? `${item.name}，数量 ${item.count}`
      : options.label);
    count.textContent = item && item.count > 1 ? String(item.count) : '';
    receiveAnimation.sync();

    if (!item) {
      content.dataset.iconKey = '';
      content.replaceChildren();
      return;
    }

    const atlasPath = item.atlas ?? 'images/inventoryimages.xml';
    const iconKey = `${atlasPath}\n${item.icon}`;
    if (content.dataset.iconKey === iconKey) return;
    content.dataset.iconKey = iconKey;
    content.replaceChildren(createAtlasImage('inventory-slot__icon', atlasPath, item.icon));
  };

  button.addEventListener('click', (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    // Selection runs first so a placeable item can claim the click for placement
    // instead of being picked up for a transfer.
    if (options.onSelect?.(options.slot)) return;
    const result = slotTransferController.click(event, options.slot);
    if (result.request) options.onTransfer?.(result.request);
  });
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    options.onContextMenu?.(options.slot, event);
  });
  button.addEventListener('pointerdown', (event) => {
    slotTransferController.begin(event, options.slot);
  });
  button.addEventListener('pointermove', (event) => {
    slotTransferController.move(event);
  });
  button.addEventListener('pointerup', (event) => {
    const result = slotTransferController.end(event);
    if (result.dragged) suppressNextClick = true;
    if (result.request) options.onTransfer?.(result.request);
  });
  button.addEventListener('pointercancel', (event) => {
    slotTransferController.cancel(event);
  });

  return {
    button,
    connect() {
      if (disposeEffect) return;
      unregister = slotTransferController.register(options.slot, button);
      disposeEffect = createEffect(update);
    },
    disconnect() {
      receiveAnimation.cancel();
      disposeEffect?.();
      disposeEffect = undefined;
      unregister?.();
      unregister = undefined;
    },
    animateReceive(source, amount) {
      update();
      receiveAnimation.receive(source, amount);
    },
    cancelReceiveAnimation() { receiveAnimation.cancel(); },
    refresh() {
      if (!options.backgroundAtlas) {
        button.querySelector<HTMLImageElement>('.inventory-slot__background')!.src = options.backgroundUrl();
      }
      update();
    },
  };
}
