import { onSignalChange } from '../../signals/tests/signalChanges';
import { bindTestCamera, createTestWorldSources } from './worldContentFixture';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { bindWorldContent, createMemo, createSignal, LazySignal } from '@dontstarve-web/signals';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import {
  createArchiveEntity,
  createEmptyEntity,
  createPrefabEntity,
  prefabInstance,
} from '../../prefab/src/prefabInstance';
import { registerActionEntity, findActionEntity } from '../../prefab/src/actionEntity';
import { PrefabDisplayGroup, prefabDisplay, SpriteState } from '@dontstarve-web/display';
import { animStateDeclarations } from '../../display/src/spriteState';
import { AnimState, mergeAnimStates, resolveAnimState, type AnimStateArt } from '../src/animState';
import { smallHash } from '../src/animationAssets';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite } from '../src/archiveSprite';
import { ResidentSprite } from '../src/residentSprite';
import type { ArchiveSprite } from '../src/archiveSprite';
import { displayLightOverride } from '../../display/src/displaySprites';
import definitions from '../../prefab/src/definitions.json';
import { managedBuildings } from './managedBuildings';
import type { WorldContext } from '../../prefab/src/worldContext';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
/** An entity that draws a sprite, so it joins the group's foot sort. */
const drawnEntity = (prefab: string) =>
  createPrefabEntity(
    prefab,
    {
      create: () => new THREE.Group().add(new THREE.Group()),
      release: model => model.removeFromParent(),
    },
    { name: 'idle' },
    prefab,
  );

it("takes a sleeping display out of the group's frame updates and render list until it wakes, and still releases it", async () => {
  const scene = new THREE.Scene(),
    group = new PrefabDisplayGroup(scene);
  const entity = drawnEntity('tree'),
    { instance, display } = entity;
  const update = vi.spyOn(display, 'update');
  group.mount(display);
  group.update(1 / 30);
  expect(update).toHaveBeenCalledOnce();
  expect(group.renderEntities.map(entry => entry.object)).toEqual([display.model]);
  instance.setActive(false);
  await tick();
  group.update(1 / 30);
  expect(update).toHaveBeenCalledOnce();
  expect(group.renderEntities).toEqual([]);
  instance.setActive(true);
  await tick();
  group.update(1 / 30);
  expect(update).toHaveBeenCalledTimes(2);
  expect(group.renderEntities.map(entry => entry.object)).toEqual([display.model]);
  instance.setActive(false);
  await tick();
  const released = vi.fn();
  display.onDispose(released);
  group.dispose();
  expect(released).toHaveBeenCalledOnce();
  instance.remove();
});

it('starts an initially sleeping billboard camera subscription on first wake', () => {
  const sources = createTestWorldSources(new GameTimeScheduler());
  const unbind = bindWorldContent(sources);
  const read = vi.spyOn(sources.camerarotation, 'get');
  const parentStatus = createSignal<'active' | 'asleep' | 'removed'>('asleep');
  const { instance } = createPrefabEntity(
    'billboard',
    { create: () => new THREE.Group().add(new THREE.Group()), release: model => model.removeFromParent() },
    { name: 'idle', billboard: true },
    undefined,
    undefined,
    parentStatus,
  );
  try {
    expect(read).not.toHaveBeenCalled();
    parentStatus.set('active');
    expect(read).toHaveBeenCalledOnce();
    parentStatus.set('asleep');
    sources.camerarotation.set(new THREE.Quaternion(0, 1, 0, 0));
    expect(read).toHaveBeenCalledOnce();
  } finally {
    instance.remove();
    unbind();
  }
});

it('preserves ground ordering when ground art and billboards share one display group', () => {
  const scene = new THREE.Scene(),
    group = new PrefabDisplayGroup(scene);
  const ground = drawnEntity('ground'),
    billboard = drawnEntity('billboard');
  ground.instance.sprite.setGround(0);
  try {
    group.mount(ground.display);
    group.mount(billboard.display);
    expect(ground.display.model.parent).toBe(scene);
    expect(group.renderEntities.map(entry => entry.object)).toEqual([billboard.display.model]);
  } finally {
    ground.instance.remove();
    billboard.instance.remove();
    group.dispose();
  }
});

it('keeps accumulated art revisions when a consumer first follows the sprite', () => {
  const sprite = new SpriteState({ name: 'idle' });
  const write = vi.spyOn(LazySignal.prototype, 'set');
  sprite.artChanged();
  sprite.artChanged();
  expect(write).not.toHaveBeenCalled();
  const art = sprite.art;
  expect(art.value).toBe(2);
  expect(art).toBeInstanceOf(LazySignal);
  expect((art as LazySignal<number>).declared).toBe(false);
  expect(sprite.art).toBe(art);
  const changed = vi.fn();
  const stop = onSignalChange(art, changed);
  sprite.artChanged();
  expect(changed).toHaveBeenCalledExactlyOnceWith(3, 2);
  stop();
});

