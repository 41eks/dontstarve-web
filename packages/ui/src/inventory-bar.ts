import { loadImageAtlas, type ImageAtlas } from '@three-roaming/wilson/imageAtlas';
import { AssetElement } from './assets';
import { createEffect, createState } from './solid';
import styles from './styles/inventory-bar.css?inline';

const INVENTORY_SLOT_COUNT = 15;

export type EquipmentKind = 'hand' | 'body' | 'head';

export type InventorySlotRef =
  | { group: 'inventory'; index: number }
  | { group: 'equipment'; kind: EquipmentKind };

export interface InventoryBarItem {
  id: string;
  name: string;
  count: number;
  maxStack: number;
  icon: string;
  atlas?: string;
  equippable?: EquipmentKind;
}

export interface InventorySlotChangeDetail {
  operationId: number;
  slot: InventorySlotRef;
  itemId: string;
  amount: number;
}

export interface InventorySlotSelectDetail {
  group: 'inventory' | 'equipment';
  index: number;
  kind?: EquipmentKind;
}

interface SlotView {
  item: InventoryBarItem | null;
  selected: boolean;
}

interface DragState {
  active: boolean;
  button: HTMLButtonElement;
  item: InventoryBarItem;
  pointerId: number;
  sourceIndex: number;
  startX: number;
  startY: number;
  targetIndex?: number;
}

const equipmentSlots = [
  { kind: 'hand', label: '手部装备', asset: 'equip_slot.tex.png' },
  { kind: 'body', label: '身体装备', asset: 'equip_slot_body.tex.png' },
  { kind: 'head', label: '头部装备', asset: 'equip_slot_head.tex.png' },
] as const;

const slotRefs: readonly InventorySlotRef[] = [
  ...Array.from({ length: INVENTORY_SLOT_COUNT }, (_, index): InventorySlotRef => ({
    group: 'inventory',
    index,
  })),
  ...equipmentSlots.map(({ kind }): InventorySlotRef => ({ group: 'equipment', kind })),
];

const atlasRequests = new Map<string, Promise<ImageAtlas>>();

function requestAtlas(archiveUrl: string, atlasPath: string) {
  const key = `${archiveUrl}\n${atlasPath}`;
  let request = atlasRequests.get(key);
  if (!request) {
    request = loadImageAtlas(archiveUrl, atlasPath);
    atlasRequests.set(key, request);
  }
  return request;
}

function sameSlot(left: InventorySlotRef, right: InventorySlotRef) {
  return left.group === right.group
    && (left.group === 'inventory'
      ? right.group === 'inventory' && left.index === right.index
      : right.group === 'equipment' && left.kind === right.kind);
}

export class DstInventoryBarElement extends AssetElement {
  private readonly slotStates = slotRefs.map(() => createState<SlotView>({
    item: null,
    selected: false,
  }));

  private readonly slotButtons: HTMLButtonElement[] = [];
  private drag?: DragState;
  private initialized = false;
  private operationId = 0;
  private selectedIndex?: number;
  private suppressNextClick = false;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  setSlot(ref: InventorySlotRef, item: InventoryBarItem | null): void {
    const index = this.slotIndex(ref);
    const previous = this.slotStates[index].get();
    this.slotStates[index].set({ ...previous, item });
  }

  getSlot(ref: InventorySlotRef): InventoryBarItem | null {
    return this.slotStates[this.slotIndex(ref)].get().item;
  }

