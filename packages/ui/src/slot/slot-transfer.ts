import { createEffect } from '@dontstarve-web/signals';
import { createAtlasImage } from '@dontstarve-web/animation/atlasImage';
import { sameSlotAddress, type SlotAddress, type SlotItem, type SlotModel } from './slot-model';

export interface SlotTransferRequest {
  operationId: number;
  from: SlotAddress;
  to: SlotAddress;
  itemId: string;
  entityId?: string;
  skinId?: string;
  amount: number;
  /** Occupied-slot clicks exchange the cursor and target; drag requests keep merge behavior. */
  swapWith?: { entityId?: string; itemId: string; skinId?: string; count: number };
}

export interface SlotDragEndResult {
  dragged: boolean;
  request: SlotTransferRequest | null;
}

export interface SlotClickResult {
  handled: boolean;
  request: SlotTransferRequest | null;
}

interface RegisteredSlot {
  button: HTMLButtonElement;
  slot: SlotModel;
}

interface ActiveDrag {
  active: boolean;
  item: SlotItem;
  pointerId: number;
  source: RegisteredSlot;
  startX: number;
  startY: number;
  target?: RegisteredSlot;
}

function transferAmount(source: SlotModel, target: SlotModel, item: SlotItem): number {
  if (sameSlotAddress(source.address, target.address) || !target.accepts(item)) return 0;
  const targetItem = target.getItem();
  if (targetItem && (targetItem.id !== item.id || targetItem.skinId !== item.skinId)) return 0;
  const maxStack = Math.min(targetItem?.maxStack ?? item.maxStack, target.maxStack?.(item) ?? item.maxStack);
  return Math.max(0, Math.min(item.count, maxStack - (targetItem?.count ?? 0)));
}

function canSwap(source: SlotModel, target: SlotModel, item: SlotItem): boolean {
  const other = target.getItem();
  return other !== null && !sameSlotAddress(source.address, target.address)
    && target.accepts(item) && source.accepts(other)
    && item.count <= Math.min(item.maxStack, target.maxStack?.(item) ?? item.maxStack)
    && other.count <= Math.min(other.maxStack, source.maxStack?.(other) ?? other.maxStack);
}

