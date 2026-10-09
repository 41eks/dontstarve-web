import { PlayerActionPicker, PointerRaycaster } from '@dontstarve-web/stategraphs';
import type { PlayerActionEvents } from '@dontstarve-web/stategraphs';
import { EventEmitter } from '@dontstarve-web/signals';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';

import { ground } from './building';
import { camera } from './camera';
import { player } from './player';
import { cursorUi, renderer, scene } from './universal';

/** The rendering-side singletons prefabs need to place themselves in the game. */
export const actionEvents = new EventEmitter<PlayerActionEvents>();
export const view: WorldContext = {
  scene, camera, renderer, ground, player, actionEvents,
  createCursorLabel: (pointer) => cursorUi.createLabel(pointer),
};

view.mouseActions = new PlayerActionPicker(new PointerRaycaster(view), () => player.userData.controllerEnabled !== false);
cursorUi.setMouseActions(view.mouseActions);
