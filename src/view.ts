import type { WorldContext } from '@three-roaming/prefab/worldContext';

import { ground } from './building';
import { camera } from './camera';
import { player } from './player';
import { renderer, scene } from './universal';

/** The rendering-side singletons prefabs need to place themselves in the game. */
export const view: WorldContext = { scene, camera, renderer, ground, player };
