import { AssetElement } from './assets';
import { createSignal } from './signal';
import { createSlotContainer, type SlotContainer } from './slot/slot-container';
import type { SlotAddress, SlotItem, SlotModel, SlotSelectDetail } from './slot/slot-model';
import { createSlotRenderer, type SlotRenderer } from './slot/slot-renderer';
import type { SlotTransferRequest } from './slot/slot-transfer';
import slotStyles from './styles/slot.css?inline';
import styles from './styles/chest-panel.css?inline';

export interface OpenChestOptions {
  containerId: string;
  slotCount: number;
  title?: string;
}

export interface ChestCloseDetail {
  containerId: string;
}

export class DstChestPanelElement extends AssetElement {
  private container?: SlotContainer;
  private panelTitle = '箱子';
  private readonly renderers: SlotRenderer[] = [];
  private readonly selectedSlot = createSignal<SlotAddress | null>(null);

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get slotContainer(): SlotContainer | undefined {
    return this.container;
  }

  open(options: OpenChestOptions): void {
    if (!options.containerId) throw new TypeError('Chest container id must not be empty');
    if (!Number.isInteger(options.slotCount) || options.slotCount <= 0) {
      throw new RangeError(`Invalid chest slot count: ${options.slotCount}`);
    }
    this.container = createSlotContainer({
      id: options.containerId,
      kind: 'chest',
      slotKeys: Array.from({ length: options.slotCount }, (_, index) => String(index)),
    });
    this.panelTitle = options.title ?? '箱子';
    this.selectedSlot.set(null);
    if (this.isConnected) this.render();
  }

  close(): void {
    const containerId = this.container?.id;
    if (!containerId) return;
    this.disposeRenderers();
    this.container = undefined;
    this.selectedSlot.set(null);
    if (this.isConnected) this.render();
    this.dispatchEvent(new CustomEvent<ChestCloseDetail>('game:chest-close', {
      bubbles: true,
      composed: true,
      detail: { containerId },
    }));
  }

  setSlot(address: SlotAddress, item: SlotItem | null): void {
    this.requireSlot(address).setItem(item);
  }

  getSlot(address: SlotAddress): SlotItem | null {
    return this.requireSlot(address).getItem();
  }

  disconnectedCallback(): void {
    this.disposeRenderers();
  }

  protected render(): void {
    this.disposeRenderers();
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>${slotStyles}\n${styles}</style>
      <section class="chest-panel" ${this.container ? '' : 'hidden'}>
        <header>
          <h2></h2>
          <button class="chest-panel__close" type="button" aria-label="关闭箱子">×</button>
        </header>
        <div class="chest-panel__slots" role="group"></div>
      </section>
    `;
    if (!this.container) return;

    const panel = root.querySelector<HTMLElement>('.chest-panel')!;
    const grid = root.querySelector<HTMLElement>('.chest-panel__slots')!;
    panel.setAttribute('aria-label', this.panelTitle);
    panel.querySelector('h2')!.textContent = this.panelTitle;
    grid.setAttribute('aria-label', `${this.panelTitle}物品`);
    this.container.slots.forEach((slot, index) => {
      const renderer = createSlotRenderer({
        slot,
        label: `${this.panelTitle} ${index + 1}`,
        backgroundAsset: 'ingredient_slot.tex.png',
        backgroundUrl: () => this.asset('bag/ingredient_slot.tex.png'),
        archiveUrl: () => this.dataAsset('databundles/images.zip'),
        selectedSlot: this.selectedSlot.get,
        onSelect: (selected) => this.selectSlot(selected),
        onTransfer: (request) => this.dispatchTransfer(request),
      });
      this.renderers.push(renderer);
      grid.append(renderer.button);
      renderer.refresh();
      renderer.connect();
    });
    root.querySelector<HTMLButtonElement>('.chest-panel__close')!
      .addEventListener('click', () => this.close());
  }

  private selectSlot(slot: SlotModel): void {
    this.selectedSlot.set({ ...slot.address });
    this.dispatchEvent(new CustomEvent<SlotSelectDetail>('game:slot-select', {
      bubbles: true,
      composed: true,
      detail: { slot: { ...slot.address } },
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
    if (!this.container || address.containerId !== this.container.id) {
      throw new RangeError(`Unknown chest container: ${address.containerId}`);
    }
    return this.container.getSlot(address.slotKey);
  }

  private disposeRenderers(): void {
    this.renderers.forEach((renderer) => renderer.disconnect());
    this.renderers.length = 0;
  }
}
