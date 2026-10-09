import { PlayerActionPicker, PointerRaycaster } from '@dontstarve-web/stategraphs';
import type { WorldContext } from '@dontstarve-web/prefab/worldContext';

import { ground } from './building';
import { camera } from './camera';
import { player } from './player';
import { cursorUi, renderer, scene } from './universal';

/** The rendering-side singletons prefabs need to place themselves in the game. */
export const view: WorldContext = {
  scene, camera, renderer, ground, player,
  createCursorLabel: (pointer) => cursorUi.createLabel(pointer),
};

view.mouseActions = new PlayerActionPicker(new PointerRaycaster(view));
cursorUi.setMouseActions(view.mouseActions);
window.addEventListener('pagehide', () => view.mouseActions?.dispose(), { once: true });
