import { createAtlasImage } from '@dontstarve-web/animation/atlasImage';
import { sameSlotAddress, type SlotAddress, type SlotItem, type SlotModel } from './slot-model';

export interface SlotTransferRequest {
  operationId: number;
  from: SlotAddress;
  to: SlotAddress;
  itemId: string;
  skinId?: string;
  amount: number;
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

interface PickedUpSlot {
  item: SlotItem;
  source: RegisteredSlot;
  target?: RegisteredSlot;
}

function transferAmount(source: SlotModel, target: SlotModel, item: SlotItem): number {
  if (sameSlotAddress(source.address, target.address) || !target.accepts(item)) return 0;
  const targetItem = target.getItem();
  if (targetItem && (targetItem.id !== item.id || targetItem.skinId !== item.skinId)) return 0;
  const maxStack = Math.min(targetItem?.maxStack ?? item.maxStack, target.maxStack?.(item) ?? item.maxStack);
  return Math.max(0, Math.min(item.count, maxStack - (targetItem?.count ?? 0)));
}

export class SlotTransferController {
  private drag?: ActiveDrag;
  private pickedUp?: PickedUpSlot;
  private selected?: RegisteredSlot;
  private operationId = 0;
  private preview?: HTMLDivElement;
  private readonly registered = new Set<RegisteredSlot>();
  private readonly followPickedUpItem = (event: PointerEvent) => {
    this.movePreview(event.clientX, event.clientY);
    this.updatePickedUpTarget(event.clientX, event.clientY);
  };
  private readonly cancelPickedUpItemOnEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { this.clearPickedUp(); this.clearSelection(); }
  };
  private readonly followSelection = (event: PointerEvent) => this.movePreview(event.clientX, event.clientY);

  /** An application action owns the click; show its item without starting a transfer. */
  showSelection(address: SlotAddress): void {
    this.clearSelection(); this.clearPickedUp(); this.clearDrag();
    const source = [...this.registered].find(({ slot }) => sameSlotAddress(slot.address, address));
    const item = source?.slot.getItem();
    if (!source || !item) return;
    this.selected = source;
    const rect = source.button.getBoundingClientRect();
    this.createPreview(source.button, item, rect.left + rect.width / 2, rect.top + rect.height / 2);
    this.preview!.dataset.selection = 'true';
    document.addEventListener('pointermove', this.followSelection);
    document.addEventListener('keydown', this.cancelPickedUpItemOnEscape);
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
    document.removeEventListener('keydown', this.cancelPickedUpItemOnEscape);
    this.preview?.remove(); this.preview = undefined; this.selected = undefined;
  }

  register(slot: SlotModel, button: HTMLButtonElement): () => void {
    const registered = { slot, button };
    this.registered.add(registered);
    return () => {
      this.registered.delete(registered);
      if (this.selected === registered) this.clearSelection();
      if (this.drag?.source === registered || this.drag?.target === registered) this.cancel();
      if (this.pickedUp?.source === registered || this.pickedUp?.target === registered) {
        this.clearPickedUp();
      }
    };
  }

  begin(event: PointerEvent, slot: SlotModel): boolean {
    if (event.button !== 0 || this.drag || this.pickedUp) return false;
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

  click(event: MouseEvent, slot: SlotModel): SlotClickResult {
    if (event.button !== 0 || event.detail === 0) return { handled: false, request: null };

    const target = [...this.registered].find((entry) => entry.slot === slot);
    if (!target) return { handled: false, request: null };

    if (!this.pickedUp) {
      const item = slot.getItem();
      if (!item) return { handled: false, request: null };
      this.pickedUp = { item, source: target };
      target.button.classList.add('is-dragging');
      this.createPreview(target.button, item, event.clientX, event.clientY);
      document.addEventListener('pointermove', this.followPickedUpItem);
      document.addEventListener('keydown', this.cancelPickedUpItemOnEscape);
      return { handled: true, request: null };
    }

    const pickedUp = this.pickedUp;
    if (target === pickedUp.source) {
      this.clearPickedUp();
      return { handled: true, request: null };
    }

    const sourceItem = pickedUp.source.slot.getItem();
    if (!sourceItem
      || sourceItem.id !== pickedUp.item.id
      || sourceItem.skinId !== pickedUp.item.skinId) {
      this.clearPickedUp();
      return { handled: true, request: null };
    }

    const request = this.createTransferRequest(pickedUp.source.slot, target.slot, sourceItem);
    if (request) this.clearPickedUp();
    return { handled: true, request };
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

  private findTarget(clientX: number, clientY: number, source: RegisteredSlot): RegisteredSlot | undefined {
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

  private clearPickedUp(): void {
    if (!this.pickedUp) return;
    this.pickedUp.source.button.classList.remove('is-dragging');
    this.pickedUp.target?.button.classList.remove('is-drop-target');
    document.removeEventListener('pointermove', this.followPickedUpItem);
    document.removeEventListener('keydown', this.cancelPickedUpItemOnEscape);
    this.preview?.remove();
    this.preview = undefined;
    this.pickedUp = undefined;
  }

  private updatePickedUpTarget(clientX: number, clientY: number): void {
    const pickedUp = this.pickedUp;
    if (!pickedUp) return;
    const target = this.findTarget(clientX, clientY, pickedUp.source);
    if (pickedUp.target === target) return;
    pickedUp.target?.button.classList.remove('is-drop-target');
    pickedUp.target = target;
    if (target && transferAmount(pickedUp.source.slot, target.slot, pickedUp.item) > 0) {
      target.button.classList.add('is-drop-target');
    }
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
      ...(item.skinId === undefined ? {} : { skinId: item.skinId }),
      amount,
    };
  }

  private createPreview(
    sourceButton: HTMLButtonElement,
    item: SlotItem,
    clientX: number,
    clientY: number,
  ): void {
    this.preview?.remove();
    const sourceIcon = sourceButton.querySelector<HTMLElement>('.inventory-slot__icon');
    const preview = document.createElement('div');
    preview.className = 'slot-drag-preview';
    preview.dataset.itemId = item.id;
    preview.dataset.skinId = item.skinId ?? '';
    preview.setAttribute('aria-hidden', 'true');
    const sourceRect = sourceIcon?.getBoundingClientRect()
      ?? sourceButton.querySelector<HTMLElement>('.inventory-slot__content')?.getBoundingClientRect()
      ?? sourceButton.getBoundingClientRect();
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

    if (sourceIcon) {
      const image = createAtlasImage('slot-drag-preview__icon', sourceIcon.dataset.atlas!, sourceIcon.dataset.element!);
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
