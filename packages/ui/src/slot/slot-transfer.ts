import { sameSlotAddress, type SlotAddress, type SlotItem, type SlotModel } from './slot-model';

export interface SlotTransferRequest {
  operationId: number;
  from: SlotAddress;
  to: SlotAddress;
  itemId: string;
  amount: number;
}

export interface SlotDragEndResult {
  dragged: boolean;
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
  if (targetItem && targetItem.id !== item.id) return 0;
  return targetItem
    ? Math.min(item.count, targetItem.maxStack - targetItem.count)
    : item.count;
}

export class SlotTransferController {
  private drag?: ActiveDrag;
  private operationId = 0;
  private preview?: HTMLDivElement;
  private readonly registered = new Set<RegisteredSlot>();

  register(slot: SlotModel, button: HTMLButtonElement): () => void {
    const registered = { slot, button };
    this.registered.add(registered);
    return () => {
      this.registered.delete(registered);
      if (this.drag?.source === registered || this.drag?.target === registered) this.cancel();
    };
  }

  begin(event: PointerEvent, slot: SlotModel): boolean {
    if (event.button !== 0 || this.drag) return false;
    const item = slot.getItem();
    if (!item) return false;

    const source = [...this.registered].find((entry) => entry.slot === slot);
    if (!source) return false;
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
    const amount = sourceItem?.id === drag.item.id
      ? transferAmount(drag.source.slot, target.slot, sourceItem)
      : 0;
    return {
      dragged: wasActive,
      request: amount <= 0 ? null : {
        operationId: ++this.operationId,
        from: { ...drag.source.slot.address },
        to: { ...target.slot.address },
        itemId: sourceItem!.id,
        amount,
      },
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

  private createPreview(
    sourceButton: HTMLButtonElement,
    item: SlotItem,
    clientX: number,
    clientY: number,
  ): void {
    this.preview?.remove();
    const sourceCanvas = sourceButton.querySelector<HTMLCanvasElement>('.inventory-slot__icon');
    const preview = document.createElement('div');
    preview.className = 'slot-drag-preview';
    preview.dataset.itemId = item.id;
    preview.setAttribute('aria-hidden', 'true');
    const sourceRect = sourceCanvas?.getBoundingClientRect()
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

    if (sourceCanvas) {
      const image = document.createElement('img');
      image.src = sourceCanvas.toDataURL();
      image.alt = '';
      image.className = 'slot-drag-preview__icon';
      Object.assign(image.style, {
        display: 'block',
        width: '100%',
        height: '100%',
        objectFit: 'contain',
      });
      preview.append(image);
    }

    if (item.count > 1) {
      const count = document.createElement('span');
      count.textContent = String(item.count);
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
