import { makeAlive, makeGhost } from '../../prefab/src/player_common_extensions';
import type { PlayerAction } from '../../stategraphs/src/actionfns';
import { PrefabInstance } from '../../prefab/src/prefabInstance';
import { SpriteState } from '../../display/src';
import { playDrop, startMovement } from '../../prefab/src/player_common';
import { createPlayerEquipper } from './playerEquipFixture';
import { advancePlayer, facePlayer } from './playerVisual';
import { prefabDisplay } from '@dontstarve-web/display';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { playerInst, createPlayer } from './playerVisual';
import { DisposeSounds } from '../../prefab/src/sound';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import { testItem } from './testInventory';

beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const relative = String(url).slice(String(url).indexOf('dst/data/') + 9);
      return new Response(await readFile(new URL(`../../../public/dst/data/${relative}`, import.meta.url)));
    }),
  );
});
afterEach(() => {
  DisposeSounds();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads the Wortox build with shared player animations and renders every facing with equipment', async () => {
  const player = await createPlayer('/dst/data/anim');
  const animation = playerInst(player);
  const animationEquipper = createPlayerEquipper(animation);
  expect(player.name).toBe('wortox');
  expect(playerInst(player).prefab).toBe('wortox');
  expect(playerInst(player).minimap.peek().icon).toBe('wortox.png');
  expect(playerInst(player).sg).toBe(animation.sg);
  const urls = vi.mocked(fetch).mock.calls.map(([url]) => String(url));
  expect(urls).toContain('/dst/data/anim/dynamic/wortox.zip');
  expect(urls).toContain('/dst/data/anim/dynamic/wortox.dyn');
  expect(urls).not.toContain('/dst/data/anim/wilson.zip');
  animationEquipper.equip('strawhat', undefined, 'head');
  animationEquipper.equip('torch');
  const mesh = player.getObjectByProperty('isMesh', true) as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshBasicMaterial[]
  >;
  // The player's display loads the hat and torch builds the prefabs name.
  await vi.waitFor(() => expect(mesh.material.some(material => material.name === 'ground:hat_straw')).toBe(true));
  const visual = mesh.parent!;
  for (const facing of ['up', 'down', 'side'] as const) {
    for (const mirrored of [false, true]) {
      facePlayer(animation, facing, mirrored);
      startMovement(animation, 'walk');
      advancePlayer(animation, 1 / 30);
      expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
      expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
      expect(mesh.material.some(material => material.name === 'ground:hat_straw')).toBe(true);
      expect(mesh.material.every(material => material.forceSinglePass)).toBe(true);
      expect(visual.children).toHaveLength(1);
    }
  }
  await animationEquipper.equip(null, undefined, 'head');
  await animationEquipper.equip(null);
  startMovement(animation, 'idle');
  const livingTexture = mesh.material[0].map;
  expect((livingTexture as THREE.DataTexture).image.width).toBeGreaterThan(0);
  makeGhost(animation, true);
  advancePlayer(animation, 1 / 30);
  expect(animation.sg.isGhost).toBe(true);
  await prefabDisplay(player)!.artLoaded();
  expect(fetch).toHaveBeenCalledWith('/dst/data/anim/dynamic/ghost_wortox_build.zip');
  expect(fetch).toHaveBeenCalledWith('/dst/data/anim/dynamic/ghost_wortox_build.dyn');
  expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  expect(mesh.material[0].map).not.toBe(livingTexture);
  expect((mesh.material[0].map as THREE.DataTexture).image.width).toBeGreaterThan(0);
  makeAlive(animation);
  for (let frame = 0; frame < 120; frame++) {
    advancePlayer(animation, 1 / 30);
  }
  expect(animation.sg.isGhost).toBe(false);
  expect(mesh.geometry.drawRange.count).toBeGreaterThan(0);
  expect(mesh.material[0].map).toBe(livingTexture);
});

it('keeps the source mining timeline when Wortox changes facing and emits one action notification', async () => {
  const player = await createPlayer('/dst/data/anim');
  const animation = playerInst(player);
  const animationEquipper = createPlayerEquipper(animation);
  await animationEquipper.equip('pickaxe');
  const hit = vi.fn(),
    events: string[] = [];
  animation.sg.listenForEvent('performaction', data => {
    events.push((data as { action: { action: string } }).action.action);
  });
  expect(animation.sg.pushBufferedAction(new BufferedAction('MINE', hit))).toBe(true);
  for (let frame = 1; frame <= 15; frame++) {
    if (frame === 5) {
      facePlayer(animation, 'up');
    }
    if (frame === 12) {
      facePlayer(animation, 'side', true);
    }
    advancePlayer(animation, 1 / 30);
  }
  expect(hit).not.toHaveBeenCalled();
  expect(animation.sg.stateName).toBe('mine');
  advancePlayer(animation, 1 / 30);
  expect(hit).toHaveBeenCalledOnce();
  expect(events).toEqual(['MINE']);
  for (let frame = 0; frame < 60; frame++) {
    advancePlayer(animation, 1 / 30);
  }
  expect(hit).toHaveBeenCalledOnce();
  expect(animation.sg.stateName).toBe('idle');
});

