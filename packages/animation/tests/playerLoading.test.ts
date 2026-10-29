import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, expect, it, vi } from 'vitest';
import { createWilsonPlayerPrefab } from '../../prefab/src/player';

vi.mock('../../prefab/src/sound', () => ({ PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true, setVolume() {} })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('creates the logical player and body synchronously and completes actions and FX timers before art loads', async () => {
  vi.stubGlobal('window', new EventTarget());
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const fetch = vi.fn(async (url: string) => {
    await blocked;
    return new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)));
  });
  vi.stubGlobal('fetch', fetch);
  const world = new CANNON.World();
  const prefab = createWilsonPlayerPrefab('/dst/data/anim', world);
  const { instance, model, display, body } = prefab;
  const animation = instance.animationController;
  const scene = new THREE.Scene(); display.mount(scene);
  try {
    expect(prefab).not.toBeInstanceOf(Promise);
    expect(world.bodies).toContain(body);
    expect(model.getObjectByProperty('isMesh', true)).toBeUndefined();
    instance.sprite.setVisible(false); await tick();
    expect(model.visible).toBe(false);
    instance.sprite.setVisible(true); await tick();
    expect(model.visible).toBe(true);
    const read = vi.fn(() => true);
    expect(animation.playRead({ prefab: 'book_silviculture', def: { fx_under_prefab: 'fx_roots_under_book' } }, read)).toBe(true);
    for (let frame = 0; frame < 60 && animation.stategraph.stateName !== 'book2'; frame++) animation.update(1 / 30);
    expect(animation.stategraph.stateName).toBe('book2');
    const fx = [...instance.sprite.fx.peek().values()];
    expect(fx).toHaveLength(2);
    instance.setActive(false); await tick();
    for (let frame = 0; frame < 240; frame++) animation.update(1 / 30);
    expect(read).toHaveBeenCalledOnce();
    expect(instance.sprite.fx.peek().size).toBe(0);
    for (const child of fx) expect(child.display!.isRemoved).toBe(true);
    animation.makeGhost(true);
    expect(animation.isGhost).toBe(true);
    animation.makeAlive();
    for (let frame = 0; frame < 120; frame++) animation.update(1 / 30);
    expect(animation.isGhost).toBe(false);
    instance.setActive(true); await tick();
    const latest = instance.sprite.sprite.peek();
    expect(latest.source).toMatchObject({ animationArchive: 'player_idles.zip', buildArchive: 'dynamic/wortox.zip' });
    release(); await display.artLoaded();
    expect(instance.sprite.sprite.peek()).toBe(latest);
    expect(model.getObjectByProperty('isMesh', true)).toBeDefined();
    expect(instance.physicsBody).toBe(body);
    expect(fetch.mock.calls.some(([url]) => url.includes('dynamic/ghost_wortox_build'))).toBe(false);
  } finally { release(); instance.remove(); display.dispose(); }
});

it('does not recreate a removed player or write its json when a pending source finishes', async () => {
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => {
    await blocked;
    return new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)));
  });
  const world = new CANNON.World(), { instance, display, model, body } = createWilsonPlayerPrefab('/dst/data/anim', world);
  instance.remove(); await tick();
  const removed = instance.sprite.sprite.peek();
  release(); await display.artLoaded(); await tick();
  expect(instance.status.peek()).toBe('removed');
  expect(instance.sprite.sprite.peek()).toBe(removed);
  expect(world.bodies).not.toContain(body);
  expect(model.getObjectByProperty('isMesh', true)).toBeUndefined();
  expect(model.parent).toBeNull();
});
