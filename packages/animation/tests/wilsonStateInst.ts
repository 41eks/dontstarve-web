import { vi } from 'vitest';
import { AnimState } from '../src/animState';
import type { WilsonStateInst } from '../../stategraphs/src/SGwilson';

/** A player entity for a WilsonStateGraph without the player prefab: its sounds are recorded in `played`. */
export function wilsonStateInst() {
  const played: string[] = [];
  return {
    played,
    SoundEmitter: { PlaySound: vi.fn((path: string) => { played.push(path); }), KillSound: vi.fn(), PlayingSound: vi.fn(() => false), SetVolume: vi.fn() },
    AnimState: new AnimState(),
    PushEvent: vi.fn(),
  } satisfies WilsonStateInst & { played: string[] };
}
