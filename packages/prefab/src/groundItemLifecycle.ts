import type { ItemEntity } from '@dontstarve-web/inventory';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createMemo } from '@dontstarve-web/signals';
import type { GroundItemVisual, GroundPrefabContext } from './groundPrefab';
import { listenInventoryEvents } from './inventoryEvents';
import type { PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';

/** The ground lifecycle of an item entity drawn by its display, whichever sprite source the display draws with. */
export function bindResidentGroundItem(context: Pick<GroundPrefabContext, 'tickingarea'>, instance: PrefabInstance<ArchiveSpriteCommands>,
  display: PrefabDisplay, declare?: (entity: ItemEntity, sprite: ArchiveSpriteCommands) => void): GroundItemVisual {
  const model = display.model, sprite = instance.sprite;
  const active = createMemo(() => instance.status.get() === 'active');
  let stopTile = () => {};
  const bindTile = () => {
    stopTile();
    stopTile = watchTileActivity(model, context.tickingarea, awake => instance.setActive(awake));
  };
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: () => { sprite.setPaused(false); bindTile(); },
    onload: () => { sprite.setPaused(false); bindTile(); },
    onputininventory: () => { sprite.setPaused(true); stopTile(); stopTile = () => {}; },
  });
  return {
    model, instance,
    active,
    bindEntity: declare && (entity => declare(entity, sprite)),
    update: dt => sprite.update(dt),
    dispose() { removeInventoryEvents(); stopTile(); active.dispose(); instance.remove(); display.dispose(); },
  };
}
