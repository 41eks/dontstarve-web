import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createSignal } from '@dontstarve-web/signals';
import { SpriteState, type ArchiveSpriteSource } from '@dontstarve-web/display';
import { FxAttachments } from '../src/fxAttachments';
import type { SharedArchiveFrames } from '../../animation/src/archiveSprite';
import type { ResolvedSprite } from '../../animation/src/animationAssets';

/** Shared frames whose every frame is its own marker part, so the drawn clip and frame can be read back. */
function markedFrames(clips: Record<string, number>) {
  const parts = new Map<string, readonly ResolvedSprite[]>();
  const frames: SharedArchiveFrames = {
    clip: name => (clips[name] ? { frameRate: 10, frameCount: clips[name] } : undefined),
    frame: (name, index) => {
      const key = `${name}:${index}`;
      if (!parts.has(key)) {
        parts.set(key, [{ key } as unknown as ResolvedSprite]);
      }
      return parts.get(key)!;
    },
    retainAtRoot: () => {
      throw new Error('A composited follower is merged, not batched');
    },
  };
  const source = { frames: () => frames } as unknown as ArchiveSpriteSource;
  const drawn = (fx: FxAttachments) =>
    fx.compositeFrames().flatMap(frame => frame.sprites.map(part => (part as unknown as { key: string }).key));
  return { source, drawn };
}

it('plays a plain-clip follower queue as a display does: after the one-shot, and after the pass of a loop', () => {
  const { source, drawn } = markedFrames({ pre: 2, loop: 3, pst: 2 });
  const sprite = new SpriteState({ name: 'pre', none: true, plainClips: source });
  const fx = new FxAttachments(new THREE.Group());
  fx.apply(new Map([['fire', { sprite, active: createSignal(true), sortLayer: 2, composite: {} }]]));
  // AnimState:PlayAnimation(pre) + PushAnimation(loop, true): the loop follows the one-shot's last frame.
  let finished = 0;
  sprite.playOnce('pre', () => finished++);
  sprite.pushAnimation('loop', true);
  expect(drawn(fx)).toEqual(['pre:0']);
  fx.update(0.1);
  expect(drawn(fx)).toEqual(['pre:1']);
  fx.update(0.1);
  expect(finished).toBe(1);
  expect(drawn(fx)).toEqual(['loop:0']);
  fx.update(0.1);
  fx.update(0.1);
  fx.update(0.1);
  expect(drawn(fx)).toEqual(['loop:0']);
  // Pushed behind a loop, a clip waits for the pass the loop is drawing.
  fx.update(0.1);
  sprite.pushAnimation('pst');
  expect(drawn(fx)).toEqual(['loop:1']);
  fx.update(0.1);
  expect(drawn(fx)).toEqual(['loop:2']);
  fx.update(0.1);
  expect(drawn(fx)).toEqual(['pst:0']);
  fx.update(0.1);
  fx.update(0.1);
  expect(drawn(fx)).toEqual(['pst:1']);
  // A frame of its own is still refused.
  expect(() => sprite.setFrame(1)).toThrow(/plain-clip/);
  fx.dispose();
});
