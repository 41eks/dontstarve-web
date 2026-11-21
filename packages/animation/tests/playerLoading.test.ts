import { makeAlive, makeGhost } from '../../prefab/src/player_common_extensions';
import { advancePlayer, registerPlayer } from './playerVisual';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import { wortox } from '../../prefab/src/wortox';
import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import { testItem } from './testInventory';

vi.mock('../../prefab/src/sound', () => ({
  PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true, setVolume() {} })),
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('creates the logical player and body synchronously and completes actions and FX timers before art loads', async () => {
  vi.stubGlobal('window', new EventTarget());
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  const fetch = vi.fn(async (url: string) => {
    await blocked;
    return new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)));
  });
  vi.stubGlobal('fetch', fetch);
  const world = new CANNON.World();
  const prefab = wortox('/dst/data/anim', world);
  const { instance, model, display, body } = prefab;
  registerPlayer(model);
  const animation = instance;
  const scene = new THREE.Scene();
  display.mount(scene);
  try {
    expect(prefab).not.toBeInstanceOf(Promise);
    expect(world.bodies).toContain(body);
    expect(model.getObjectByProperty('isMesh', true)).toBeUndefined();
    instance.sprite.setVisible(false);
    await tick();
    expect(model.visible).toBe(false);
    instance.sprite.setVisible(true);
    await tick();
    expect(model.visible).toBe(true);
    advancePlayer(animation, 1 / 30);
    // The idles and the book's clips are in different anim archives of the one declared bank: no art switch between them.
    const living = instance.sprite.sprite.peek().source;
    expect(living).toMatchObject({ bank: 'wilson', buildArchive: 'dynamic/wortox.zip' });
    const read = vi.fn(() => true);
    const book = testItem({ itemId: 'book_silviculture', count: 1 });
    book.def = { fx_under_prefab: 'fx_roots_under_book' };
    expect(animation.sg.pushBufferedAction(new BufferedAction('READ', read, undefined, { invobject: book }))).toBe(
      true,
    );
    for (let frame = 0; frame < 60 && animation.sg.stateName !== 'book2'; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(animation.sg.stateName).toBe('book2');
    expect(instance.sprite.sprite.peek().source).toBe(living);
    const fx = [...instance.sprite.fx.peek().values()];
    expect(fx).toHaveLength(2);
    instance.setActive(false);
    await tick();
    for (let frame = 0; frame < 240; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(read).toHaveBeenCalledOnce();
    expect(instance.sprite.fx.peek().size).toBe(0);
    for (const child of fx) {
      expect(child.display!.isRemoved).toBe(true);
    }
    makeGhost(animation, true);
    expect(animation.sg.isGhost).toBe(true);
    advancePlayer(animation, 1 / 30);
    expect(instance.sprite.sprite.peek().source).toMatchObject({
      bank: 'ghost',
      buildArchive: 'dynamic/ghost_wortox_build.zip',
    });
    makeAlive(animation);
    for (let frame = 0; frame < 120; frame++) {
      advancePlayer(animation, 1 / 30);
    }
    expect(animation.sg.isGhost).toBe(false);
    instance.setActive(true);
    await tick();
    const latest = instance.sprite.sprite.peek();
    expect(latest.source).toMatchObject({ bank: 'wilson', buildArchive: 'dynamic/wortox.zip' });
    release();
    await display.artLoaded();
    expect(instance.sprite.sprite.peek()).toBe(latest);
    expect(model.getObjectByProperty('isMesh', true)).toBeDefined();
    expect(instance.physicsBody).toBe(body);
    expect(fetch.mock.calls.some(([url]) => url.includes('dynamic/ghost_wortox_build'))).toBe(false);
  } finally {
    release();
    instance.remove();
    display.dispose();
  }
});

it('does not recreate a removed player or write its json when a pending source finishes', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => {
    release = resolve;
  });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    await blocked;
    return new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)));
  });
  const world = new CANNON.World(),
    { instance, display, model, body } = wortox('/dst/data/anim', world);
  instance.remove();
  await tick();
  const removed = instance.sprite.sprite.peek();
  release();
  await display.artLoaded();
  await tick();
  expect(instance.status.peek()).toBe('removed');
  expect(instance.sprite.sprite.peek()).toBe(removed);
  expect(world.bodies).not.toContain(body);
  expect(model.getObjectByProperty('isMesh', true)).toBeUndefined();
  expect(model.parent).toBeNull();
});

it('revives without replaying a ghost clip on the living bank when the ghost art failed to load', async () => {
  vi.stubGlobal('window', new EventTarget());
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('ghost_wortox_build')) {
      throw new TypeError('Failed to fetch');
    }
    return new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)));
  });
  const world = new CANNON.World();
  const { instance, model, display } = wortox('/dst/data/anim', world);
  registerPlayer(model);
  display.mount(new THREE.Scene());
  try {
    await display.artLoaded();
    advancePlayer(instance, 1 / 30);
    // The ghost bank's appear clip is declared while its art fails to load.
    makeGhost(instance);
    await tick();
    await tick();
    expect(instance.sprite.sprite.peek().clip.name).toBe('appear');
    // DoActualRez switches bank, then build, then plays the rebirth clip of the living bank.
    expect(() => makeAlive(instance, 'amulet_rebirth')).not.toThrow();
    expect(instance.sprite.sprite.peek().clip.name).toBe('amulet_rebirth');
    expect(instance.sprite.currentAnimation).toBe('amulet_rebirth');
  } finally {
    instance.remove();
    display.dispose();
  }
});
