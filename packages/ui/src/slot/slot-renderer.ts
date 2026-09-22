import { loadImageAtlas, type ImageAtlas } from '@three-roaming/animation/imageAtlas';
import { createEffect } from '../signal';
import { sameSlotAddress, type SlotAddress, type SlotItem, type SlotModel } from './slot-model';
import { slotTransferController, type SlotTransferRequest } from './slot-transfer';

const atlasRequests = new Map<string, Promise<ImageAtlas>>();

function requestAtlas(archiveUrl: string, atlasPath: string): Promise<ImageAtlas> {
  const key = `${archiveUrl}\n${atlasPath}`;
  let request = atlasRequests.get(key);
  if (!request) {
    request = loadImageAtlas(archiveUrl, atlasPath);
    atlasRequests.set(key, request);
  }
  return request;
}

export interface CreateSlotRendererOptions {
  slot: SlotModel;
  label: string;
  backgroundAsset: string;
  backgroundUrl(): string;
  archiveUrl(): string;
  selectedSlot?(): SlotAddress | null;
  onSelect?(slot: SlotModel): void;
  onContextMenu?(slot: SlotModel, event: MouseEvent): void;
  onTransfer?(request: SlotTransferRequest): void;
}

export interface SlotRenderer {
  readonly button: HTMLButtonElement;
  connect(): void;
  disconnect(): void;
  refresh(): void;
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

  let disposeEffect: (() => void) | undefined;
  let unregister: (() => void) | undefined;
  let suppressNextClick = false;

  const update = () => {
    const item = options.slot.getItem();
    const selected = sameSlotAddress(options.selectedSlot?.() ?? null, options.slot.address);
    const content = button.querySelector<HTMLElement>('.inventory-slot__content')!;
    const count = button.querySelector<HTMLElement>('.inventory-slot__count')!;
    button.classList.toggle('is-empty', item === null);
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-selected', String(selected));
    button.dataset.itemId = item?.id ?? '';
    button.setAttribute('aria-label', item
      ? `${item.name}，数量 ${item.count}`
      : options.label);
    count.textContent = item && item.count > 1 ? String(item.count) : '';

    if (!item) {
      content.dataset.iconKey = '';
      content.replaceChildren();
      return;
    }

    const archiveUrl = options.archiveUrl();
    const atlasPath = item.atlas ?? 'images/inventoryimages.xml';
    const iconKey = `${archiveUrl}\n${atlasPath}\n${item.icon}`;
    if (content.dataset.iconKey === iconKey) return;
    content.dataset.iconKey = iconKey;
    content.replaceChildren(createAtlasImage(archiveUrl, atlasPath, item));
  };

  button.addEventListener('click', () => {
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    options.onSelect?.(options.slot);
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
      disposeEffect?.();
      disposeEffect = undefined;
      unregister?.();
      unregister = undefined;
    },
    refresh() {
      button.querySelector<HTMLImageElement>('.inventory-slot__background')!.src = options.backgroundUrl();
      update();
    },
  };
}

function createAtlasImage(
  archiveUrl: string,
  atlasPath: string,
  item: SlotItem,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'inventory-slot__icon';
  canvas.width = 1;
  canvas.height = 1;
  canvas.dataset.archive = archiveUrl;
  canvas.dataset.atlas = atlasPath;
  canvas.dataset.element = item.icon;

  void requestAtlas(archiveUrl, atlasPath).then((atlas) => {
    if (!canvas.isConnected) return;
    const sprite = atlas.require(item.icon);
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
