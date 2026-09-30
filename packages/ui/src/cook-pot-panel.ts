import { DstChestPanelElement } from './chest-panel';
import type { SlotContainerKind } from './slot/slot-container';

export class DstCookPotPanelElement extends DstChestPanelElement {
  protected override get containerKind(): SlotContainerKind { return 'cookpot'; }
  protected override get backgroundAsset(): string { return 'preparedfood_slot.tex'; }
  protected override get backgroundAtlas(): string { return 'images/hud2.xml'; }
}
