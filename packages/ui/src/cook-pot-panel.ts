import { DstChestPanelElement } from './chest-panel';
import type { SlotContainerKind } from './slot/slot-container';
import type { SlotAddress, SlotItem } from './slot/slot-model';

export interface CookRequestDetail { containerId: string; }

export class DstCookPotPanelElement extends DstChestPanelElement {
  protected override get containerKind(): SlotContainerKind { return 'cookpot'; }
  protected override get defaultPanelArchive(): string { return 'ui_cookpot_1x4.zip'; }
  protected override get defaultColumns(): number { return 1; }
  protected override get backgroundAsset(): string { return 'preparedfood_slot.tex'; }
  protected override get backgroundAtlas(): string { return 'images/hud2.xml'; }

  override setSlot(address: SlotAddress, item: SlotItem | null): void {
    super.setSlot(address, item);
    this.updateCookButton();
  }

  protected override render(): void {
    super.render();
    const container = this.slotContainer;
    if (!container) return;
    const button = document.createElement('button');
    button.className = 'cook-pot-panel__cook';
    button.type = 'button';
    button.textContent = '烹饪';
    button.addEventListener('click', () => {
      if (button.disabled || this.slotContainer !== container) return;
      this.dispatchEvent(new CustomEvent<CookRequestDetail>('game:cook-request', {
        bubbles: true, composed: true, detail: { containerId: container.id },
      }));
    });
    this.shadowRoot!.querySelector('.cook-pot-panel')!.append(button);
    this.updateCookButton();
  }

  private updateCookButton(): void {
    const button = this.shadowRoot?.querySelector<HTMLButtonElement>('.cook-pot-panel__cook');
    // containers.lua:buttoninfo.validfn checks IsFull(), independently of recipes.
    if (button) button.disabled = !this.slotContainer?.slots.length
      || !this.slotContainer.slots.every(slot => slot.item.peek() !== null);
  }
}
