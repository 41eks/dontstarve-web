import { wortox } from '@dontstarve-web/prefab/wortox';
import { initialSave } from './save/initialSave';
import { world, worldState } from './physics';
import { turfMap, worldTopology } from './building';
import { FindVisualNodeAtPoint } from '@dontstarve-web/prefab/topology';

const playerPrefab = wortox(`${import.meta.env.BASE_URL}dst/data/anim`, world, {
  stats: { ...initialSave.players.local.stats },
  scheduler: worldState.scheduler,
  componentUpdates: worldState.componentUpdates,
  areaaware: {
    FindVisualNodeAtPoint: point => FindVisualNodeAtPoint(turfMap, worldTopology, point),
  },
});
await playerPrefab.display.artLoaded();
playerPrefab.instance.setPosition(...initialSave.players.local.transform.position);
playerPrefab.instance.tileTracker.sync();
playerPrefab.physics.Teleport();

export const player = playerPrefab.model;
export const playerInstance = playerPrefab.instance;
export const playerDisplay = playerPrefab.display;
/** inst.Physics of the player; the binding keeps `playerBody`. */
export const playerPhysics = playerPrefab.physics;
export const playerBody = playerPrefab.body;
/** The application ends the logical entity, then releases its display before the scene's shared resources. */
export function disposePlayer(): void {
  playerInstance.remove();
  playerDisplay.dispose();
}