export class SlotTransferController {
  private drag?: ActiveDrag;
  private cursor?: SlotModel;
  private cursorOrigin?: SlotAddress;
  private cursorTarget?: RegisteredSlot;
  private pendingPickup?: { operationId: number; origin: SlotAddress };
  private pointer = { x: 0, y: 0 };
  private returnCursor?: (origin?: SlotAddress) => void;
  private selected?: RegisteredSlot;
  private operationId = 0;
  private preview?: HTMLDivElement;
  get isHoldingItem(): boolean { return !!this.cursor?.getItem(); }
  private readonly registered = new Set<RegisteredSlot>();
  private readonly followCursor = (event: PointerEvent) => {
    this.pointer = { x: event.clientX, y: event.clientY };
    this.movePreview(event.clientX, event.clientY);
    this.updateCursorTarget(event.clientX, event.clientY);
  };
  private readonly handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { this.returnCursor?.(this.cursorOrigin); this.clearSelection(); }
  };
  private readonly followSelection = (event: PointerEvent) => this.movePreview(event.clientX, event.clientY);

  /** An application action owns the click; show its item without starting a transfer. */
  showSelection(address: SlotAddress): void {
    if (this.isHoldingItem) return;
    this.clearSelection(); this.clearDrag();
    const source = [...this.registered].find(({ slot }) => sameSlotAddress(slot.address, address));
    const item = source?.slot.getItem();
    if (!source || !item) return;
    this.selected = source;
    const rect = source.button.getBoundingClientRect();
    this.createPreview(source.button, item, rect.left + rect.width / 2, rect.top + rect.height / 2);
    this.preview!.dataset.selection = 'true';
    document.addEventListener('pointermove', this.followSelection);
    document.addEventListener('keydown', this.handleEscape);
  }

  syncSelection(slot: SlotModel): void {
    if (this.selected?.slot !== slot) return;
    const item = slot.getItem();
    if (!item || item.id !== this.preview?.dataset.itemId || (item.skinId ?? '') !== this.preview.dataset.skinId) {
      this.clearSelection(); return;
    }
    const count = this.preview.querySelector<HTMLElement>('.slot-drag-preview__count')!;
    count.textContent = item.count > 1 ? String(item.count) : '';
  }

  clearSelection(): void {
    if (!this.selected) return;
    document.removeEventListener('pointermove', this.followSelection);
    document.removeEventListener('keydown', this.handleEscape);
    this.preview?.remove(); this.preview = undefined; this.selected = undefined;
  }

  register(slot: SlotModel, button: HTMLButtonElement): () => void {
    const registered = { slot, button };
    this.registered.add(registered);
    return () => {
      this.registered.delete(registered);
      if (this.selected === registered) this.clearSelection();
      if (this.drag?.source === registered || this.drag?.target === registered) this.cancel();
      if (this.cursorTarget === registered) {
        registered.button.classList.remove('is-drop-target'); this.cursorTarget = undefined;
      }
    };
  }

  begin(event: PointerEvent, slot: SlotModel): boolean {
    if (event.button !== 0 || this.drag || this.isHoldingItem) return false;
    const item = slot.getItem();
    if (!item) return false;

    const source = [...this.registered].find((entry) => entry.slot === slot);
    if (!source) return false;
    this.clearSelection();
    source.button.setPointerCapture(event.pointerId);
    this.drag = {
      active: false,
      item,
      pointerId: event.pointerId,
      source,
      startX: event.clientX,
      startY: event.clientY,
    };
    return true;
  }

  /** The UI reads the authoritative cursor projection and only requests domain transfers. */
  bindCursor(slot: SlotModel, onReturn: (origin?: SlotAddress) => void): () => void {
    this.cursor = slot;
    this.returnCursor = onReturn;
    const stop = createEffect(() => this.refreshCursor());
    return () => {
      stop();
      if (this.cursor !== slot) return;
      this.clearCursorPreview();
      this.cursor = undefined; this.returnCursor = undefined;
    };
  }

  click(event: MouseEvent, slot: SlotModel): SlotClickResult {
    if (event.button !== 0 || event.detail === 0 || !this.cursor) return { handled: false, request: null };
    this.pointer = { x: event.clientX, y: event.clientY };
    const held = this.cursor.getItem();
    if (!held) {
      const item = slot.getItem();
      if (!item) return { handled: false, request: null };
      this.clearSelection();
      const request = this.createTransferRequest(slot, this.cursor, item);
      if (request) this.pendingPickup = { operationId: request.operationId, origin: { ...slot.address } };
      return { handled: true, request };
    }
    const request = slot.getItem()
      ? this.createSwapRequest(this.cursor, slot, held)
      : this.createTransferRequest(this.cursor, slot, held);
    return { handled: true, request };
  }

  /** Publish a preview only after the application has committed the transfer. */
  completeTransfer(operationId: number, success: boolean): void {
    if (this.pendingPickup?.operationId === operationId) {
      if (success) this.cursorOrigin = this.pendingPickup.origin;
      this.pendingPickup = undefined;
    }
    this.refreshCursor();
  }

  private refreshCursor(): void {
    const item = this.cursor?.getItem();
    if (!item) {
      this.clearCursorPreview();
      this.cursorOrigin = undefined;
      return;
    }
    this.clearSelection();
    this.cursorTarget?.button.classList.remove('is-drop-target');
    this.cursorTarget = undefined;
    const source = [...this.registered].find(({ slot }) => sameSlotAddress(slot.address, this.cursorOrigin ?? null))
      ?? [...this.registered][0];
    this.createPreview(source?.button, item, this.pointer.x, this.pointer.y);
    this.preview!.dataset.cursor = 'true';
    this.preview!.dataset.containerId = this.cursor!.address.containerId;
    this.preview!.dataset.slotKey = this.cursor!.address.slotKey;
    document.addEventListener('pointermove', this.followCursor);
    document.addEventListener('keydown', this.handleEscape);
    this.updateCursorTarget(this.pointer.x, this.pointer.y);
  }

  move(event: PointerEvent): boolean {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return false;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) {
      return false;
    }
    if (!drag.active) {
      drag.active = true;
      drag.source.button.classList.add('is-dragging');
      this.createPreview(drag.source.button, drag.item, event.clientX, event.clientY);
    }
    this.movePreview(event.clientX, event.clientY);

    const target = this.findTarget(event.clientX, event.clientY, drag.source);
    if (drag.target !== target) {
      drag.target?.button.classList.remove('is-drop-target');
      drag.target = target;
      if (target && transferAmount(drag.source.slot, target.slot, drag.item) > 0) {
        target.button.classList.add('is-drop-target');
      }
    }
    event.preventDefault();
    return true;
  }

  end(event: PointerEvent): SlotDragEndResult {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return { dragged: false, request: null };
    const wasActive = drag.active;
    const target = drag.target;
    this.clearDrag();
    if (!wasActive || !target) return { dragged: wasActive, request: null };

    const sourceItem = drag.source.slot.getItem();
    const request = sourceItem?.id === drag.item.id && sourceItem.skinId === drag.item.skinId
      && sourceItem.entityId === drag.item.entityId
      ? this.createTransferRequest(drag.source.slot, target.slot, sourceItem)
      : null;
    return {
      dragged: wasActive,
      request,
    };
  }

  cancel(event?: PointerEvent): void {
    if (event && this.drag?.pointerId !== event.pointerId) return;
    this.clearDrag();
  }

  private findTarget(clientX: number, clientY: number, source?: RegisteredSlot): RegisteredSlot | undefined {
    for (const registered of this.registered) {
      if (registered === source || !registered.button.isConnected) continue;
      const rect = registered.button.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right
        && clientY >= rect.top && clientY <= rect.bottom) {
        return registered;
      }
    }
    return undefined;
  }

  private clearDrag(): void {
    if (!this.drag) return;
    this.drag.source.button.classList.remove('is-dragging');
    this.drag.target?.button.classList.remove('is-drop-target');
    this.preview?.remove();
    this.preview = undefined;
    this.drag = undefined;
  }

  private clearCursorPreview(): void {
    this.cursorTarget?.button.classList.remove('is-drop-target');
    this.cursorTarget = undefined;
    document.removeEventListener('pointermove', this.followCursor);
    if (!this.selected) document.removeEventListener('keydown', this.handleEscape);
    if (this.preview?.dataset.cursor === 'true') { this.preview.remove(); this.preview = undefined; }
  }

  private updateCursorTarget(clientX: number, clientY: number): void {
    const item = this.cursor?.getItem();
    if (!item || !this.cursor) return;
    const target = this.findTarget(clientX, clientY);
    if (this.cursorTarget === target) return;
    this.cursorTarget?.button.classList.remove('is-drop-target');
    this.cursorTarget = target;
    if (target && (target.slot.getItem()
      ? canSwap(this.cursor, target.slot, item)
      : transferAmount(this.cursor, target.slot, item) > 0)) {
      target.button.classList.add('is-drop-target');
    }
  }

  private createSwapRequest(source: SlotModel, target: SlotModel, item: SlotItem): SlotTransferRequest | null {
    if (!canSwap(source, target, item)) return null;
    const other = target.getItem()!;
    return {
      operationId: ++this.operationId,
      from: { ...source.address }, to: { ...target.address },
      itemId: item.id, amount: item.count,
      ...(item.entityId === undefined ? {} : { entityId: item.entityId }),
      ...(item.skinId === undefined ? {} : { skinId: item.skinId }),
      swapWith: {
        itemId: other.id, count: other.count,
        ...(other.entityId === undefined ? {} : { entityId: other.entityId }),
        ...(other.skinId === undefined ? {} : { skinId: other.skinId }),
      },
    };
  }

  private createTransferRequest(
    source: SlotModel,
    target: SlotModel,
    item: SlotItem,
  ): SlotTransferRequest | null {
    const amount = transferAmount(source, target, item);
    return amount <= 0 ? null : {
      operationId: ++this.operationId,
      from: { ...source.address },
      to: { ...target.address },
      itemId: item.id,
      ...(item.entityId === undefined ? {} : { entityId: item.entityId }),
      ...(item.skinId === undefined ? {} : { skinId: item.skinId }),
      amount,
    };
  }

  private createPreview(
    sourceButton: HTMLButtonElement | undefined,
    item: SlotItem,
    clientX: number,
    clientY: number,
  ): void {
    this.preview?.remove();
    const sourceIcon = sourceButton?.querySelector<HTMLElement>('.inventory-slot__icon');
    const preview = document.createElement('div');
    preview.className = 'slot-drag-preview';
    preview.dataset.itemId = item.id;
    preview.dataset.skinId = item.skinId ?? '';
    preview.setAttribute('aria-hidden', 'true');
    const sourceRect = sourceIcon?.getBoundingClientRect()
      ?? sourceButton?.querySelector<HTMLElement>('.inventory-slot__content')?.getBoundingClientRect()
      ?? sourceButton?.getBoundingClientRect() ?? { width: 48, height: 48 };
    Object.assign(preview.style, {
      position: 'fixed',
      zIndex: '2147483647',
      display: 'grid',
      width: `${sourceRect.width}px`,
      height: `${sourceRect.height}px`,
      placeItems: 'center',
      pointerEvents: 'none',
      opacity: '0.9',
      filter: 'drop-shadow(0 5px 4px rgb(0 0 0 / 55%))',
      transform: 'translate(-50%, -50%)',
    });

    {
      const image = createAtlasImage('slot-drag-preview__icon', item.atlas ?? 'images/inventoryimages.xml', item.icon);
      Object.assign(image.style, {
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      });
      preview.append(image);
    }

    {
      const count = document.createElement('span');
      count.className = 'slot-drag-preview__count';
      count.textContent = item.count > 1 ? String(item.count) : '';
      Object.assign(count.style, {
        position: 'absolute',
        right: '2px',
        bottom: '1px',
        color: '#fff',
        font: '700 18px/1 sans-serif',
        textShadow: '-1px -1px #21180e, 1px -1px #21180e, -1px 1px #21180e, 1px 1px #21180e',
      });
      preview.append(count);
    }

    if (item.durabilityPercent !== undefined) {
      const percent = document.createElement('span');
      percent.className = 'slot-drag-preview__percent';
      percent.textContent = `${item.durabilityPercent > 0 ? Math.max(1, Math.round(item.durabilityPercent * 100)) : 0}%`;
      Object.assign(percent.style, { position: 'absolute', bottom: '-12px', color: '#fff',
        font: '700 12px/1 sans-serif', textShadow: '0 1px 2px #21180e' });
      preview.append(percent);
    }

    document.body.append(preview);
    this.preview = preview;
    this.movePreview(clientX, clientY);
  }

  private movePreview(clientX: number, clientY: number): void {
    if (!this.preview) return;
    this.preview.style.left = `${clientX}px`;
    this.preview.style.top = `${clientY}px`;
  }
}

export const slotTransferController = new SlotTransferController();
