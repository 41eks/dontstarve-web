import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { ResidentSprite } from '../../prefab/src/residentSprite';

function fake(clip: { name: string; loop: boolean }) {
  const model = new THREE.Group();
  model.add(new THREE.Group());
  const calls: string[] = [];
  let complete: (() => void) | undefined;
  const sprite = {
    model, frameCount: 10, currentAnimation: clip.name, dispose: vi.fn(() => model.removeFromParent()), update: vi.fn(),
    start: (name: string) => calls.push(`start:${name}`),
    playOnce: (name: string, done?: () => void) => { calls.push(`once:${name}`); complete = done; },
    setFrame: (frame: number) => calls.push(`frame:${frame}`), setPaused: vi.fn(), setFacing: (f: number) => calls.push(`facing:${f}`),
    setAnimation: vi.fn(), setOpacity: vi.fn(), setColour: vi.fn(), setBuildArchive: (a: string) => calls.push(`build:${a}`),
    setSymbolOverride: vi.fn(), setSymbolHidden: vi.fn(), faceCamera: vi.fn(), refreshTransform: vi.fn(),
  } as unknown as ArchiveSprite;
  return { sprite, calls, finish: () => complete?.() };
}

it('releases the drawn sprite while unloaded and rebuilds it with the logical clip and appearance', () => {
  const created: ReturnType<typeof fake>[] = [];
  const make = (clip: { name: string; loop: boolean }) => { const entry = fake(clip); created.push(entry); return entry.sprite; };
  const resident = new ResidentSprite(make, { name: 'idle', loop: true }, make({ name: 'idle', loop: true }));
  resident.setFacing(2); resident.setBuildArchive('bloom'); resident.start('sway');
  resident.unload();
  expect(created[0].sprite.dispose).toHaveBeenCalledOnce();
  expect(resident.model.children).toHaveLength(1);
  resident.load();
  expect(created).toHaveLength(2);
  expect(created[1].calls).toEqual(expect.arrayContaining(['facing:2', 'build:bloom', 'start:sway']));
  expect(resident.model.children[0]).toBe(created[1].sprite.model);
});

it('settles a transition requested or interrupted while unloaded instead of replaying it', () => {
  const created: ReturnType<typeof fake>[] = [];
  const make = (clip: { name: string; loop: boolean }) => { const entry = fake(clip); created.push(entry); return entry.sprite; };
  const resident = new ResidentSprite(make, { name: 'idle', loop: true }, make({ name: 'idle', loop: true }));
  resident.playOnce('grow', () => resident.start('idle'));
  resident.unload();
  resident.playOnce('shrink', () => resident.start('idle'));
  resident.load();
  expect(created[1].calls).toContain('start:idle');
  expect(created[1].calls.some(call => call.startsWith('once:'))).toBe(false);
  expect(resident.currentAnimation).toBe('idle');
});

it('keeps the last pose of a finished one-shot clip when reloaded', () => {
  const created: ReturnType<typeof fake>[] = [];
  const make = (clip: { name: string; loop: boolean }) => { const entry = fake(clip); created.push(entry); return entry.sprite; };
  const resident = new ResidentSprite(make, { name: 'off', loop: false }, make({ name: 'off', loop: false }));
  resident.playOnce('picked');
  created[0].finish();
  resident.unload(); resident.load();
  expect(created[1].calls).toEqual(expect.arrayContaining(['once:picked', 'frame:9']));
});
