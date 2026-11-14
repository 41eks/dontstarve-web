import type { SlotAddress } from '@dontstarve-web/inventory';
import type { ChestCloseDetail } from './chest-panel';
import type { CookRequestDetail } from './cook-pot-panel';
import type { CraftingStateDetail, CraftRequestDetail } from './crafting-ui';
import type { DebugCommandDetail } from './debug-console';
import type { EmoteRequestDetail, EmoteWheelToggleDetail } from './emote-wheel';
import type { CameraTurnDirection } from './map-controls';
import type { MinimapActionRequestDetail, MinimapStateDetail } from './minimap';
import type { SlotSelectDetail } from './slot/slot-model';
import type { SlotTransferRequest } from './slot/slot-transfer';

/**
 * The game:* events the UI elements dispatch, by name. They bubble and are composed, so a listener on the element,
 * an ancestor or `window` receives them; addEventListener infers each detail from this map.
 */
export interface GameUiEventMap {
  'game:map-toggle': CustomEvent<{ isOpen: boolean }>;
  'game:pause-toggle': CustomEvent<{ isPaused: boolean }>;
  'game:camera-turn': CustomEvent<{ direction: CameraTurnDirection }>;
  'game:map-state': CustomEvent<MinimapStateDetail>;
  'game:map-action-request': CustomEvent<MinimapActionRequestDetail>;
  'game:chest-close': CustomEvent<ChestCloseDetail>;
  'game:cook-request': CustomEvent<CookRequestDetail>;
  'game:debug-console-toggle': CustomEvent<{ isOpen: boolean }>;
  'game:debug-command': CustomEvent<DebugCommandDetail>;
  'game:slot-transfer-request': CustomEvent<SlotTransferRequest>;
  'game:cursor-return-request': CustomEvent<{ origin?: SlotAddress }>;
  'game:slot-select': CustomEvent<SlotSelectDetail>;
  'game:craft-request': CustomEvent<CraftRequestDetail>;
  'game:crafting-state-change': CustomEvent<CraftingStateDetail>;
  'game:emote-wheel-toggle': CustomEvent<EmoteWheelToggleDetail>;
  'game:emote-request': CustomEvent<EmoteRequestDetail>;
}

declare global {
  interface HTMLElementEventMap extends GameUiEventMap {}
  interface WindowEventMap extends GameUiEventMap {}
}
