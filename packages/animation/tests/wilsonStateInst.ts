import { vi } from 'vitest';
import { Vector3 } from 'three';
import { AnimState } from '../src/animState';
import type { WilsonStateInst } from '../../stategraphs/src/SGwilson';

/** inst.AnimState with SetMultColour recorded, as InstanceAnimState writes it to the sprite. */
class RecordedAnimState extends AnimState {
  readonly SetMultColour = vi.fn((_r: number, _g: number, _b: number, _a?: number) => {});
}

/**
 * A player entity for a WilsonStateGraph without the player prefab: its sounds are recorded in `played`, and `overrides`
 * supplies what a test's states reach (components, SpawnPrefab, the bound hosts, movement facts).
 */
export function wilsonStateInst<Overrides extends Partial<WilsonStateInst>>(overrides?: Overrides) {
  const played: string[] = [];
  let visible = true;
  const base = {
    played,
    SoundEmitter: { PlaySound: vi.fn((path: string) => { played.push(path); }), KillSound: vi.fn(), PlayingSound: vi.fn(() => false), SetVolume: vi.fn() },
    AnimState: new RecordedAnimState(),
    position: new Vector3(),
    TheSim: { FindEntities: () => [] },
    components: {},
    PushEvent: vi.fn(),
    Hide() { visible = false; },
    Show() { visible = true; },
    IsVisible: () => visible,
    ShowHUD: vi.fn(),
    controllerEnabled: true,
    runSpeed: 0,
    motorSpeed: undefined as number | undefined,
    wantsToMoveForward: false,
  } satisfies WilsonStateInst & { played: string[] };
  return { ...base, ...overrides };
}
