import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { AnimatedBuildingPlacement } from '../../prefab/src/animatedBuildingPlacement';
import { createArchiveEntity, createEmptyEntity, createPrefabEntity, prefabInstance } from '../../prefab/src/prefabInstance';
import { actionEntity, findActionEntity } from '../../prefab/src/actionEntity';
import { PrefabDisplayGroup, prefabDisplay, SpriteResources, SpriteState } from '@dontstarve-web/display';
import { animStateDeclarations } from '../../display/src/spriteState';
import { AnimState, mergeAnimStates, resolveAnimState, type AnimStateArt } from '../src/animState';
import { smallHash } from '../src/animationAssets';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '../src/archiveSprite';
import { ResidentSprite } from '../src/residentSprite';
import { displayLightOverride } from '../../display/src/displaySprites';
import { TREASURE_CHEST_DEFINITION } from '../../prefab/src/treasurechest';
import type { WorldContext } from '../../prefab/src/worldContext';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

it('lets the display group own an adopted display across sleep, wake and scene teardown', async () => {
  const scene = new THREE.Scene(), group = new PrefabDisplayGroup(scene);
  const { instance, display } = createEmptyEntity('adopted');
  const released = vi.fn(); display.onDispose(released);
  try {
    group.mount(display); group.mount(display);
    expect(display.model.parent).toBe(scene);
    expect(group.renderEntities).toHaveLength(1);
    instance.setActive(false); await tick();
    expect(display.model.parent).toBeNull();
    expect(group.renderEntities).toEqual([]);
    instance.setActive(true); await tick();
    expect(display.model.parent).toBe(scene);
    expect(group.renderEntities).toHaveLength(1);
    group.dispose(); group.dispose();
    expect(released).toHaveBeenCalledOnce();
    expect(scene.children).toEqual([]);
    expect(instance.isRemoved).toBe(false);
  } finally { instance.remove(); group.dispose(); }
});

it('keeps shared creation and action binding free of model metadata throughout the entity lifecycle', async () => {
  const entities = [
    createEmptyEntity('empty'),
    createPrefabEntity('factory', { create: () => new THREE.Group(), release: model => model.removeFromParent() }, { name: 'idle' }),
    createArchiveEntity('archive', { create: () => { throw new Error('A clip has not been declared'); } }, { name: '', none: true }),
  ];
  for (const { instance, display } of entities) {
    const model = display.model, entity = actionEntity(model, instance.prefab);
    const released = vi.fn(); display.onDispose(released);
    const check = () => {
      expect(prefabInstance(model)).toBe(instance);
      expect(entity.components).toBe(instance.components);
      for (const key of ['components', 'display', 'animationController', 'actionEntity', 'removed', 'getGroundPosition', 'skinIdSignal']) {
        expect(Object.hasOwn(model.userData, key), key).toBe(false);
      }
    };
    expect(prefabDisplay(model)).toBe(display);
    check();
    instance.setActive(false); await tick(); check();
    instance.setActive(true); await tick(); check();
    instance.remove(); display.dispose(); await tick(); check();
    expect(findActionEntity(model)).toBeUndefined();
    expect(released).toHaveBeenCalledOnce();
  }
});

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
  for (const key of ['components', 'display', 'animationController', 'getGroundPosition', 'burningSignal', 'burntSignal', 'skinIdSignal', 'fireSound', 'disposePreparedResources', 'disposeSpriteSource']) {
    expect(Object.hasOwn(model.userData, key), key).toBe(false);
  }
  expect(instance.position.y).toBe(0);
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

it('stands a deferred first sprite on the foot of the entity\'s first clip, and keeps that foot through sleep and wake', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
  const resources = new SpriteResources('/dst/data/anim');
  const source = resources.animated('cook_pot.zip', {}, { name: 'CookPot', scale: .02 });
  const { instance, display } = createPrefabEntity('cookpot', source, { name: 'idle_empty', billboard: true }, 'CookPot',
    undefined, undefined, { alignBottom: true });
  try {
    // A restored pot is already full before its art arrives; it is drawn at the empty pot's foot, as one drawn at once would be.
    instance.sprite.start('idle_full');
    await display.artLoaded();
    const loaded = await source.load(), empty = loaded.create('idle_empty', 'first');
    empty.updateWorldMatrix(true, true);
    const foot = -new THREE.Box3().setFromObject(empty).min.y;
    loaded.release(empty);
    expect(foot).toBeGreaterThan(0);
    expect(display.model.children[0].position.y).toBeCloseTo(foot);
    instance.setActive(false); await tick();
    instance.setActive(true); await tick();
    expect(display.model.children[0].position.y).toBeCloseTo(foot);
  } finally { instance.remove(); display.dispose(); resources.dispose(); }
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

it('draws AnimState slots over the entity\'s own declaration in the order they were first declared', () => {
  const builds = new Map<string, object>();
  const art = { peekBuild: (archive: string) => builds.get(archive) ?? (builds.set(archive, { archive }), builds.get(archive)) } as unknown as AnimStateArt;
  const sprite = new SpriteState({ name: 'idle' });
  const own = new AnimState();
  sprite.setAnimState(own.json, art);
  own.Hide('ARM_carry');
  own.OverrideSymbol('swap_body', 'base_body', 'swap_body');
  const hand = new AnimState();
  sprite.declareAnimState('hand', hand.json, art);
  hand.Show('ARM_carry'); hand.Hide('ARM_normal');
  const body = new AnimState();
  sprite.declareAnimState('body', body.json, art);
  body.OverrideSymbol('swap_body', 'swap_backpack', 'swap_body');
  const merged = () => mergeAnimStates(animStateDeclarations(sprite.sprite.peek().appearance).map(([, op]) => resolveAnimState(op.state.peek(), op.art).state));
  const swapBody = () => (merged().overrides.get(smallHash('swap_body'))?.[0].build as unknown as { archive: string }).archive;
  const hidden = (layer: string) => merged().hiddenLayers.has(smallHash(layer.toLowerCase()));

  expect([hidden('ARM_carry'), hidden('ARM_normal'), swapBody()]).toEqual([false, true, 'swap_backpack.zip']);
  // The sprite holds the declarations themselves: later writes are drawn without declaring again, the entity's own stays beneath.
  own.Hide('HAT'); hand.Hide('LANTERN_OVERLAY');
  sprite.declareAnimState('hand', hand.json, art);
  expect(animStateDeclarations(sprite.sprite.peek().appearance).map(([key]) => key)).toEqual(['anim-state', 'anim-state:hand', 'anim-state:body']);
  expect([hidden('ARM_carry'), hidden('HAT'), swapBody()]).toEqual([false, true, 'swap_backpack.zip']);
  // Removing a slot leaves what lies beneath it.
  sprite.declareAnimState('hand', undefined); sprite.declareAnimState('body', undefined);
  expect([hidden('ARM_carry'), hidden('ARM_normal'), swapBody()]).toEqual([true, false, 'base_body.zip']);
});
