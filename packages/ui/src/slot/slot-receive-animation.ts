import { createAtlasImage } from '@dontstarve-web/animation/atlasImage';
import type { SlotItem } from './slot-model';

export interface InventoryReceiveSource { x: number; y: number; }
export const INVENTORY_RECEIVE_DURATION_MS = 300;
export const INVENTORY_RECEIVE_PULSE_MS = 250;
// x(t) = t and y(t) = 1 - (1 - t)^3: the exact Lua easing.outCubic curve.
const outCubic = 'cubic-bezier(0.3333333333, 1, 0.6666666667, 1)';

interface Flight {
  amount: number;
  element: HTMLElement;
  animation?: Animation;
}

function identity(item: SlotItem | null): string {
  return item ? `${item.id}\n${item.skinId ?? ''}\n${item.atlas ?? ''}\n${item.icon}` : '';
}

/** Presentation only: slot state and transfers remain authoritative throughout a flight. */
export class SlotReceiveAnimation {
  private readonly button: HTMLButtonElement;
  private readonly content: HTMLElement;
  private readonly count: HTMLElement;
  private readonly getItem: () => SlotItem | null;
  private readonly flights = new Set<Flight>();
  private pulses: Animation[] = [];
  private lastItem: SlotItem | null = null;

  constructor(button: HTMLButtonElement, getItem: () => SlotItem | null) {
    this.button = button;
    this.content = button.querySelector('.inventory-slot__content')!;
    this.count = button.querySelector('.inventory-slot__count')!;
    this.getItem = getItem;
  }

  sync(): void {
    const item = this.getItem();
    if (identity(item) !== identity(this.lastItem) || (item?.count ?? 0) < (this.lastItem?.count ?? 0)) {
      this.cancel();
    }
    this.lastItem = item;
    this.present();
  }

  receive(source: InventoryReceiveSource, amount: number): void {
    const item = this.getItem();
    if (!item || !Number.isSafeInteger(amount) || amount <= 0 || amount > item.count
      || !Number.isFinite(source.x) || !Number.isFinite(source.y) || !this.button.isConnected) return;
    const slotRect = this.button.getBoundingClientRect();
    if (slotRect.width <= 0 || slotRect.height <= 0 || this.button.closest('[hidden]')) return;
    // A previous landing may be scaling the icon. Measure its base size through
    // the slot's parent scale, so a new flight keeps the normal icon dimensions.
    const slotStyle = getComputedStyle(this.button);
    const iconStyle = getComputedStyle(this.content);
    const width = parseFloat(iconStyle.width) * slotRect.width / parseFloat(slotStyle.width);
    const height = parseFloat(iconStyle.height) * slotRect.height / parseFloat(slotStyle.height);
    const rect = { width, height, left: slotRect.left + (slotRect.width - width) / 2,
      top: slotRect.top + (slotRect.height - height) / 2 };
    this.sync();
    const icon = createAtlasImage('inventory-slot__icon', item.atlas ?? 'images/inventoryimages.xml', item.icon);
    const element = document.createElement('div');
    element.className = 'inventory-receive-flight';
    element.setAttribute('aria-hidden', 'true');
    element.dataset.itemId = item.id;
    element.dataset.containerId = this.button.dataset.containerId;
    element.dataset.slotKey = this.button.dataset.slotKey;
    Object.assign(element.style, {
      position: 'fixed', left: '0', top: '0', width: `${rect.width}px`, height: `${rect.height}px`,
      zIndex: '1000', pointerEvents: 'none', visibility: 'hidden',
      transform: `translate3d(${source.x - rect.width / 2}px, ${source.y - rect.height / 2}px, 0)`,
    });
    Object.assign(icon.style, { width: '100%', height: '100%', display: 'block', objectFit: 'contain' });
    element.append(icon);
    document.body.append(element);
    const flight: Flight = { amount, element };
    this.flights.add(flight);
    this.present();
    window.addEventListener('resize', this.cancel);
    void icon.ready.then(() => {
      // Item transfers, element removal or scene shutdown may have cancelled while decoding.
      this.sync();
      if (!this.flights.has(flight) || !this.button.isConnected) { this.remove(flight); return; }
      element.style.visibility = 'visible';
      flight.animation = element.animate([
        { transform: element.style.transform },
        { transform: `translate3d(${rect.left}px, ${rect.top}px, 0)` },
      ], { duration: INVENTORY_RECEIVE_DURATION_MS, easing: outCubic, fill: 'forwards' });
      void flight.animation.finished.then(() => {
        this.sync();
        if (!this.flights.has(flight) || !this.button.isConnected) { this.remove(flight); return; }
        this.remove(flight);
        this.pulse();
      }).catch(() => this.remove(flight));
    }).catch(() => this.remove(flight));
  }

  private present(): void {
    const item = this.getItem();
    const pending = [...this.flights].reduce((sum, flight) => sum + flight.amount, 0);
    const displayedCount = Math.max(0, (item?.count ?? 0) - pending);
    this.content.style.visibility = item && displayedCount === 0 && pending > 0 ? 'hidden' : '';
    this.count.textContent = displayedCount > 1 ? String(displayedCount) : '';
  }

  private remove(flight: Flight): void {
    if (!this.flights.delete(flight)) return;
    flight.animation?.cancel();
    flight.element.remove();
    this.present();
    if (!this.flights.size) window.removeEventListener('resize', this.cancel);
  }

  private pulse(): void {
    this.pulses.forEach((animation) => animation.cancel());
    this.pulses = [this.content, this.count].map((element) => element.animate([
      { transform: 'scale(2)' }, { transform: 'scale(1)' },
    ], { duration: INVENTORY_RECEIVE_PULSE_MS, easing: outCubic }));
  }

  readonly cancel = (): void => {
    for (const flight of [...this.flights]) this.remove(flight);
    this.pulses.forEach((animation) => animation.cancel());
    this.pulses = [];
    this.present();
  };
}