it('updates foot sorting synchronously on first FX attachment and after detachment', () => {
  const group = new PrefabDisplayGroup(new THREE.Scene());
  const read = vi.spyOn(LazySignal.prototype, 'get');
  const { display, instance } = drawnEntity('effect');
  try {
    group.mount(display);
    instance.sprite.setDepthOffset(true);
    expect(group.renderEntities[0]).toMatchObject({ object: display.model, sortLayer: 2 });
    expect(read).not.toHaveBeenCalled();

    display.setAttachedAsFx(true);
    expect(group.renderEntities).toEqual([]);
    display.setAttachedAsFx(false);
    expect(group.renderEntities[0]).toMatchObject({ object: display.model, sortLayer: 2 });
  } finally {
    instance.remove();
    group.dispose();
  }
});

it('lets the display group own an adopted display across sleep, wake and scene teardown', async () => {
  const scene = new THREE.Scene(),
    group = new PrefabDisplayGroup(scene);
  const { instance, display } = drawnEntity('adopted');
  const released = vi.fn();
  display.onDispose(released);
  try {
    group.mount(display);
    group.mount(display);
    expect(display.model.parent).toBe(scene);
    expect(group.renderEntities).toHaveLength(1);
    instance.setActive(false);
    await tick();
    expect(display.model.parent).toBeNull();
    expect(group.renderEntities).toEqual([]);
    instance.setActive(true);
    await tick();
    expect(display.model.parent).toBe(scene);
    expect(group.renderEntities).toHaveLength(1);
    group.dispose();
    group.dispose();
    expect(released).toHaveBeenCalledOnce();
    expect(scene.children).toEqual([]);
    expect(instance.isRemoved).toBe(false);
  } finally {
    instance.remove();
    group.dispose();
  }
});

it('keeps shared creation and action binding free of model metadata throughout the entity lifecycle', async () => {
  const entities = [
    createEmptyEntity('empty'),
    createPrefabEntity(
      'factory',
      { create: () => new THREE.Group().add(new THREE.Group()), release: model => model.removeFromParent() },
      { name: 'idle' },
    ),
    createArchiveEntity(
      'archive',
      {
        create: () => {
          throw new Error('A clip has not been declared');
        },
      },
      { name: '', none: true },
    ),
  ];
  for (const { instance, display } of entities) {
    const model = display.model,
      entity = registerActionEntity(prefabInstance(model)!);
    const released = vi.fn();
    display.onDispose(released);
    const check = () => {
      expect(prefabInstance(model)).toBe(instance);
      expect(entity.components).toBe(instance.components);
      for (const key of [
        'components',
        'display',
        'animationController',
        'actionEntity',
        'removed',
        'getGroundPosition',
        'skinIdSignal',
      ]) {
        expect(Object.hasOwn(model.userData, key), key).toBe(false);
      }
    };
    expect(prefabDisplay(model)).toBe(display);
    check();
    instance.setActive(false);
    await tick();
    check();
    instance.setActive(true);
    await tick();
    check();
    instance.remove();
    display.dispose();
    await tick();
    check();
    expect(findActionEntity(model)).toBeUndefined();
    expect(released).toHaveBeenCalledOnce();
  }
});

it('draws the entity from its status and sprite json: sleeping completes a transition, waking restores the clip, removal releases the model', async () => {
  const bytes = await readFile(
    new URL(`../../../public/dst/data/anim/${definitions.animatedBuildings.treasurechest.archive}`, import.meta.url),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes)),
  );
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  const awake = createSignal(true);
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() },
    tickingarea: () => createMemo(() => awake.get()),
  } as unknown as WorldContext;
  const placement = managedBuildings(world);
  await placement.spawn('treasurechest');
  const model = world.scene.children[0],
    instance = prefabInstance(model)!,
    sprite = instance.sprite;
  const meshes = () => {
    let count = 0;
    model.traverse(object => {
      if (object instanceof THREE.Mesh) {
        count++;
      }
    });
    return count;
  };
  await tick();
  for (const key of [
    'components',
    'display',
    'animationController',
    'getGroundPosition',
    'burningSignal',
    'burntSignal',
    'skinIdSignal',
    'fireSound',
    'disposePreparedResources',
    'disposeSpriteSource',
  ]) {
    expect(Object.hasOwn(model.userData, key), key).toBe(false);
  }
  expect(instance.position.y).toBe(0);
  expect(instance.status.value).toBe('active');
  expect(meshes()).toBe(1);

  // Writing the json is enough: the drawn sprite follows on its next frame.
  sprite.start('open');
  expect(sprite.currentAnimation).toBe('open');
  // The json's light override is what the display layer reports, and clearing it leaves no minimum light behind.
  sprite.setLightOverride(1);
  await tick();
  expect(displayLightOverride(model)).toBe(1);
  sprite.setLightOverride(null);
  await tick();
  expect(displayLightOverride(model)).toBe(0);

  awake.set(false);
  await tick();
  expect(instance.status.value).toBe('asleep');
  expect(model.parent).toBeNull();
  expect(meshes()).toBe(0);
  const complete = vi.fn();
  sprite.playOnce('close', complete);
  expect(complete).toHaveBeenCalledOnce();

  awake.set(true);
  await tick();
  expect(model.parent).toBe(world.scene);
  expect(meshes()).toBe(1);
  expect(sprite.currentAnimation).toBe('close');

  placement.dispose();
  await tick();
  expect(instance.status.value).toBe('removed');
  expect(model.parent).toBeNull();
  expect(meshes()).toBe(0);
});

