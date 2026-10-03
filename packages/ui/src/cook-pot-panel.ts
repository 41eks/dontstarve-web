import { DstChestPanelElement } from './chest-panel';
import type { SlotContainerKind } from './slot/slot-container';

export class DstCookPotPanelElement extends DstChestPanelElement {
  protected override get containerKind(): SlotContainerKind { return 'cookpot'; }
  protected override get defaultPanelArchive(): string { return 'ui_cookpot_1x4.zip'; }
  protected override get defaultColumns(): number { return 1; }
  protected override get backgroundAsset(): string { return 'preparedfood_slot.tex'; }
  protected override get backgroundAtlas(): string { return 'images/hud2.xml'; }
}
