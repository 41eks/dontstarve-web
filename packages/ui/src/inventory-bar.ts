import { AssetElement } from './assets';
import styles from './styles/inventory-bar.css?inline';

const INVENTORY_SLOT_COUNT = 15;

const equipmentSlots = [
  { kind: 'hand', label: '手部装备', asset: 'equip_slot.tex.png' },
  { kind: 'body', label: '身体装备', asset: 'equip_slot_body.tex.png' },
  { kind: 'head', label: '头部装备', asset: 'equip_slot_head.tex.png' },
] as const;

export interface InventorySlotSelectDetail {
  group: 'inventory' | 'equipment';
  index: number;
  kind?: (typeof equipmentSlots)[number]['kind'];
}

export class DstInventoryBarElement extends AssetElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  protected render(): void {
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
      inventoryGroups[Math.floor(index / 5)].append(this.createSlot({
        group: 'inventory',
        index,
        label: `物品栏 ${index + 1}`,
        asset: 'ingredient_slot.tex.png',
      }));
    }

    const equipment = root.querySelector<HTMLElement>('.inventory-bar__equipment')!;
    equipmentSlots.forEach((slot, index) => {
      equipment.append(this.createSlot({
        group: 'equipment',
        index,
        kind: slot.kind,
        label: slot.label,
        asset: slot.asset,
      }));
    });

    root.querySelector<HTMLButtonElement>('.inventory-bar__inspect')!.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('game:self-inspect', {
        bubbles: true,
        composed: true,
      }));
    });
  }

  private createSlot(options: {
    group: InventorySlotSelectDetail['group'];
    index: number;
    kind?: InventorySlotSelectDetail['kind'];
    label: string;
    asset: string;
  }): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-slot';
    button.setAttribute('aria-label', options.label);
    button.innerHTML = `<img src="${this.asset(`bag/${options.asset}`)}" alt="" draggable="false" />`;
    button.addEventListener('click', () => {
      const detail: InventorySlotSelectDetail = {
        group: options.group,
        index: options.index,
        ...(options.kind ? { kind: options.kind } : {}),
      };
      this.dispatchEvent(new CustomEvent('game:inventory-slot-select', {
        bubbles: true,
        composed: true,
        detail,
      }));
    });
    return button;
  }
}
