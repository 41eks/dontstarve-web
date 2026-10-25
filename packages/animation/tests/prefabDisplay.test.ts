import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { getLightOverride } from '../src/lightOverride';
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
  // The declared light override reaches the model, and clearing it leaves no minimum light behind.
  sprite.setLightOverride(1); await tick();
  expect(getLightOverride(model)).toBe(1);
  sprite.setLightOverride(null); await tick();
  expect(getLightOverride(model)).toBeUndefined();

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
