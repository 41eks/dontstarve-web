import { advancePlayer, facePlayer } from './playerVisual';
import { prefabDisplay } from '@dontstarve-web/display';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { wilsonPlayerInstance, createWilsonPlayer, type WilsonAnimationController } from './playerVisual';
import { DisposeSounds } from '../../prefab/src/sound';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = String(url).slice(String(url).indexOf('dst/data/') + 9);
    return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url)));
  }));
});
afterEach(() => { DisposeSounds(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('loads the Wortox build with shared player animations and renders every facing with equipment', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  expect(player.name).toBe('Wortox');
  expect(wilsonPlayerInstance(player).prefab).toBe('wortox');
  expect(wilsonPlayerInstance(player).minimap.peek().icon).toBe('wortox.png');
  expect(wilsonPlayerInstance(player).sg).toBe(animation.stategraph);
  const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  expect(urls).toContain('/dst/data/anim/dynamic/wortox.zip');
  expect(urls).toContain('/dst/data/anim/dynamic/wortox.dyn');
  expect(urls).not.toContain('/dst/data/anim/wilson.zip');
  animation.setHat('strawhat');
  animation.setCarryItem('torch');
  const mesh = player.getObjectByProperty('isMesh', true) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial[]>;
  // The player's display loads the hat and torch builds the prefabs name.
  await vi.waitFor(() => expect(mesh.material.some((material) => material.name === 'ground:hat_straw')).toBe(true));
  const visual = mesh.parent!;
  for (const facing of ['up', 'down', 'side'] as const) {
    for (const mirrored of [false, true]) {
      facePlayer(animation, facing, mirrored);
      animation.start('walk');
      advancePlayer(animation, 1 / 30);
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
      expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(mesh.material.some((material) => material.name === 'ground:hat_straw')).toBe(true);
      expect(mesh.material.every((material) => material.forceSinglePass)).toBe(true);
      expect(visual.children).toHaveLength(1);
    }
  }
  await animation.setHat(null);
  await animation.setCarryItem(null);
  animation.start('idle');
  const livingTexture = mesh.material[0].map;
  expect((livingTexture as THREE.DataTexture).image.width).toBeGreaterThan(0);
  animation.makeGhost(true);
  advancePlayer(animation, 1 / 30);
  expect(animation.isGhost).toBe(true);
  await prefabDisplay(player).artLoaded();
  expect(fetch).toHaveBeenCalledWith('/dst/data/anim/dynamic/ghost_wortox_build.zip');
  expect(fetch).toHaveBeenCalledWith('/dst/data/anim/dynamic/ghost_wortox_build.dyn');
  expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  expect(mesh.material[0].map).not.toBe(livingTexture);
  expect((mesh.material[0].map as THREE.DataTexture).image.width).toBeGreaterThan(0);
  animation.makeAlive();
  for (let frame = 0; frame < 120; frame++) advancePlayer(animation, 1 / 30);
  expect(animation.isGhost).toBe(false);
  expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  expect(mesh.material[0].map).toBe(livingTexture);
});

it('keeps the source mining timeline when Wortox changes facing and emits one action notification', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const animation = wilsonPlayerInstance(player).animationController as WilsonAnimationController;
  await animation.setCarryItem('pickaxe');
  const hit = vi.fn(), events: string[] = [];
  animation.stategraph.listenForEvent('performaction', (data) => {
    events.push((data as { action: { action: string } }).action.action);
  });
  expect(animation.stategraph.pushBufferedAction(new BufferedAction('MINE', hit))).toBe(true);
  for (let frame = 1; frame <= 15; frame++) {
    if (frame === 5) facePlayer(animation, 'up');
    if (frame === 12) facePlayer(animation, 'side', true);
    advancePlayer(animation, 1 / 30);
  }
  expect(hit).not.toHaveBeenCalled();
  expect(animation.stategraph.stateName).toBe('mine');
  advancePlayer(animation, 1 / 30);
  expect(hit).toHaveBeenCalledOnce();
  expect(events).toEqual(['MINE']);
  for (let frame = 0; frame < 60; frame++) advancePlayer(animation, 1 / 30);
  expect(hit).toHaveBeenCalledOnce();
  expect(animation.stategraph.stateName).toBe('idle');
});

it('keeps a buffered action when the same action, target and invobject is pushed again, as PushBufferedAction does', async () => {
  const animation = wilsonPlayerInstance(await createWilsonPlayer('/dst/data/anim')).animationController as WilsonAnimationController;
  const rod = { prefab: 'fishingrod', hasTag: (tag: string) => tag === 'fishingrod' };
  const pond = { prefab: 'pond', hasTag: () => false };
  const failed: unknown[] = [];
  animation.stategraph.listenForEvent('actionfailed', data => failed.push((data as { action: unknown }).action));
  const cast = vi.fn(), repeat = vi.fn(), other = vi.fn();
  const first = new BufferedAction('FISH', cast, undefined, { invobject: rod, target: pond });
  expect(animation.stategraph.pushBufferedAction(first)).toBe(true);
  for (let frame = 0; frame < 5; frame++) advancePlayer(animation, 1 / 30);
  // fishing_pre is not busy: the duplicate is dropped and the first cast keeps its timeline.
  expect(animation.stategraph.pushBufferedAction(new BufferedAction('FISH', repeat, undefined, { invobject: rod, target: pond }))).toBe(false);
  for (let frame = 0; frame < 11 && !cast.mock.calls.length; frame++) advancePlayer(animation, 1 / 30);
  expect(cast).toHaveBeenCalledOnce();
  expect(repeat).not.toHaveBeenCalled();
  // Another target replaces the buffered action; the replaced one fails.
  const second = new BufferedAction('FISH', vi.fn(), undefined, { invobject: rod, target: pond });
  expect(animation.stategraph.pushBufferedAction(second)).toBe(true);
  expect(animation.stategraph.pushBufferedAction(new BufferedAction('FISH', other, undefined, { invobject: rod, target: { ...pond } }))).toBe(true);
  expect(failed).toEqual([second]);
});

it('performs a drop on the doshortaction frame and reports a cancelled drop', async () => {
  const animation = wilsonPlayerInstance(await createWilsonPlayer('/dst/data/anim')).animationController as WilsonAnimationController;
  const drop = vi.fn(() => true), cancelled = vi.fn();
  expect(animation.playDrop(drop, cancelled)).toBe(true);
  expect(animation.stategraph.stateName).toBe('doshortaction');
  for (let frame = 0; frame < 5; frame++) advancePlayer(animation, 1 / 30);
  expect(drop).not.toHaveBeenCalled();
  for (let frame = 0; frame < 3; frame++) advancePlayer(animation, 1 / 30);
  expect(drop).toHaveBeenCalledOnce();
  expect(cancelled).not.toHaveBeenCalled();
  for (let frame = 0; frame < 30; frame++) advancePlayer(animation, 1 / 30);

  const never = vi.fn(() => true);
  expect(animation.playDrop(never, cancelled)).toBe(true);
  animation.stategraph.cancelAction('DROP');
  expect(cancelled).toHaveBeenCalledOnce();
  for (let frame = 0; frame < 30; frame++) advancePlayer(animation, 1 / 30);
  expect(never).not.toHaveBeenCalled();
});

it('advances rendered frames in animation without reading the stategraph clock or publishing frame state', async () => {
  const player = await createWilsonPlayer('/dst/data/anim');
  const instance = wilsonPlayerInstance(player), animation = instance.animationController;
  const display = prefabDisplay(player)!;
  try {
    animation.start('walk');
    await display.artLoaded(); display.update(0);
    const mesh = player.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const before = Array.from(mesh.geometry.getAttribute('position').array);
    const json = instance.sprite.sprite.peek();
    const readClock = vi.spyOn(animation.stategraph, 'animationTime', 'get');
    const publish = vi.fn();
    const stop = instance.sprite.sprite.subscribe(publish);
    for (let frame = 0; frame < 4; frame++) display.update(.1);
    expect(readClock).not.toHaveBeenCalled();
    readClock.mockRestore();
    expect(animation.stategraph.animationTime).toBe(0);
    expect(Array.from(mesh.geometry.getAttribute('position').array)).not.toEqual(before);
    expect(instance.sprite.sprite.peek()).toBe(json);
    expect(publish).not.toHaveBeenCalled();
    stop();
  } finally { instance.remove(); display.dispose(); }
});
