import { DstChestPanelElement } from './chest-panel';

/** DST's side storage widget uses two columns and four rows. */
export class DstBackpackPanelElement extends DstChestPanelElement {
  protected get defaultPanelArchive(): string { return 'ui_backpack_2x4.zip'; }
  protected get defaultColumns(): number { return 2; }

  protected render(): void {
    super.render();
    this.shadowRoot!.querySelector('.chest-panel')!.classList.add('backpack-panel');
  }
}
