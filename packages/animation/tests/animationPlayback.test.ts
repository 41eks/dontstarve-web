import { expect, it } from 'vitest';
import { GameTimeScheduler } from '../../signals/src/gameTimeScheduler';
import { AnimationPlayback, type PlaybackClip } from '../src/animationPlayback';

it('emits animover for every clip and loop, and animqueueover only when the finite queue ends without any visual', () => {
  const scheduler = new GameTimeScheduler();
  const selected: string[] = [], events: string[] = [];
  const lengths = { pre: .2, loop: .4, post: .1 };
  const playback = new AnimationPlayback((clip: PlaybackClip) => { selected.push(clip.name); return lengths[clip.name as keyof typeof lengths]; },
    (seconds, complete) => scheduler.schedule(seconds, complete));
  playback.on('animover', clip => events.push(`over:${clip.name}`));
  playback.on('animqueueover', clip => events.push(`queueover:${clip.name}`));
  playback.play([{ name: 'pre', loop: false }, { name: 'loop', loop: true }]);
  scheduler.advance(.7);
  expect(selected).toEqual(['pre', 'loop', 'loop']);
  expect(events).toEqual(['over:pre', 'over:loop']);
  playback.push([{ name: 'post', loop: false }]);
  scheduler.advance(.5);
  expect(events).toEqual(['over:pre', 'over:loop', 'over:loop', 'over:post', 'queueover:post']);
  expect(playback.done).toBe(true);
  playback.stop(); scheduler.dispose();
});

it('drops an obsolete queue when an animover handler replaces playback, and cancels completion on stop', () => {
  const scheduler = new GameTimeScheduler(), selected: string[] = [], events: string[] = [];
  const playback = new AnimationPlayback((clip: PlaybackClip) => { selected.push(clip.name); return .2; },
    (seconds, complete) => scheduler.schedule(seconds, complete));
  playback.on('animover', clip => {
    events.push(`over:${clip.name}`);
    if (clip.name === 'first') playback.play([{ name: 'replacement', loop: false }]);
  });
  playback.on('animqueueover', clip => events.push(`queueover:${clip.name}`));
  playback.play([{ name: 'first', loop: false }, { name: 'obsolete', loop: false }]);
  scheduler.advance(.4);
  expect(selected).toEqual(['first', 'replacement']);
  expect(events).toEqual(['over:first', 'over:replacement', 'queueover:replacement']);
  playback.play([{ name: 'cancelled', loop: false }]);
  playback.stop(); scheduler.advance(1);
  expect(events).toHaveLength(3);
  scheduler.dispose();
});
