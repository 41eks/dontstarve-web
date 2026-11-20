import { DstChestPanelElement } from './chest-panel';
import type { SlotContainerKind } from './slot/slot-container';
import type { SlotAddress, SlotItem } from './slot/slot-model';

export interface ContainerButtonRequestDetail { containerId: string; }

/**
 * A container whose widget has a button (containers.lua widget.buttoninfo): the cook pot's 烹饪 and the dragonfly
 * furnace's 摧毁. The button's text and validfn come from the open container's definition.
 */
export class DstCookPotPanelElement extends DstChestPanelElement {
  protected override get containerKind(): SlotContainerKind { return 'cookpot'; }
  protected override get defaultPanelArchive(): string { return 'ui_cookpot_1x4.zip'; }
  protected override get defaultColumns(): number { return 1; }
  protected override get backgroundAsset(): string { return 'preparedfood_slot.tex'; }
  protected override get backgroundAtlas(): string { return 'images/hud2.xml'; }
  protected override get anchorPlacement(): 'beside' { return 'beside'; }
  protected override get panelModifierClass(): string { return 'cook-pot-panel'; }
  protected override get showCloseButton(): boolean { return true; }

  override setSlot(address: SlotAddress, item: SlotItem | null): void {
    super.setSlot(address, item);
    this.updateButton();
  }

  protected override buildPanel(panel: HTMLElement): void {
    const button = document.createElement('button');
    button.className = 'cook-pot-panel__cook';
    button.type = 'button';
    button.addEventListener('click', () => {
      const container = this.slotContainer;
      if (button.disabled || !container) { return; }
      this.dispatchEvent(new CustomEvent<ContainerButtonRequestDetail>('game:container-button', {
        bubbles: true, composed: true, detail: { containerId: container.id },
      }));
    });
    panel.append(button);
  }

  protected override render(): void {
    super.render();
    this.updateButton();
  }

  private updateButton(): void {
    const button = this.shadowRoot?.querySelector<HTMLButtonElement>('.cook-pot-panel__cook');
    if (!button) { return; }
    const info = this.buttonInfo;
    button.hidden = info === undefined;
    button.textContent = info?.text ?? '';
    if (info) { button.style.setProperty('--container-button-y', String(-info.y)); }
    const slots = this.slotContainer?.slots ?? [];
    // buttoninfo.validfn: the cooker's container:IsFull(), the furnace's not container:IsEmpty().
    button.disabled = !info || !slots.length || (info.validfn === 'full'
      ? !slots.every(slot => slot.item.peek() !== null) : !slots.some(slot => slot.item.peek() !== null));
  }
}
