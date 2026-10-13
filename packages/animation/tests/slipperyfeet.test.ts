import { Vector3 } from 'three';
import { expect, it } from 'vitest';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { SlipperyFeet } from '../../componets/src/slipperyfeet';
import { SlipperyFeetTarget } from '../../componets/src/slipperyfeettarget';
import { WilsonStateGraph } from '../../stategraphs/src/SGwilson';

const FRAME = 1 / 30;

function setup(options: { speed?: number; pond?: boolean } = {}) {
  const scheduler = new GameTimeScheduler();
  const log = { motor: [] as (number | undefined)[], sounds: [] as string[], resets: 0, wants: false };
  const graph = new WilsonStateGraph({
    playAnimation: () => 14 * FRAME, playSound() {}, setCasting() {}, onStateChanged() {}, stopMovement() {},
    slip: {
      runSpeed: () => 6, setMotorSpeed: speed => log.motor.push(speed), resetSlipperiness: () => { log.resets++; feet.SetCurrent(0); },
      wantsToMoveForward: () => log.wants, playSound: event => log.sounds.push(event),
    },
  });
  const position = new Vector3();
  const tags = new Set<string>();
  const ice = { components: {} as { slipperyfeettarget?: SlipperyFeetTarget } };
  if (options.pond !== false) {
    ice.components.slipperyfeettarget = new SlipperyFeetTarget({
      addTag: tag => tags.add(tag), removeTag: tag => tags.delete(tag),
      getPosition: () => ({ x: 1, z: 0 }), getPhysicsRadius: () => 3,
    });
    ice.components.slipperyfeettarget.SetSlipperyRate((_, target) => (target as { getMotorSpeed(): number }).getMotorSpeed() > 6 ? 50 : 5);
  }
  const feet = new SlipperyFeet({
    getPosition: () => position, getMotorSpeed: () => options.speed ?? 5.33,
    PushEvent: (name, data) => graph.pushEvent(name, data), sg: graph,
  }, { scheduler, random: () => 1, findSlipperyEntities: () => options.pond === false ? [] : [ice] });
  const step = (frames: number) => {
    for (let i = 0; i < frames; i++) { scheduler.advance(FRAME); feet.update(FRAME); graph.update(FRAME); }
  };
  return { graph, feet, log, step, tags, ice, position };
}

it('slides a running player over a slipperyfeettarget, then falls on held input after the checkfall frame', () => {
  const { graph, feet, log, step, tags } = setup();
  expect(tags.has('slipperyfeettarget')).toBe(true);
  graph.requestMovement('run');
  expect(graph.stateName).toBe('run');
  step(29);
  expect(feet.IsSlippery()).toBe(false); // the 1 s slow check has not discovered the ice yet
  step(2);
  expect(feet.IsSlippery()).toBe(true);
  expect(feet.isUpdating).toBe(true);
  for (let i = 0; i < 90 && graph.stateName === 'run'; i++) step(1);
  expect(graph.stateName).toBe('slip');
  expect(feet.slippiness).toBe(0);
  expect(log.resets).toBe(1);
  expect(log.motor).toEqual([6 * 0.6]);
  log.wants = true;
  graph.pushEvent('locomote');
  expect(graph.stateName).toBe('slip'); // too early to fall
  step(18);
  graph.pushEvent('locomote');
  expect(graph.stateName).toBe('slip_fall');
  expect(log.motor.at(-1)).toBeCloseTo(6 * 0.25 * 0.8);
  step(10);
  expect(log.sounds).toContain('slip_fall_thud');
  step(5);
  expect(graph.stateName).toBe('slip_fall_loop');
  graph.pushEvent('locomote');
  expect(graph.stateName).toBe('slip_fall_pst');
  step(14);
  expect(graph.stateName).toBe('run'); // the pushed idle resumes movement once the clip ends
  expect(log.motor.at(-1)).toBeUndefined();
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
  for (let i = 0; i < 90 && slide.graph.stateName === 'run'; i++) slide.step(1);
  slide.step(28); // slip_pre + slip_loop
  expect(slide.graph.stateName).toBe('slip_pst');
  expect(slide.log.motor.at(-1)).toBeCloseTo(6 * 0.15);
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
