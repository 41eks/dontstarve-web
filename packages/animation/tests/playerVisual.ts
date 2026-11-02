import { prefabDisplay } from '@dontstarve-web/display';
import { createWilsonPlayer as createPlayer, createWilsonPlayerPrefab as createPrefab } from '../../prefab/src/player';
import type { WilsonAnimationController, WilsonPlayerInstance } from '../../prefab/src/player';
import type { PlayerFacing } from '../src/facing';
import { PLAYER_FACING_VALUES } from '../src/facing';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import type { PrefabDisplay } from '../../display/src';
export * from '../../prefab/src/player';

/** Rendering tests explicitly wait for display art; the prefab itself is created synchronously. */
export async function createWilsonPlayer(...args: Parameters<typeof createPlayer>) {
  const model = createPlayer(...args);
  registerPlayer(model);
  await (prefabDisplay(model) as PrefabDisplay).artLoaded();
  return model;
}

export async function createWilsonPlayerPrefab(...args: Parameters<typeof createPrefab>) {
  const prefab = createPrefab(...args);
  registerPlayer(prefab.model);
  await prefab.display.artLoaded();
  return prefab;
}

const players = new WeakMap<WilsonAnimationController, { instance: WilsonPlayerInstance; display: PrefabDisplay }>();
export function registerPlayer(model: NonNullable<Parameters<typeof prefabInstance>[0]>): void {
  const instance = prefabInstance(model) as WilsonPlayerInstance;
  players.set(instance.animationController, { instance, display: prefabDisplay(model)! });
}
export function advancePlayer(animation: WilsonAnimationController, dt: number): void {
  animation.update(dt);
  players.get(animation)!.display.update(dt);
}
export function facePlayer(animation: WilsonAnimationController, facing: PlayerFacing, mirrored = false): void {
  players.get(animation)!.instance.sprite.setFacing(PLAYER_FACING_VALUES[facing], mirrored);
}
