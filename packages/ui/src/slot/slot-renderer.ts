import { createAtlasImage } from '@dontstarve-web/animation/atlasImage';
import { SlotReceiveAnimation, type InventoryReceiveSource } from './slot-receive-animation';
import { createEffect, createSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { AnimatedBackground } from '../animated-background';
import { bindSlotContextMenuInput, type SlotContextMenuRequest, type SlotSecondaryInput } from './slot-input';
import { sameSlotAddress, type SlotAddress, type SlotItem, type SlotModel } from './slot-model';
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
  onContextMenu?(request: SlotContextMenuRequest): void;
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
    <canvas class="inventory-slot__freshness" aria-hidden="true" hidden></canvas>
    <canvas class="inventory-slot__wetness" aria-hidden="true" hidden></canvas>
    <span class="inventory-slot__content" aria-hidden="true"></span>
    <span class="inventory-slot__count" aria-hidden="true"></span>
    <span class="inventory-slot__percent" aria-hidden="true"></span>
  `;
  if (options.backgroundAtlas) {
    const background = createAtlasImage('inventory-slot__background', options.backgroundAtlas, options.backgroundAsset);
    button.querySelector('.inventory-slot__background')!.replaceWith(background);
  }

  let stopSubscriptions: (() => void)[] | undefined;
  let stopItemValues: (() => void)[] = [];
  let freshnessMeter: AnimatedBackground | undefined;
  let wetnessMeter: AnimatedBackground | undefined;
  let spoilBackground: HTMLElement | undefined;
  let unregister: (() => void) | undefined;
  let stopContextMenu: (() => void) | undefined;
  const secondaryInput = createSignal<SlotSecondaryInput | null>(null);
  let suppressNextClick = false;
  const receiveAnimation = new SlotReceiveAnimation(button, () => options.slot.item.peek(), () => {
    const item = options.slot.item.peek();
    return item?.signals?.count.peek() ?? item?.count ?? 0;
  });

  const content = button.querySelector<HTMLElement>('.inventory-slot__content')!;
  const percent = button.querySelector<HTMLElement>('.inventory-slot__percent')!;
  const freshness = button.querySelector<HTMLCanvasElement>('.inventory-slot__freshness')!;
  const wetness = button.querySelector<HTMLCanvasElement>('.inventory-slot__wetness')!;
  const percentText = (value: number | undefined) => value === undefined ? ''
    : `${value > 0 ? Math.max(1, Math.round(value * 100)) : 0}%`;

  const updateItem = (item: SlotItem | null) => {
    button.classList.toggle('is-empty', item === null);
    button.dataset.itemId = item?.id ?? '';
    button.dataset.skinId = item?.skinId ?? '';
    receiveAnimation.sync();
    slotTransferController.syncSelection(options.slot);
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

  const sameAppearance = (left: SlotItem | null, right: SlotItem | null) => left?.entityId === right?.entityId
    && left?.id === right?.id && left?.skinId === right?.skinId && left?.name === right?.name
    && left?.icon === right?.icon && left?.atlas === right?.atlas;

  const updateQuantity = () => {
    // Receive animations own the displayed count while their items are in flight.
    receiveAnimation.sync();
    slotTransferController.syncSelection(options.slot);
  };
  const updateDurability = (value: number | undefined) => {
    // widgets/itemtile.lua:SetPercent retains 1% until exhaustion.
    percent.textContent = percentText(value);
  };
  const updateFreshness = (value: number | undefined) => {
    freshness.hidden = value === undefined;
    if (spoilBackground) spoilBackground.hidden = value === undefined;
    if (value === undefined) return;
    if (!spoilBackground) {
      spoilBackground = createAtlasImage('inventory-slot__spoil-background', 'images/hud.xml', 'inv_slot_spoiled.tex');
      button.insertBefore(spoilBackground, freshness);
    }
    freshnessMeter ??= new AnimatedBackground(freshness, `${import.meta.env.BASE_URL}dst/data/anim/spoiled_meter.zip`, () => {});
    // widgets/itemtile.lua:SetPerishPercent deliberately excludes the final spoiled pose.
    freshnessMeter.setPercent('anim', Math.max(0, Math.min(0.99, 1 - value)));
  };
  const updateWetness = (wet: boolean) => {
    wetness.hidden = !wet;
    button.classList.toggle('is-wet', wet);
    if (!wet) return;
    wetnessMeter ??= new AnimatedBackground(wetness, `${import.meta.env.BASE_URL}dst/data/anim/wet_meter.zip`, () => {});
    wetnessMeter.playOnce('idle');
  };
  const updateSelection = () => {
    const selected = sameSlotAddress(options.selectedSlot?.() ?? null, options.slot.address);
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-selected', String(selected));
  };
  const updateLabel = () => {
    const item = options.slot.getItem();
    const count = item?.count ?? 0;
    const durability = percentText(item?.durabilityPercent);
    const fresh = percentText(item?.freshnessPercent);
    const wet = item?.wet ?? false;
    button.setAttribute('aria-label', item
      ? `${item.name}，数量 ${count}${durability ? `，耐久 ${durability}` : ''}${fresh ? `，新鲜度 ${fresh}` : ''}${wet ? '，潮湿' : ''}`
      : options.label);
  };
  const renderAll = () => {
    const item = options.slot.item.peek();
    updateItem(item);
    updateQuantity();
    updateDurability(item?.signals ? item.signals.durabilityPercent.peek() : item?.durabilityPercent);
    updateFreshness(item?.signals ? item.signals.freshnessPercent.peek() : item?.freshnessPercent);
    updateWetness(item?.signals ? item.signals.wet.peek() : item?.wet ?? false);
    updateSelection();
    updateLabel();
  };

  const bindItem = (item: SlotItem | null, previous: SlotItem | null) => {
    if (!sameAppearance(item, previous)) updateItem(item);
    if (item?.signals && item.signals === previous?.signals) return;
    stopItemValues.forEach(stop => stop());
    stopItemValues = [];
    if (item?.signals) {
      const observe = <T>(signal: ReadonlySignal<T>, update: (value: T) => void) => {
        stopItemValues.push(signal.subscribe(update));
      };
      // These are inventory's signals; the UI creates no value state or DTO-derived memos.
      observe(item.signals.count, updateQuantity);
      observe(item.signals.durabilityPercent, updateDurability);
      observe(item.signals.freshnessPercent, updateFreshness);
      observe(item.signals.wet, updateWetness);
      updateQuantity();
      updateDurability(item.signals.durabilityPercent.peek());
      updateFreshness(item.signals.freshnessPercent.peek());
      updateWetness(item.signals.wet.peek());
    } else {
      // Detached presentation inputs (e.g. UI previews) are snapshots, not live inventory.
      if (item?.count !== previous?.count || previous?.signals) updateQuantity();
      if (item?.durabilityPercent !== previous?.durabilityPercent || previous?.signals) updateDurability(item?.durabilityPercent);
      if (item?.freshnessPercent !== previous?.freshnessPercent || previous?.signals) updateFreshness(item?.freshnessPercent);
      if (item?.wet !== previous?.wet || previous?.signals) updateWetness(item?.wet ?? false);
    }
  };

  button.addEventListener('click', (event) => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    // Selection runs first so a placeable item can claim the click for placement
    // instead of being picked up for a transfer.
    if (!slotTransferController.isHoldingItem && options.onSelect?.(options.slot)) return;
    const result = slotTransferController.click(event, options.slot);
    if (result.request) options.onTransfer?.(result.request);
  });
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    secondaryInput.set({ shiftKey: event.shiftKey });
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
      if (stopSubscriptions) return;
      stopSubscriptions = [];
      const contextMenu = bindSlotContextMenuInput(secondaryInput, options.slot);
      const stopRequests = contextMenu.request.subscribe(request => {
        if (request) options.onContextMenu?.(request);
      });
      stopContextMenu = () => { stopRequests(); contextMenu.dispose(); };
      unregister = slotTransferController.register(options.slot, button);
      renderAll();
      bindItem(options.slot.item.peek(), null);
      stopSubscriptions.push(options.slot.item.subscribe(bindItem));
      stopSubscriptions.push(createEffect(updateSelection), createEffect(updateLabel));
    },
    disconnect() {
      receiveAnimation.cancel();
      stopContextMenu?.();
      stopContextMenu = undefined;
      stopSubscriptions?.forEach(stop => stop());
      stopSubscriptions = undefined;
      stopItemValues.forEach(stop => stop());
      stopItemValues = [];
      freshnessMeter?.dispose(); freshnessMeter = undefined;
      wetnessMeter?.dispose(); wetnessMeter = undefined;
      unregister?.();
      unregister = undefined;
    },
    animateReceive(source, amount) {
      updateItem(options.slot.item.peek());
      receiveAnimation.receive(source, amount);
    },
    cancelReceiveAnimation() { receiveAnimation.cancel(); },
    refresh() {
      if (!options.backgroundAtlas) {
        button.querySelector<HTMLImageElement>('.inventory-slot__background')!.src = options.backgroundUrl();
      }
      renderAll();
    },
  };
}
