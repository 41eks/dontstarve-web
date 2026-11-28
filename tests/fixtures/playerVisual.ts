import { prefabDisplay } from '@dontstarve-web/display';
import * as CANNON from 'cannon-es';
import {
  updatePlayer,
  playerInst,
  type PlayerInstance,
  type PlayerPrefabOptions,
} from '../../packages/prefab/src/player_common';
import { wortox } from '../../packages/prefab/src/wortox';
import type { PlayerFacing } from '../../packages/animation/src/facing';
import { PLAYER_FACING_VALUES } from '../../packages/animation/src/facing';
import { prefabInstance } from '../../packages/prefab/src/prefabInstance';
import type { PrefabDisplay } from '../../packages/display/src';
import { testEnts } from './entsFixture';
export * from '../../packages/prefab/src/player_common';

/** Rendering tests explicitly wait for display art; the prefab itself is created synchronously. */
export async function createPlayer(assetBaseUrl: string, options?: PlayerPrefabOptions) {
  const model = wortox(assetBaseUrl, new CANNON.World(), options).model;
  registerPlayer(model);
  await (prefabDisplay(model) as PrefabDisplay).artLoaded();
  return model;
}

export async function createPlayerPrefab(...args: Parameters<typeof wortox>) {
  const prefab = wortox(...args);
  registerPlayer(prefab.model);
  await prefab.display.artLoaded();
  return prefab;
}

const playerWorlds = new WeakMap<object, ReturnType<typeof testEnts>>();
/** The Ents a test player is tracked in, for the entities it should find around it. */
export function playerEnts(instance: object): ReturnType<typeof testEnts> {
  return playerWorlds.get(instance)!;
}
const displays = new WeakMap<PlayerInstance, PrefabDisplay>();
export function registerPlayer(model: NonNullable<Parameters<typeof prefabInstance>[0]>): void {
  const instance = playerInst(model);
  // The application tracks its player in the world's Ents; a test puts the entities around it in `playerEnts`.
  const ents = testEnts();
  ents.track(instance);
  playerWorlds.set(instance, ents);
  displays.set(instance, prefabDisplay(model)!);
}
export function advancePlayer(player: PlayerInstance, dt: number): void {
  updatePlayer(player, dt);
  displays.get(player)!.update(dt);
}
export function facePlayer(player: PlayerInstance, facing: PlayerFacing, mirrored = false): void {
  player.sprite.setFacing(PLAYER_FACING_VALUES[facing], mirrored);
}
