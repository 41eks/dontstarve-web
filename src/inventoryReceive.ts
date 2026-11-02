import type { InventoryReceiveListener } from '@dontstarve-web/inventory';
import type { GameUiElements, InventoryReceiveSource } from '@dontstarve-web/ui';

export function inventoryReceiveEffect(
  ui: Pick<GameUiElements, 'inventoryBar' | 'backpackPanel'>,
  source: InventoryReceiveSource | null,
): InventoryReceiveListener {
  return (received) => {
    if (!source) return;
    for (const { slot, delta } of received) {
      if (ui.inventoryBar.containers.some(container => container.id === slot.containerId)) {
        ui.inventoryBar.animateReceive(slot, source, delta);
      } else if (ui.backpackPanel.slotContainer?.id === slot.containerId) {
        ui.backpackPanel.animateReceive(slot, source, delta);
      }
    }
  };
}
