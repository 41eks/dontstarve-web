import { AssetElement } from './assets';
import { AnimatedBackground } from './animated-background';
import { createSignal } from './signal';
import { createSlotContainer, type SlotContainer, type SlotContainerKind } from './slot/slot-container';
import type { SlotAddress, SlotItem, SlotModel, SlotSelectDetail } from './slot/slot-model';
import { createSlotRenderer, type SlotRenderer } from './slot/slot-renderer';
import type { SlotTransferRequest } from './slot/slot-transfer';
import slotStyles from './styles/slot.css?inline';
import styles from './styles/chest-panel.css?inline';

export interface OpenChestOptions {
  containerId: string;
  slotCount: number;
  title?: string;
  panelArchive?: string;
  columns?: number;
  singleItems?: boolean;
}

export interface ChestCloseDetail {
  containerId: string;
}

export class DstChestPanelElement extends AssetElement {
  private container?: SlotContainer;
  private panelTitle = '箱子';
  private panelArchive = 'ui_chest_3x3.zip';
  private columns = 3;
  private readonly renderers: SlotRenderer[] = [];
  private readonly selectedSlot = createSignal<SlotAddress | null>(null);
  private background?: AnimatedBackground;
  private closing = false;

  get isClosing(): boolean { return this.closing; }

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  get slotContainer(): SlotContainer | undefined {
    return this.container;
  }

  protected get containerKind(): SlotContainerKind { return 'chest'; }
  protected get defaultPanelArchive(): string { return 'ui_chest_3x3.zip'; }
  protected get defaultColumns(): number { return 3; }
  protected get backgroundAsset(): string { return 'ingredient_slot.tex.png'; }
  protected get backgroundAtlas(): string | undefined { return undefined; }

  setAnchor(clientX: number, clientY: number): void {
    const panelBounds = this.shadowRoot
      ?.querySelector<HTMLElement>('.chest-panel')
      ?.getBoundingClientRect();
    const panelWidth = panelBounds?.width || 160;
    const panelHeight = panelBounds?.height || 210;
    const viewportMargin = 8;
    const panelGap = 10;
    if (this.containerKind === 'cookpot') {
      this.style.setProperty('--chest-panel-anchor-x',
        `${Math.max(viewportMargin, Math.min(window.innerWidth - panelWidth - viewportMargin, clientX + panelGap))}px`);
      this.style.setProperty('--chest-panel-anchor-y',
        `${Math.max(panelHeight / 2 + viewportMargin,
          Math.min(window.innerHeight - panelHeight / 2 - viewportMargin, clientY))}px`);
      return;
    }
    const minX = panelWidth / 2 + viewportMargin;
    const maxX = Math.max(minX, window.innerWidth - minX);
    const minY = panelHeight + panelGap + viewportMargin;
    const maxY = Math.max(minY, window.innerHeight - viewportMargin);

    this.style.setProperty(
      '--chest-panel-anchor-x',
      `${Math.min(maxX, Math.max(minX, clientX))}px`,
    );
    this.style.setProperty(
      '--chest-panel-anchor-y',
      `${Math.min(maxY, Math.max(minY, clientY))}px`,
    );
  }

  open(options: OpenChestOptions): void {
    if (!options.containerId) throw new TypeError('Chest container id must not be empty');
    if (!Number.isInteger(options.slotCount) || options.slotCount <= 0) {
      throw new RangeError(`Invalid chest slot count: ${options.slotCount}`);
    }
    this.closing = false;
    this.container = createSlotContainer({
      id: options.containerId,
      kind: options.singleItems ? 'cookpot' : this.containerKind,
      slotKeys: Array.from({ length: options.slotCount }, (_, index) => String(index)),
    });
    this.panelTitle = options.title ?? '箱子';
    this.panelArchive = options.panelArchive ?? this.defaultPanelArchive;
    this.columns = options.columns ?? this.defaultColumns;
    this.selectedSlot.set(null);
    if (this.isConnected) this.render();
  }

  close(): void {
    const containerId = this.container?.id;
    if (!containerId) return;
    this.disposeRenderers();
    this.container = undefined;
    this.selectedSlot.set(null);
    if (this.background && this.isConnected) {
      this.closing = true;
      const panel = this.shadowRoot!.querySelector<HTMLElement>('.chest-panel')!;
      panel.classList.remove('is-opening');
      panel.classList.add('is-closing');
      this.shadowRoot!.querySelector('.chest-panel__slots')!.replaceChildren();
      this.background.playOnce('close', () => {
        this.closing = false;
        this.render();
      });
    } else if (this.isConnected) this.render();
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
    this.background?.dispose();
    this.background = undefined;
    this.closing = false;
  }

  protected render(): void {
    this.disposeRenderers();
    this.background?.dispose();
    this.background = undefined;
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>${slotStyles}\n${styles}</style>
      <section class="chest-panel animated-chest-panel ${this.containerKind === 'cookpot' ? 'cook-pot-panel' : ''}" ${this.container || this.closing ? '' : 'hidden'}>
        <canvas class="chest-panel__background" aria-hidden="true"></canvas>
        <header>
          <h2></h2>
          ${this.containerKind === 'cookpot' ? '<button class="chest-panel__close" type="button" aria-label="关闭烹饪锅">×</button>' : ''}
        </header>
        <div class="chest-panel__slots" role="group"></div>
      </section>
    `;
    const panel = root.querySelector<HTMLElement>('.chest-panel')!;
    panel.style.setProperty('--storage-columns', String(this.columns));
    if (this.container || this.closing) {
      this.background = new AnimatedBackground(
        root.querySelector<HTMLCanvasElement>('.chest-panel__background')!,
        this.dataAsset(`anim/${this.panelArchive}`),
        ({ width, height, originX, originY }) => {
          panel.style.setProperty('--chest-art-width', String(width / 64));
          panel.style.setProperty('--chest-art-height', String(height / 64));
          panel.style.setProperty('--chest-art-origin-x', `${originX / width * 100}%`);
          panel.style.setProperty('--chest-art-origin-y', `${originY / height * 100}%`);
        },
      );
      panel.classList.add(this.closing ? 'is-closing' : 'is-opening');
      this.background.playOnce(this.closing ? 'close' : 'open', () => {
        if (this.closing) {
          this.closing = false;
          this.render();
        } else panel.classList.remove('is-opening');
      });
    }
    if (!this.container) return;

    const grid = root.querySelector<HTMLElement>('.chest-panel__slots')!;
    panel.setAttribute('aria-label', this.panelTitle);
    panel.querySelector('.chest-panel__close')?.setAttribute('aria-label', `关闭${this.panelTitle}`);
    panel.querySelector('h2')!.textContent = this.panelTitle;
    grid.setAttribute('aria-label', `${this.panelTitle}物品`);
    this.container.slots.forEach((slot, index) => {
      const renderer = createSlotRenderer({
        slot,
        label: `${this.panelTitle} ${index + 1}`,
        backgroundAsset: this.backgroundAsset,
        backgroundAtlas: this.backgroundAtlas,
        backgroundUrl: () => this.asset('bag/ingredient_slot.tex.png'),
        selectedSlot: this.selectedSlot.get,
        onSelect: (selected) => this.selectSlot(selected),
        onTransfer: (request) => this.dispatchTransfer(request),
      });
      this.renderers.push(renderer);
      grid.append(renderer.button);
      renderer.refresh();
      renderer.connect();
    });
    root.querySelector<HTMLButtonElement>('.chest-panel__close')
      ?.addEventListener('click', () => this.close());
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