  protected render(): void {
    if (this.initialized) {
      this.refreshAssets();
      return;
    }
    this.initialized = true;

    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>${styles}</style>
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
    for (let index = 0; index < INVENTORY_SLOT_COUNT; index += 1) {
      inventoryGroups[Math.floor(index / 5)].append(this.createSlot(
        index,
        `物品栏 ${index + 1}`,
        'ingredient_slot.tex.png',
      ));
    }

    const equipment = root.querySelector<HTMLElement>('.inventory-bar__equipment')!;
    equipmentSlots.forEach((slot, equipmentIndex) => {
      equipment.append(this.createSlot(
        INVENTORY_SLOT_COUNT + equipmentIndex,
        slot.label,
        slot.asset,
      ));
    });

    this.slotButtons.forEach((button, index) => {
      createEffect(() => this.updateSlot(button, this.slotStates[index].get()));
    });

    root.querySelector<HTMLButtonElement>('.inventory-bar__inspect')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('game:self-inspect', {
        bubbles: true,
        composed: true,
      }));
    });
  }

  private createSlot(index: number, label: string, asset: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-slot is-empty';
    button.dataset.slotIndex = String(index);
    button.dataset.emptyLabel = label;
    button.dataset.backgroundAsset = asset;
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-selected', 'false');
    button.innerHTML = `
      <img class="inventory-slot__background" src="${this.asset(`bag/${asset}`)}" alt="" draggable="false" />
      <span class="inventory-slot__content" aria-hidden="true"></span>
      <span class="inventory-slot__count" aria-hidden="true"></span>
    `;
    button.addEventListener('click', () => this.selectSlot(index));
    button.addEventListener('pointerdown', (event) => this.beginDrag(event, index));
    button.addEventListener('pointermove', (event) => this.moveDrag(event));
    button.addEventListener('pointerup', (event) => this.endDrag(event));
    button.addEventListener('pointercancel', (event) => this.cancelDrag(event));
    this.slotButtons[index] = button;
    return button;
  }

  private selectSlot(index: number): void {
    if (this.suppressNextClick) {
      this.suppressNextClick = false;
      return;
    }

    if (this.selectedIndex !== undefined && this.selectedIndex !== index) {
      const previous = this.slotStates[this.selectedIndex].get();
      this.slotStates[this.selectedIndex].set({ ...previous, selected: false });
    }
    const current = this.slotStates[index].get();
    this.slotStates[index].set({ ...current, selected: true });
    this.selectedIndex = index;

    const ref = slotRefs[index];
    const detail: InventorySlotSelectDetail = ref.group === 'inventory'
      ? { group: 'inventory', index: ref.index }
      : {
          group: 'equipment',
          index: equipmentSlots.findIndex(({ kind }) => kind === ref.kind),
          kind: ref.kind,
        };
    this.dispatchEvent(new CustomEvent<InventorySlotSelectDetail>('game:inventory-slot-select', {
      bubbles: true,
      composed: true,
      detail,
    }));
  }

  private updateSlot(button: HTMLButtonElement, view: SlotView): void {
    const { item } = view;
    const content = button.querySelector<HTMLElement>('.inventory-slot__content')!;
    const count = button.querySelector<HTMLElement>('.inventory-slot__count')!;
    button.classList.toggle('is-empty', item === null);
    button.classList.toggle('is-selected', view.selected);
    button.setAttribute('aria-selected', String(view.selected));
    button.dataset.itemId = item?.id ?? '';
    button.setAttribute('aria-label', item
      ? `${item.name}，数量 ${item.count}`
      : button.dataset.emptyLabel ?? '空格');
    count.textContent = item && item.count > 1 ? String(item.count) : '';

    if (!item) {
      content.dataset.iconKey = '';
      content.replaceChildren();
      return;
    }

    const archiveUrl = this.dataAsset('databundles/images.zip');
    const atlas = item.atlas ?? 'images/inventoryimages.xml';
    const iconKey = `${archiveUrl}\n${atlas}\n${item.icon}`;
    if (content.dataset.iconKey === iconKey) return;
    content.dataset.iconKey = iconKey;
    content.replaceChildren(this.atlasImage(archiveUrl, atlas, item.icon));
  }

  private atlasImage(archiveUrl: string, atlasPath: string, elementName: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = 'inventory-slot__icon';
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.archive = archiveUrl;
    canvas.dataset.atlas = atlasPath;
    canvas.dataset.element = elementName;

    void requestAtlas(archiveUrl, atlasPath).then((atlas) => {
      if (!canvas.isConnected) return;
      const sprite = atlas.require(elementName);
      canvas.width = sprite.width;
      canvas.height = sprite.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D context is unavailable');
      context.putImageData(
        new ImageData(Uint8ClampedArray.from(sprite.pixels), sprite.width, sprite.height),
        0,
        0,
      );
      canvas.dataset.loaded = 'true';
    }).catch((error: unknown) => {
      canvas.dataset.error = error instanceof Error ? error.message : String(error);
    });
    return canvas;
  }

  private beginDrag(event: PointerEvent, sourceIndex: number): void {
    if (event.button !== 0 || this.drag) return;
    const item = this.slotStates[sourceIndex].get().item;
    if (!item) return;

    const button = event.currentTarget as HTMLButtonElement;
    button.setPointerCapture(event.pointerId);
    this.drag = {
      active: false,
      button,
      item,
      pointerId: event.pointerId,
      sourceIndex,
      startX: event.clientX,
      startY: event.clientY,
    };
  }

  private moveDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 5) return;

    if (!drag.active) {
      drag.active = true;
      drag.button.classList.add('is-dragging');
    }
    event.preventDefault();

    const element = this.shadowRoot!.elementFromPoint(event.clientX, event.clientY);
    const target = element?.closest<HTMLButtonElement>('.inventory-slot');
    const targetIndex = target ? Number(target.dataset.slotIndex) : undefined;
    if (drag.targetIndex === targetIndex) return;

    if (drag.targetIndex !== undefined) {
      this.slotButtons[drag.targetIndex].classList.remove('is-drop-target');
    }
    drag.targetIndex = Number.isInteger(targetIndex) ? targetIndex : undefined;
    if (drag.targetIndex !== undefined && drag.targetIndex !== drag.sourceIndex) {
      this.slotButtons[drag.targetIndex].classList.add('is-drop-target');
    }
  }

  private endDrag(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasActive = drag.active;
    const targetIndex = drag.targetIndex;
    this.clearDrag();
    if (!wasActive) return;

    this.suppressNextClick = true;
    if (targetIndex === undefined || targetIndex === drag.sourceIndex) return;
    this.requestTransfer(drag.sourceIndex, targetIndex, drag.item);
  }

  private cancelDrag(event: PointerEvent): void {
    if (this.drag?.pointerId === event.pointerId) this.clearDrag();
  }

  private clearDrag(): void {
    if (!this.drag) return;
    this.drag.button.classList.remove('is-dragging');
    if (this.drag.targetIndex !== undefined) {
      this.slotButtons[this.drag.targetIndex].classList.remove('is-drop-target');
    }
    this.drag = undefined;
  }

  private requestTransfer(sourceIndex: number, targetIndex: number, item: InventoryBarItem): void {
    const from = slotRefs[sourceIndex];
    const to = slotRefs[targetIndex];
    if (sameSlot(from, to)) return;
    if (to.group === 'equipment' && item.equippable !== to.kind) return;

    const target = this.slotStates[targetIndex].get().item;
    if (target && target.id !== item.id) return;
    const amount = target
      ? Math.min(item.count, target.maxStack - target.count)
      : item.count;
    if (amount <= 0) return;

    const operationId = ++this.operationId;
    this.dispatchSlotChange('game:inventory-slot-decrease', {
      operationId,
      slot: from,
      itemId: item.id,
      amount,
    });
    this.dispatchSlotChange('game:inventory-slot-increase', {
      operationId,
      slot: to,
      itemId: item.id,
      amount,
    });
  }

  private dispatchSlotChange(type: string, detail: InventorySlotChangeDetail): void {
    this.dispatchEvent(new CustomEvent<InventorySlotChangeDetail>(type, {
      bubbles: true,
      composed: true,
      detail,
    }));
  }

  private refreshAssets(): void {
    this.shadowRoot!
      .querySelector<HTMLImageElement>('.inventory-bar__inspect img')!
      .src = this.asset('bag/self_inspect_wilson.tex.png');
    this.slotButtons.forEach((button, index) => {
      const background = button.querySelector<HTMLImageElement>('.inventory-slot__background')!;
      background.src = this.asset(`bag/${button.dataset.backgroundAsset}`);
      this.updateSlot(button, this.slotStates[index].get());
    });
  }

  private slotIndex(ref: InventorySlotRef): number {
    if (ref.group === 'inventory') {
      if (!Number.isInteger(ref.index) || ref.index < 0 || ref.index >= INVENTORY_SLOT_COUNT) {
        throw new RangeError(`Invalid inventory slot index: ${ref.index}`);
      }
      return ref.index;
    }
    const index = equipmentSlots.findIndex(({ kind }) => kind === ref.kind);
    if (index < 0) throw new RangeError(`Invalid equipment slot kind: ${ref.kind}`);
    return INVENTORY_SLOT_COUNT + index;
  }
}
