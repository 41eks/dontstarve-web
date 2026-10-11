import type { ItemEntity } from '@dontstarve-web/inventory';
import { Shaver } from '../../componets/src/shaver';

export const RAZOR_ID = 'razor';

/** razor.lua: inventoryitem + shaver, tagged donotautopick; it is held on the cursor, never equipped. */
export function configureRazorEntity(entity: ItemEntity): void {
  entity.addTag('donotautopick');
  entity.components.shaver = entity.component('shaver', () => new Shaver());
}
