import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { createEffect } from '@dontstarve-web/signals';
import { ResidentSprite, ResidentSpriteController } from '../../prefab/src/residentSprite';
import { installMatrixGate } from '../src/matrixGate';
import { updateSceneMatrices, watchMatrixUpdates } from '../src/matrixUpdates';

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

it('releases the drawn sprite while unloaded and rebuilds it with the logical clip; owners dress it again from `art`', async () => {
  const created: ReturnType<typeof fake>[] = [];
  const make = (clip: { name: string; loop: boolean }) => { const entry = fake(clip); created.push(entry); return entry.sprite; };
  const resident = new ResidentSprite(make, { name: 'idle', loop: true }, make({ name: 'idle', loop: true }));
  resident.start('sway');
  const stop = createEffect(() => { resident.art.get(); resident.setBuildArchive('bloom'); });
  await new Promise(resolve => setTimeout(resolve, 0));
  resident.unload();
  expect(created[0].sprite.dispose).toHaveBeenCalledOnce();
  expect(resident.model.children).toHaveLength(1);
  resident.load();
  await new Promise(resolve => setTimeout(resolve, 0));
  stop();
  expect(created).toHaveLength(2);
  expect(created[1].calls).toEqual(expect.arrayContaining(['build:bloom', 'start:sway']));
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

it('skips empty visuals during rendering, updates explicit queries and refreshes a rebuilt visual', async () => {
  const scene = new THREE.Scene();
  const created: ReturnType<typeof fake>[] = [];
  const resident = new ResidentSprite(clip => {
    const entry = fake(clip); created.push(entry); return entry.sprite;
  }, { name: 'idle', loop: true });
  scene.add(resident.model);
  const placeholder = resident.model.children[0];
  const updates = vi.spyOn(resident.model, 'updateMatrix');
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    scene.updateMatrixWorld(); scene.updateMatrixWorld();
    expect(updates).not.toHaveBeenCalled();
    resident.model.position.x = 4;
    scene.updateMatrixWorld();
    expect(updates).not.toHaveBeenCalled();
    resident.model.updateWorldMatrix(true, true);
    expect(placeholder.matrixWorld.elements[12]).toBe(4);

    resident.load();
    await tick();
    const child = created[0].sprite.model.children[0];
    scene.updateMatrixWorld();
    child.position.x = 2;
    scene.updateMatrixWorld();
    expect(child.matrixWorld.elements[12]).toBe(6);
    resident.model.position.x = 8;
    created[0].sprite.model.position.y = 3;
    scene.updateMatrixWorld();
    expect(child.matrixWorld.elements[12]).toBe(10);

    resident.unload();
    await tick();
    updates.mockClear();
    scene.updateMatrixWorld(); scene.updateMatrixWorld();
    expect(updates).not.toHaveBeenCalled();
    resident.model.updateWorldMatrix(true, true);
    expect(placeholder.matrixWorld.elements[12]).toBe(8);
    expect(placeholder.matrixWorld.elements[13]).toBe(3);

    // FX attached to an otherwise empty resident still receive their transforms.
    const fx = new THREE.Group(); resident.model.add(fx);
    fx.position.x = 2;
    scene.updateMatrixWorld();
    expect(fx.matrixWorld.elements[12]).toBe(10);
    fx.removeFromParent();
    updates.mockClear(); scene.updateMatrixWorld();
    expect(updates).not.toHaveBeenCalled();

    resident.model.position.x = 11;
    resident.load();
    await tick(); scene.updateMatrixWorld();
    expect(created[1].sprite.model.matrixWorld.elements[12]).toBe(11);
  } finally {
    updates.mockRestore(); resident.dispose();
  }
});

it('leaves its parent while inactive, returns on activation and stays out when added late or disposed asleep', async () => {
  const scene = new THREE.Scene();
  const make = (clip: { name: string; loop: boolean }) => fake(clip).sprite;
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const resident = new ResidentSprite(make, { name: 'idle', loop: true }, make({ name: 'idle', loop: true }));
  scene.add(resident.model);
  resident.model.position.set(3, 0, 5);

  resident.setActive(false);
  expect(resident.model.parent).toBeNull();
  expect(scene.children).toHaveLength(0);
  expect(resident.model.position.toArray()).toEqual([3, 0, 5]);
  resident.setActive(false);
  resident.setActive(true);
  await tick();
  expect(resident.model.parent).toBe(scene);
  expect(resident.loaded).toBe(true);
  resident.setActive(true);
  expect(scene.children).toEqual([resident.model]);

  // An owner that finds the tile inactive before it adds the root must not put it back in the scene.
  resident.setActive(false);
  scene.add(resident.model);
  expect(resident.model.parent).toBeNull();
  resident.setActive(true);
  expect(resident.model.parent).toBe(scene);

  resident.setActive(false);
  resident.dispose();
  resident.setActive(true);
  expect(scene.children).toHaveLength(0);
});

it.each(['archive', 'factory'] as const)('caches a loaded %s resident root while preserving child updates, queries and visual replacement', async kind => {
  const scene = new THREE.Scene(), parent = new THREE.Group();
  scene.add(parent);
  const created: { sprite: ArchiveSprite; leaf: THREE.Object3D; gate: ReturnType<typeof installMatrixGate> }[] = [];
  const make = (clip: { name: string; loop: boolean }) => {
    const { sprite } = fake(clip), visual = sprite.model.children[0], leaf = new THREE.Object3D();
    leaf.matrixAutoUpdate = false;
    visual.add(leaf);
    // The archive's stationary cache assumes static ancestors. Its resident
    // owner must invalidate it when the outer entity root actually moves.
    const gate = installMatrixGate(sprite.model, visual, true);
    sprite.dispose = () => { gate.dispose(); sprite.model.removeFromParent(); };
    sprite.model.userData.animationController = sprite;
    created.push({ sprite, leaf, gate });
    return sprite;
  };
  const first = make({ name: 'idle', loop: true });
  const resident = kind === 'archive'
    ? new ResidentSprite(make, { name: 'idle', loop: true }, first)
    : new ResidentSpriteController(new THREE.Group(), name => make({ name, loop: true }).model,
      model => { (model.userData.animationController as ArchiveSprite).dispose(); }, first.model, { name: 'idle' });
  parent.add(resident.model);
  const observer = vi.fn(), stop = watchMatrixUpdates(resident.model, observer);
  const updates = vi.spyOn(resident.model, 'updateMatrix');
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    await tick(); updateSceneMatrices(scene);
    observer.mockClear(); updates.mockClear();
    for (let i = 0; i < 3; i++) updateSceneMatrices(scene);
    expect(updates).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();

    resident.model.position.x = 4;
    updateSceneMatrices(scene);
    expect(created[0].leaf.matrixWorld.elements[12]).toBe(4);
    expect(observer).toHaveBeenCalledOnce();
    observer.mockClear();
    parent.position.x = 3;
    resident.model.updateWorldMatrix(true, true);
    expect(created[0].leaf.matrixWorld.elements[12]).toBe(7);
    expect(observer).toHaveBeenCalledOnce();

    // A dirty inner visual and an attached FX still run while the root is cached.
    const fx = new THREE.Group(); resident.model.add(fx);
    fx.position.x = 2;
    first.model.children[0].position.y = 5; created[0].gate.markDirty();
    updateSceneMatrices(scene);
    expect(created[0].leaf.matrixWorld.elements[13]).toBe(5);
    expect(fx.matrixWorld.elements[12]).toBe(9);
    fx.position.x = 6; updateSceneMatrices(scene);
    expect(fx.matrixWorld.elements[12]).toBe(13);
    fx.removeFromParent();

    // Shallow queries settle the root now and leave the child invalidation for render.
    resident.model.position.x = 8;
    resident.model.updateWorldMatrix(true, false);
    updateSceneMatrices(scene);
    expect(created[0].leaf.matrixWorld.elements[12]).toBe(11);
    resident.setActive(false); await tick();
    resident.setActive(true); await tick(); updateSceneMatrices(scene);
    expect(created[1].leaf.matrixWorld.elements[12]).toBe(11);
    observer.mockClear(); updates.mockClear();
    updateSceneMatrices(scene);
    expect(updates).not.toHaveBeenCalled();
    expect(observer).not.toHaveBeenCalled();
  } finally { updates.mockRestore(); stop(); resident.dispose(); }
});
