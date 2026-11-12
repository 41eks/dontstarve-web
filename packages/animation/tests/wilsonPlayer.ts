import { vi } from 'vitest';
import { SpriteState } from '@dontstarve-web/display';
import { PlayerInstance, ShowHUD } from '../../prefab/src/player_common';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';
import { testEnts } from './entsFixture';
import { bindInstance } from '../../prefab/src/prefabInstance';

const playedSounds = new WeakMap<PlayerInstance, string[]>();

/** The sound events the player's SoundEmitter was asked to play, in order. */
export function played(inst: PlayerInstance): string[] { return playedSounds.get(inst)!; }

/**
 * A player inst driven by its own SGwilson, without the character prefab's art: SetStateGraph binds the graph as
 * player_common does, in a test world of its own for TheSim. With no anim.bin loaded, `animationLength` gives each clip's
 * length in seconds by name, and the SoundEmitter records what it plays instead of playing it. `setup` sets what the
 * test's states reach (hosts, SpawnPrefab, movement facts, components) before the graph enters its first state.
 */
export function wilsonPlayer(animationLength: (name: string) => number = () => 1,
  setup?: (inst: PlayerInstance) => void): PlayerInstance {
  const inst = testEnts().track(new PlayerInstance('wilson', new SpriteState({ name: 'idle_loop', billboard: true })));
  // The model is the inst's, as createPrefabEntity binds it.
  bindInstance(inst.transform.model, inst);
  inst.addTag('player');
  inst.ShowHUD = show => ShowHUD(inst, show);
  const sounds: string[] = [];
  playedSounds.set(inst, sounds);
  vi.spyOn(inst.AddSoundEmitter(), 'PlaySound').mockImplementation(path => { sounds.push(path); });
  vi.spyOn(inst.SoundEmitter, 'KillSound');
  let current = '';
  const play = inst.AnimState.PlayAnimation.bind(inst.AnimState);
  vi.spyOn(inst.AnimState, 'PlayAnimation').mockImplementation((name, loop) => { current = name; play(name, loop); });
  vi.spyOn(inst.AnimState, 'GetCurrentAnimationLength').mockImplementation(() => animationLength(current));
  vi.spyOn(inst.AnimState, 'SetMultColour');
  vi.spyOn(inst.AnimState, 'SetDeltaTimeMultiplier');
  setup?.(inst);
  inst.SetStateGraph(inst => new WilsonStateGraph(inst));
  return inst;
}