it("the model stands on the entity's own position vector, so moving it never touches the sprite json", async () => {
  const bytes = await readFile(
    new URL(`../../../public/dst/data/anim/${definitions.animatedBuildings.treasurechest.archive}`, import.meta.url),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(bytes)),
  );
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('document', {
    createElement: () => ({ setAttribute: vi.fn(), style: {} }),
    body: { appendChild: vi.fn() },
  });
  const world = {
    scene: new THREE.Scene(),
    player: new THREE.Object3D(),
    ground: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    renderer: { domElement: new EventTarget() },
    tickingarea: () => createMemo(() => true),
  } as unknown as WorldContext;
  const placement = managedBuildings(world);
  await placement.spawn('treasurechest');
  const model = world.scene.children[0],
    instance = prefabInstance(model)!;
  await tick();
  expect(model.position).toBe(instance.position);

  const published = vi.fn();
  onSignalChange(instance.sprite.sprite, published);
  model.position.set(3, 0, 4);
  expect(instance.position.toArray()).toEqual([3, 0, 4]);
  instance.sprite.start('open');
  expect(published).toHaveBeenCalledOnce();
  expect(instance.position.toArray()).toEqual([3, 0, 4]);
});

it('draws a frame declared as a fraction of the clip once the art it was declared before has loaded', async () => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('window', new EventTarget());
  const assets = new ArchiveSpriteAssets();
  const loading = preloadSharedArchiveSprite(
    assets,
    { animationArchive: 'sapling.zip', buildArchives: ['sapling.zip'], bank: 'sapling' },
    { instancedAnimations: 'all', staticBillboard: true },
  );
  const { instance, display } = createArchiveEntity(
    'sapling',
    { create: clip => loading.then(create => create(clip.name, clip.loop, 'sapling')) },
    { name: 'sway' },
    'sapling',
  );
  const setFrame = vi.spyOn(ResidentSprite.prototype, 'setFrame');
  try {
    // sapling.lua SetFrame(math.random(GetCurrentAnimationNumFrames()) - 1), declared while the clip's length is unknown.
    instance.sprite.setFrameAt(0.5);
    expect(instance.sprite.loaded).toBe(false);
    expect(setFrame).not.toHaveBeenCalled();
    await display.artLoaded();
    const frames = instance.sprite.numFrames;
    expect(frames).toBeGreaterThan(1);
    expect(setFrame).toHaveBeenLastCalledWith(Math.floor(0.5 * frames));
  } finally {
    instance.remove();
    display.dispose();
    assets.dispose();
  }
});

