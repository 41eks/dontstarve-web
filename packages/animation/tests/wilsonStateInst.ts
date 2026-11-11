import { vi } from 'vitest';
import { Vector3 } from 'three';
import { AnimState } from '../src/animState';
import type { WilsonStateInst } from '../../stategraphs/src/SGwilson';

/** inst.AnimState for a test: the played clip's length comes from `length`, and the colour and rate are recorded. */
class RecordedAnimState extends AnimState {
  private readonly length: (name: string) => number;
  current = '';
  readonly SetMultColour = vi.fn((_r: number, _g: number, _b: number, _a?: number) => {});
  readonly SetDeltaTimeMultiplier = vi.fn((_multiplier: number) => {});
  constructor(length: (name: string) => number) { super(); this.length = length; }
  PlayAnimation(name: string, _loop?: boolean): void { this.current = name; }
  GetCurrentAnimationLength(): number { return this.length(this.current); }
}

/**
 * A player entity for a WilsonStateGraph without the player prefab: its sounds are recorded in `played`, `overrides`
 * supplies what a test's states reach (components, SpawnPrefab, the bound hosts, movement facts), and `animationLength`
 * is each clip's length in seconds, by animation name.
 */
export function wilsonStateInst<Overrides extends Partial<WilsonStateInst>>(overrides?: Overrides, animationLength: (name: string) => number = () => 1) {
  const played: string[] = [];
  let visible = true;
  const base = {
    played,
    SoundEmitter: { PlaySound: vi.fn((path: string) => { played.push(path); }), KillSound: vi.fn(), PlayingSound: vi.fn(() => false), SetVolume: vi.fn() },
    AnimState: new RecordedAnimState(animationLength),
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
