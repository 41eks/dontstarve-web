import { createWilsonPlayerPrefab } from '@dontstarve-web/prefab/player';
import { initialSave } from './save/initialSave';
import { world, worldState } from './physics';

const playerPrefab = createWilsonPlayerPrefab(
  `${import.meta.env.BASE_URL}dst/data/anim`,
  world,
  { stats: { ...initialSave.players.local.stats }, scheduler: worldState.scheduler, componentUpdates: worldState.componentUpdates },
);
await playerPrefab.display.artLoaded();
playerPrefab.model.position.set(...initialSave.players.local.transform.position);
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
