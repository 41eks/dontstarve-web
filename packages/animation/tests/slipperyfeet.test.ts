import { played, wilsonPlayer } from './wilsonPlayer';
import { expect, it, vi } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SLIPPERY_CHECK_RADIUS, SLIPPERY_SLOWCHECK_FREQUENCY, SlipperyFeet } from '../../componets/src/slipperyfeet';
import { WORLD_SCALE } from '../src/units';
import { Vector3 } from 'three';
import { SlipperyFeetTarget } from '../../componets/src/slipperyfeettarget';

const FRAME = 1 / 30;

function setup(options: { speed?: number; pond?: boolean } = {}) {
  const scheduler = new GameTimeScheduler();
  const log = { resets: 0 };
  // The player inst the slip states read: its run speed, motor velocity, wish to move forward and slipperyfeet.
  const tags = new Set<string>();
  const ice = { components: {} as { slipperyfeettarget?: SlipperyFeetTarget } };
  if (options.pond !== false) {
    ice.components.slipperyfeettarget = new SlipperyFeetTarget({
      addTag: tag => tags.add(tag),
      removeTag: tag => tags.delete(tag),
      getPosition: () => ({ x: 1, z: 0 }),
      getPhysicsRadius: () => 3,
    });
    ice.components.slipperyfeettarget.SetSlipperyRate((_, target) =>
      (target as { getMotorSpeed(): number }).getMotorSpeed() > 6 ? 50 : 5,
    );
  }
  // The player inst the slip states read: its run speed, motor speed, wish to move forward and slipperyfeet.
  let feet!: SlipperyFeet;
  const inst = wilsonPlayer(
    () => 14 * FRAME,
    inst => {
      inst.runSpeed = 6;
      inst.currentMotorSpeed = options.speed ?? 5.33;
      // AddComponent("slipperyfeet") on the player, finding the ice around it.
      inst.slipperyfeet = feet = new SlipperyFeet(inst, {
        scheduler,
        random: () => 1,
        findSlipperyEntities: () => (options.pond === false ? [] : [ice]),
      });
      const reset = feet.SetCurrent.bind(feet);
      // SGwilson's slip states reset the slippiness the feet have accumulated.
      vi.spyOn(feet, 'SetCurrent').mockImplementation((value: number) => {
        if (value === 0 && feet.slippiness > 0) {
          log.resets++;
        }
        reset(value);
      });
    },
  );
  const graph = inst.sg;
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      scheduler.advance(FRAME);
      feet.update(FRAME);
      graph.update(FRAME);
    }
  };
  // The player's own position, which a test moves off the pond.
  return { graph, feet, log, inst, step, tags, ice, position: inst.getPosition() };
}

it('slides a running player over a slipperyfeettarget, then falls on held input after the checkfall frame', () => {
  const { graph, feet, log, inst, step, tags } = setup();
  expect(tags.has('slipperyfeettarget')).toBe(true);
  graph.requestMovement('run');
  expect(graph.stateName).toBe('run');
  step(29);
  expect(feet.IsSlippery()).toBe(false); // the 1 s slow check has not discovered the ice yet
  step(2);
  expect(feet.IsSlippery()).toBe(true);
  expect(feet.isUpdating).toBe(true);
  for (let i = 0; i < 90 && graph.stateName === 'run'; i++) {
    step(1);
  }
  expect(graph.stateName).toBe('slip');
  expect(feet.slippiness).toBe(0);
  expect(log.resets).toBe(1);
  expect(inst.motorSpeed).toBeCloseTo(6 * 0.6);
  inst.wantsToMoveForward = true;
  graph.pushEvent('locomote');
  expect(graph.stateName).toBe('slip'); // too early to fall
  step(18);
  graph.pushEvent('locomote');
  expect(graph.stateName).toBe('slip_fall');
  expect(inst.motorSpeed).toBeCloseTo(6 * 0.25 * 0.8);
  step(10);
  expect(played(inst)).toContain('dontstarve/movement/slip_fall_thud');
  step(5);
  expect(graph.stateName).toBe('slip_fall_loop');
  graph.pushEvent('locomote');
  expect(graph.stateName).toBe('slip_fall_pst');
  step(14);
  expect(graph.stateName).toBe('run'); // the pushed idle resumes movement once the clip ends
  expect(inst.motorSpeed).toBeUndefined();
});

it('does not accumulate while standing, slips more slowly when walking off the ice, and lets the slide finish by itself', () => {
  const standing = setup();
  standing.step(120);
  expect(standing.graph.stateName).toBe('idle');
  expect(standing.feet.slippiness).toBe(0);

  const { graph, feet, step, position } = setup();
  graph.requestMovement('run');
  step(31);
  position.x = 100; // left the pond: the fast checker drops the source and slowly stops accumulating
  step(1);
  expect(feet.IsSlippery()).toBe(false);
  step(120);
  expect(graph.stateName).toBe('run');
  expect(feet.slippiness).toBe(0);

  const slide = setup();
  slide.graph.requestMovement('run');
  slide.step(31);
  for (let i = 0; i < 90 && slide.graph.stateName === 'run'; i++) {
    slide.step(1);
  }
  slide.step(28); // slip_pre + slip_loop
  expect(slide.graph.stateName).toBe('slip_pst');
  expect(slide.inst.motorSpeed).toBeCloseTo(6 * 0.15);
  slide.step(14);
  expect(slide.graph.stateName).toBe('run');
});

it('removes the tag and stops listening when the component is removed or disposed', () => {
  const { feet, ice, tags, step } = setup();
  ice.components.slipperyfeettarget!.OnRemoveFromEntity();
  expect(tags.has('slipperyfeettarget')).toBe(false);
  feet.dispose();
  step(60);
  expect(feet.isUpdating).toBe(false);
});

it('searches SLIPPERY_CHECK_RADIUS DST units around the player, converted to world units', () => {
  const scheduler = new GameTimeScheduler();
  const radii: number[] = [];
  const feet = new SlipperyFeet(
    {
      getPosition: () => new Vector3(),
      getMotorSpeed: () => 0,
      PushEvent: () => {},
      sg: { hasStateTag: () => false, hasAnyStateTag: () => false, onNewState: () => () => {} },
    },
    { scheduler, findSlipperyEntities: (_, radius) => (radii.push(radius), []) },
  );
  scheduler.advance(SLIPPERY_SLOWCHECK_FREQUENCY);
  expect(radii).toEqual([SLIPPERY_CHECK_RADIUS * WORLD_SCALE]);
  feet.dispose();
});
