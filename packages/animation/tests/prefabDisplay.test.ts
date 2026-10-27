import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { createArchiveEntity, prefabInstance } from '../../prefab/src/prefabInstance';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '../src/archiveSprite';
import { ResidentSprite } from '../src/residentSprite';
import { displayLightOverride } from '../../display/src/displaySprites';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import type { WorldContext } from '../../prefab/src/worldContext';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('draws the entity from its status and sprite json: sleeping completes a transition, waking restores the clip, removal releases the model', async () => {
  const bytes = await readFile(new URL(`../../../public/dst/data/anim/${TREASURE_CHEST_DEFINITION.archive}`, import.meta.url));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), style: {} }), body: { appendChild: vi.fn() } });
  const awake = createSignal(true);
  const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: new EventTarget() },
    tickingarea: () => createMemo(() => awake.get()) } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { chest: TREASURE_CHEST_DEFINITION }, () => true);
  await placement.spawn('chest');
  const model = world.scene.children[0], instance = prefabInstance(model)!, sprite = instance.sprite;
  const meshes = () => { let count = 0; model.traverse(object => { if (object instanceof THREE.Mesh) count++; }); return count; };
  await tick();
  expect(instance.status.peek()).toBe('active');
  expect(meshes()).toBe(1);

  // Writing the json is enough: the drawn sprite follows on its next frame.
  sprite.start('open');
  expect(sprite.currentAnimation).toBe('open');
  // The json's light override is what the display layer reports, and clearing it leaves no minimum light behind.
  sprite.setLightOverride(1); await tick();
  expect(displayLightOverride(model)).toBe(1);
  sprite.setLightOverride(null); await tick();
  expect(displayLightOverride(model)).toBe(0);

  awake.set(false); await tick();
  expect(instance.status.peek()).toBe('asleep');
  expect(model.parent).toBeNull();
  expect(meshes()).toBe(0);
  const complete = vi.fn();
  sprite.playOnce('close', complete);
  expect(complete).toHaveBeenCalledOnce();

  awake.set(true); await tick();
  expect(model.parent).toBe(world.scene);
  expect(meshes()).toBe(1);
  expect(sprite.currentAnimation).toBe('close');

  placement.dispose(); await tick();
  expect(instance.status.peek()).toBe('removed');
  expect(model.parent).toBeNull();
  expect(meshes()).toBe(0);
});

it('the model stands on the entity\'s own position vector, so moving it never touches the sprite json', async () => {
  const bytes = await readFile(new URL(`../../../public/dst/data/anim/${TREASURE_CHEST_DEFINITION.archive}`, import.meta.url));
  vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes)));
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', { createElement: () => ({ setAttribute: vi.fn(), style: {} }), body: { appendChild: vi.fn() } });
  const world = { scene: new THREE.Scene(), player: new THREE.Object3D(), ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(), renderer: { domElement: new EventTarget() },
    tickingarea: () => createMemo(() => true) } as unknown as WorldContext;
  const placement = new AnimatedBuildingPlacement(world, { chest: TREASURE_CHEST_DEFINITION }, () => true);
  await placement.spawn('chest');
  const model = world.scene.children[0], instance = prefabInstance(model)!;
  await tick();
  expect(model.position).toBe(instance.position);

  const published = vi.fn();
  instance.sprite.sprite.subscribe(published);
  model.position.set(3, 0, 4);
  expect(instance.position.toArray()).toEqual([3, 0, 4]);
  instance.sprite.start('open');
  expect(published).toHaveBeenCalledOnce();
  expect(instance.position.toArray()).toEqual([3, 0, 4]);
});

it('draws a frame declared as a fraction of the clip once the art it was declared before has loaded', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const assets = new ArchiveSpriteAssets();
  const loading = preloadSharedArchiveSprite(assets, { animationArchive: 'sapling.zip', buildArchives: ['sapling.zip'], bank: 'sapling' },
    { instancedAnimations: 'all', staticBillboard: true });
  const { instance, display } = createArchiveEntity('sapling', { create: clip => loading.then(create => create(clip.name, clip.loop, 'sapling')) },
    { name: 'sway' }, 'sapling');
  const setFrame = vi.spyOn(ResidentSprite.prototype, 'setFrame');
  try {
    // sapling.lua SetFrame(math.random(GetCurrentAnimationNumFrames()) - 1), declared while the clip's length is unknown.
    instance.sprite.setFrameAt(.5);
    expect(instance.sprite.loaded).toBe(false);
    expect(setFrame).not.toHaveBeenCalled();
    await display.artLoaded();
    const frames = instance.sprite.numFrames;
    expect(frames).toBeGreaterThan(1);
    expect(setFrame).toHaveBeenLastCalledWith(Math.floor(.5 * frames));
  } finally { instance.remove(); display.dispose(); assets.dispose(); }
});