it("draws AnimState slots over the entity's own declaration in the order they were first declared", () => {
  const builds = new Map<string, object>();
  const art = {
    peekBuild: (archive: string) => builds.get(archive) ?? (builds.set(archive, { archive }), builds.get(archive)),
  } as unknown as AnimStateArt;
  const sprite = new SpriteState({ name: 'idle' });
  const own = new AnimState();
  sprite.setAnimState(own.json, art);
  own.Hide('ARM_carry');
  own.OverrideSymbol('swap_body', 'base_body', 'swap_body');
  const hand = new AnimState();
  sprite.declareAnimState('hand', hand.json, art);
  hand.Show('ARM_carry');
  hand.Hide('ARM_normal');
  const body = new AnimState();
  sprite.declareAnimState('body', body.json, art);
  body.OverrideSymbol('swap_body', 'swap_backpack', 'swap_body');
  const merged = () =>
    mergeAnimStates(
      animStateDeclarations(sprite.sprite.value.appearance).map(
        ([, op]) => resolveAnimState(op.state.value, op.art).state,
      ),
    );
  const swapBody = () =>
    (merged().overrides.get(smallHash('swap_body'))?.[0].build as unknown as { archive: string }).archive;
  const hidden = (layer: string) => merged().hiddenLayers.has(smallHash(layer.toLowerCase()));

  expect([hidden('ARM_carry'), hidden('ARM_normal'), swapBody()]).toEqual([false, true, 'swap_backpack.zip']);
  // The sprite holds the declarations themselves: later writes are drawn without declaring again, the entity's own stays beneath.
  own.Hide('HAT');
  hand.Hide('LANTERN_OVERLAY');
  sprite.declareAnimState('hand', hand.json, art);
  expect(animStateDeclarations(sprite.sprite.value.appearance).map(([key]) => key)).toEqual([
    'anim-state',
    'anim-state:hand',
    'anim-state:body',
  ]);
  expect([hidden('ARM_carry'), hidden('HAT'), swapBody()]).toEqual([false, true, 'swap_backpack.zip']);
  // Removing a slot leaves what lies beneath it.
  sprite.declareAnimState('hand', undefined);
  sprite.declareAnimState('body', undefined);
  expect([hidden('ARM_carry'), hidden('ARM_normal'), swapBody()]).toEqual([true, false, 'base_body.zip']);
});

it('subscribes to declared direction and pose signals, preserving the clip through camera turns and releasing pose subscriptions', async () => {
  const camera = bindTestCamera();
  let name = 'jump';
  const model = new THREE.Group();
  model.add(new THREE.Group());
  const controller = {
    model,
    instanced: undefined,
    drawnInstanced: false,
    get currentAnimation() {
      return name;
    },
    frameCount: 20,
    currentAnimationLength: 20 / 30,
    frame: 0,
    start: vi.fn((value: string) => {
      name = value;
    }),
    update: vi.fn(),
    dispose: vi.fn(() => model.removeFromParent()),
    setFacing: vi.fn(),
    setFrame: vi.fn(),
    setPaused: vi.fn(),
    setPlaybackRate: vi.fn(),
  };
  // A mock of the archive sprite surface the resident drives; every other call is accepted.
  const sprite = new Proxy(controller, {
    get: (target, key) => (key in target ? target[key as keyof typeof target] : () => undefined),
  });
  const { instance, display } = createArchiveEntity(
    'posed',
    { create: () => sprite as unknown as ArchiveSprite },
    { name: 'jump', billboard: true },
  );
  const progress = createSignal<number | undefined>(0.25);
  try {
    instance.sprite.setFacingRotation(0, 4);
    instance.sprite.setFrameSource({ name: 'jump', progress });
    await tick();
    const json = instance.sprite.sprite.value;
    camera.turn(new THREE.Quaternion());
    expect(controller.setFacing).toHaveBeenLastCalledWith(1);
    expect(controller.setFrame).toHaveBeenLastCalledWith(5);
    expect(controller.setPaused).toHaveBeenLastCalledWith(true);
    progress.set(0.75);
    expect(controller.setFrame).toHaveBeenLastCalledWith(15);
    camera.turn(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    expect(controller.setFacing).toHaveBeenLastCalledWith(4);
    expect(instance.sprite.sprite.value).toBe(json);
    controller.start.mockClear();
    instance.sprite.setFacingRotation(90, 6);
    await tick();
    expect(controller.setFacing).toHaveBeenLastCalledWith(64);
    expect(controller.start).not.toHaveBeenCalled();
    instance.sprite.start('walk');
    await tick();
    expect(controller.setPaused).toHaveBeenLastCalledWith(false);
    const frames = controller.setFrame.mock.calls.length;
    progress.set(0.5);
    expect(controller.setFrame.mock.calls.length).toBe(frames);
    display.dispose();
    progress.set(0.9);
    expect(controller.setFrame.mock.calls.length).toBe(frames);
  } finally {
    instance.remove();
    display.dispose();
    camera.unbind();
  }
});

it('applies a sprite json in the task that writes it and leaves unchanged frames alone', () => {
  const { instance, display } = createEmptyEntity('test');
  const apply = vi.spyOn(display as unknown as { applySprite(json: unknown): void }, 'applySprite');
  try {
    for (let frame = 0; frame < 3; frame++) {
      display.update(1 / 30);
    }
    expect(apply).not.toHaveBeenCalled();
    instance.sprite.setOpacity(0.5);
    expect(apply).toHaveBeenCalledOnce();
    expect(apply.mock.calls[0][0]).toBe(instance.sprite.sprite.value);
    display.update(1 / 30);
    expect(apply).toHaveBeenCalledOnce();
  } finally {
    apply.mockRestore();
    instance.remove();
    display.dispose();
  }
});
