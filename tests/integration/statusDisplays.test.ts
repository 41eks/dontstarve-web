import { expect, it } from 'vitest';
import { StatusDisplays, type StatusArt } from '../../packages/ui/src/badge/status-displays';
import type { UiAnimAsset } from '../../packages/ui/src/badge/ui-anim';
import type { BadgeOwner } from '../../packages/ui/src/badge/owner';
import { playerStatsFixture } from '../fixtures/playerStatsFixture';
import { createEffect } from '../../packages/signals/src';

/**
 * Art with the source clips' frame counts and no images: these tests read the badges' state, not their pixels. Each
 * frame places its own (missing) image, so frames stay distinct pictures.
 */
function art(name: string, clips: Record<string, number>): UiAnimAsset {
  return {
    buildPackage: { build: { name, atlasNames: [], symbols: new Map() }, atlases: [] },
    atlases: [],
    animations: new Map(
      Object.entries(clips).map(([clip, frames]) => [
        clip,
        {
          name: clip,
          facing: 0,
          bankHash: 0,
          frameRate: 30,
          frames: Array.from({ length: frames }, (_, index) => ({
            elements: [{ imageHash: index, imageIndex: 0, layerHash: 0, matrix: [1, 0, 0, 1, 0, 0], z: 0 }],
          })),
        },
      ]),
    ),
    tinted: new Map(),
  };
}

/** The HUD's owner as the player inst presents it: its tags, stat delta events and stat components. */
function hudOwner(player: ReturnType<typeof playerStatsFixture>): BadgeOwner {
  return {
    hasTag: tag => player.hasTag(tag),
    ListenForEvent: (event, fn) => player.ListenForEvent(event, (inst, data) => fn(inst, data)),
    components: player.stats,
  };
}

function statusArt(): StatusArt {
  const meter = art('status_meter', { bg: 1, anim: 100, frame: 23 });
  const pulse = art('hunger_health_pulse', { pulse: 24 });
  const arrow = art('sanity_arrow', { neutral: 4, arrow_loop_increase_most: 10, arrow_loop_decrease_most: 10 });
  // sanity_arrow's "neutral" is four identical empty frames.
  arrow.animations.get('neutral')!.frames = Array.from({ length: 4 }, () => ({ elements: [] }));
  return {
    hunger: { meter, pulse, icon: art('status_hunger', {}), arrow },
    health: { meter, pulse, icon: art('status_health', {}), arrow, buff: art('status_abigail', { buff_none: 2 }) },
    sanity: {
      meter,
      pulse,
      icon: art('status_sanity', { frame: 23, transition_sanity: 11, transition_lunacy: 11 }),
      arrow,
    },
  };
}

const PULSE_MS = (24 / 30) * 1000;

it('follows the stat delta events: numbers, pulse-delayed warnings and arrows', () => {
  const player = playerStatsFixture({ health: 100, hunger: 50, sanity: 150 });
  const status = new StatusDisplays(statusArt(), hudOwner(player));
  expect([status.heart.number, status.stomach.number, status.brain.number]).toEqual(['100', '50', '150']);

  // A hit below a third of max health pulses red, and the warning waits for the pulse to finish.
  player.stats.health.DoDelta(-60);
  expect(status.heart.number).toBe('40');
  status.advance(PULSE_MS - 50);
  expect(status.heart.warningVisible).toBe(false);
  status.advance(100);
  expect(status.heart.warningVisible).toBe(true);

  // Starving over time warns at once (no pulse) and turns the health arrow down.
  player.stats.hunger.DoDelta(-50, true);
  status.advance(1);
  expect(status.stomach.warningVisible).toBe(true);
  expect(status.heart.arrow).toBe('arrow_loop_decrease_most');

  // sanity.lua's rate scale drives the brain's arrow.
  player.stats.sanity.dapperness = 0.5;
  player.stats.sanity.OnUpdate(1);
  status.advance(1);
  expect(status.brain.arrow).toBe('arrow_loop_increase_most');
  status.dispose();
});

it('swaps the sanity badge to lunacy six frames after the mode change, and stops listening on dispose', () => {
  const player = playerStatsFixture({ sanity: 100 });
  const status = new StatusDisplays(statusArt(), hudOwner(player));
  player.stats.sanity.EnableLunacy(true, 'test');
  expect(status.brain.mode).toBe(0);
  status.advance(5 * (1000 / 30));
  expect(status.brain.mode).toBe(0);
  status.advance(2 * (1000 / 30));
  expect(status.brain.mode).toBe(1);

  status.dispose();
  player.stats.hunger.DoDelta(-30);
  expect(status.stomach.number).not.toBe(String(Math.ceil(player.stats.hunger.current)));
});

it('redraws a badge only when its picture changes, not on every clock tick', async () => {
  const player = playerStatsFixture({ health: 100, hunger: 50, sanity: 150 });
  const status = new StatusDisplays(statusArt(), hudOwner(player));
  // A context whose every method is a no-op: the stub art has no images to paint.
  const context = new Proxy({}, { get: () => () => {}, set: () => true }) as unknown as CanvasRenderingContext2D;
  let draws = 0;
  const stop = createEffect(() => {
    status.heart.draw(context);
    draws++;
  });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const frame = 1000 / 30;
  // circleframe2 plays its "frame" animation once and the bufficon its buff_none, then both hold.
  status.advance(1000);
  await settle();
  const idle = draws;

  // Idle: no pulse, no warning and the neutral arrow looping identical frames, so advancing draws nothing new.
  status.advance(10 * frame);
  await settle();
  expect(draws).toBe(idle);

  // A hit pulses red and redraws once per pulse frame, never within a frame.
  player.stats.health.DoDelta(-10);
  await settle();
  const hit = draws;
  expect(hit).toBe(idle + 1);
  status.advance(1);
  await settle();
  expect(draws).toBe(hit);
  status.advance(frame);
  await settle();
  expect(draws).toBe(hit + 1);
  // Once the pulse holds its last frame, the badge is still again.
  status.advance(PULSE_MS);
  await settle();
  const settled = draws;
  status.advance(PULSE_MS);
  await settle();
  expect(draws).toBe(settled);

  // Badge:OnGainFocus shows the number.
  status.heart.focused = true;
  await settle();
  expect(draws).toBe(settled + 1);
  stop();
  status.dispose();
});