it('keeps a buffered action when the same action, target and invobject is pushed again, as PushBufferedAction does', async () => {
  const animation = playerInst(await createPlayer('/dst/data/anim'));
  const rod = testItem({ itemId: 'fishingrod', count: 1 });
  rod.addTag('fishingrod');
  const pondEntity = () => new PrefabInstance('pond', new SpriteState({ name: 'idle', billboard: true }));
  const pond = pondEntity();
  const fish = (fn: () => void, target = pond): PlayerAction<'FISH'> =>
    new BufferedAction('FISH', fn, undefined, { invobject: rod, target });
  const failed: unknown[] = [];
  animation.sg.listenForEvent('actionfailed', data => failed.push((data as { action: unknown }).action));
  const cast = vi.fn(),
    repeat = vi.fn(),
    other = vi.fn();
  const first = fish(cast);
  expect(animation.sg.pushBufferedAction(first)).toBe(true);
  for (let frame = 0; frame < 5; frame++) {
    advancePlayer(animation, 1 / 30);
  }
  // fishing_pre is not busy: the duplicate is dropped and the first cast keeps its timeline.
  expect(animation.sg.pushBufferedAction(fish(repeat))).toBe(false);
  for (let frame = 0; frame < 11 && !cast.mock.calls.length; frame++) {
    advancePlayer(animation, 1 / 30);
  }
  expect(cast).toHaveBeenCalledOnce();
  expect(repeat).not.toHaveBeenCalled();
  // Another target replaces the buffered action; the replaced one fails.
  const second = fish(vi.fn());
  expect(animation.sg.pushBufferedAction(second)).toBe(true);
  expect(animation.sg.pushBufferedAction(fish(other, pondEntity()))).toBe(true);
  expect(failed).toEqual([second]);
});

it('performs a drop on the doshortaction frame and reports a cancelled drop', async () => {
  const animation = playerInst(await createPlayer('/dst/data/anim'));
  const drop = vi.fn(() => true),
    cancelled = vi.fn();
  expect(playDrop(animation, drop, cancelled)).toBe(true);
  expect(animation.sg.stateName).toBe('doshortaction');
  for (let frame = 0; frame < 5; frame++) {
    advancePlayer(animation, 1 / 30);
  }
  expect(drop).not.toHaveBeenCalled();
  for (let frame = 0; frame < 3; frame++) {
    advancePlayer(animation, 1 / 30);
  }
  expect(drop).toHaveBeenCalledOnce();
  expect(cancelled).not.toHaveBeenCalled();
  for (let frame = 0; frame < 30; frame++) {
    advancePlayer(animation, 1 / 30);
  }

  const never = vi.fn(() => true);
  expect(playDrop(animation, never, cancelled)).toBe(true);
  animation.sg.cancelAction('DROP');
  expect(cancelled).toHaveBeenCalledOnce();
  for (let frame = 0; frame < 30; frame++) {
    advancePlayer(animation, 1 / 30);
  }
  expect(never).not.toHaveBeenCalled();
});

it('advances rendered frames in animation without reading the stategraph clock or publishing frame state', async () => {
  const player = await createPlayer('/dst/data/anim');
  const instance = playerInst(player),
    animation = instance;
  const display = prefabDisplay(player)!;
  try {
    startMovement(animation, 'walk');
    await display.artLoaded();
    display.update(0);
    const mesh = player.getObjectByProperty('isMesh', true) as THREE.Mesh;
    const before = Array.from(mesh.geometry.getAttribute('position').array);
    const json = instance.sprite.sprite.peek();
    const readClock = vi.spyOn(animation.sg, 'animationTime', 'get');
    const publish = vi.fn();
    const stop = instance.sprite.sprite.subscribe(publish);
    for (let frame = 0; frame < 4; frame++) {
      display.update(0.1);
    }
    expect(readClock).not.toHaveBeenCalled();
    readClock.mockRestore();
    expect(animation.sg.animationTime).toBe(0);
    expect(Array.from(mesh.geometry.getAttribute('position').array)).not.toEqual(before);
    expect(instance.sprite.sprite.peek()).toBe(json);
    expect(publish).not.toHaveBeenCalled();
    stop();
  } finally {
    instance.remove();
    display.dispose();
  }
});
