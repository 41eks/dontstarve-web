import { useTestTileMap } from './tileMapFixture';
import { createPickupInventory } from './pickupFixture';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIREFLIES_LIGHT, FirefliesEntity } from '../../prefab/src/fireflies';
import { ItemWorldFixture } from './itemWorldFixture';

import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createSignal, type HandEquipment } from '../../signals/src';
import { DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';
import { bindTestWorld } from './worldContentFixture';
import { configureBugNetEntity } from '../../prefab/src/bugnet';
import { findActionEntity } from '../../prefab/src/actionEntity';
import { mouseTargets } from '../../prefab/src/mouseTargets';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { displayLights } from '../../display/src/displaySprites';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { workTargets } from './workTargets';
import { testItem } from './testInventory';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();
/** Whether the renderer reads a light at `model`. */
const listed = (model: THREE.Object3D) => [...displayLights()].some(entry => entry.model === model);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
useTestTileMap();

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach(stop => stop());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function assets() {
  vi.stubGlobal(
    'fetch',
    async () => new Response(await readFile(new URL('../../../public/dst/data/anim/fireflies.zip', import.meta.url))),
  );
}

function netEquipment(): HandEquipment {
  const entity = testItem({ itemId: 'bugnet', count: 1 });
  configureBugNetEntity(entity);
  cleanups.push(() => entity.destroy());
  return { itemId: 'bugnet', EQUIPSLOTS: 'HANDS', entity };
}

/** A swarm spawned at the origin of an item world, with math.random at 0: 3 s fadein, .75 s fadeout, 2 s checks. */
function setup(night: boolean) {
  assets();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const scheduler = new GameTimeScheduler();
  const { cycle, playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  cycle.set(night ? 'night' : 'day');
  playerpositions.set([new THREE.Vector3(40, 0, 0)]);
  const handEquipment = createSignal<HandEquipment | null>(null);
  const inventory = createPickupInventory();
  const manager = new ItemWorldFixture(
    new THREE.Scene(),
    new THREE.PerspectiveCamera(),
    undefined,
    'images.zip',
    inventory,
    '/anim',
    new THREE.Group(),
    undefined,
    { getWatchWorldContent, handEquipment },
    undefined,
    undefined,
    scheduler,
  );
  cleanups.push(() => {
    manager.dispose();
    inventory.dispose();
    unbind();
    scheduler.dispose();
  });
  const model = manager.spawnFromSave(
    'fireflies:a',
    { itemId: 'fireflies', count: 1, name: '萤火虫', icon: 'fireflies.tex' },
    new THREE.Vector3(),
  );
  const inst = prefabInstance(model);
  if (!(inst instanceof FirefliesEntity)) {
    throw new Error('no fireflies');
  }
  return {
    inst,
    model,
    cycle,
    playerpositions,
    handEquipment,
    tick: (seconds: number) => {
      for (let i = 0; i < Math.round(seconds / FRAMES); i++) {
        scheduler.advance(FRAMES);
      }
    },
    /** The clip played, undefined while none is (an undrawn swarm_pst settles into none at once). */
    clip: () => {
      const clip = inst.sprite.sprite.peek().clip;
      return clip.none ? undefined : clip.name;
    },
  };
}

describe('fireflies.lua light, proximity and isnight', () => {
  it('fades in at night with the source light and fades out while a player is near, keeping NET briefly', async () => {
    const s = setup(true);
    // fn's own updatelight: fadein plays swarm_pre into swarm_loop with the light enabled at zero.
    expect(s.inst.hasTag('NOCLICK')).toBe(false);
    expect(s.inst.hasTag('NET_workable')).toBe(true);
    expect(s.inst.light.peek()).toEqual({ ...FIREFLIES_LIGHT, intensity: 0 });
    expect(['swarm_pre', 'swarm_loop']).toContain(s.clip());
    s.tick(1.5);
    expect(s.inst._fadeval).toBeCloseTo(0.25);
    s.tick(1.6);
    expect(s.inst.light.peek()).toEqual(FIREFLIES_LIGHT);

    // playerprox SetDist(3, 5): near is strictly inside 3, far is outside 5.
    s.playerpositions.set([new THREE.Vector3(3 * WORLD_SCALE, 0, 0)]);
    await settle();
    expect(s.inst._fadeval).toBe(0.5);
    s.playerpositions.set([new THREE.Vector3(2.99 * WORLD_SCALE, 0, 0)]);
    await settle();
    expect(['swarm_pst', undefined]).toContain(s.clip());
    s.tick(0.8);
    expect(s.inst.light.peek()).toBeUndefined();
    expect(s.inst.hasTag('NOCLICK')).toBe(true);
    expect(s.inst.hasTag('NET_workable')).toBe(true);
    s.tick(1.6);
    expect(s.inst.hasTag('NET_workable')).toBe(false);

    s.playerpositions.set([new THREE.Vector3(4.99 * WORLD_SCALE, 0, 0)]);
    await settle();
    s.tick(1);
    expect(s.inst.light.peek()).toBeUndefined();
    s.playerpositions.set([new THREE.Vector3(5 * WORLD_SCALE, 0, 0)]);
    await settle();
    expect(s.inst.hasTag('NOCLICK')).toBe(false);
    expect(s.inst.hasTag('NET_workable')).toBe(true);
    s.tick(0.1);
    expect(s.inst.light.peek()?.intensity).toBeGreaterThan(0);
  });

  it('starts dark by day and checks the light 2–3 seconds after each isnight change', async () => {
    const s = setup(false);
    expect(s.clip()).toBeUndefined();
    expect(s.inst.light.peek()).toBeUndefined();
    expect(s.inst.hasTag('NOCLICK')).toBe(true);
    expect(s.inst.hasTag('NET_workable')).toBe(false);

    s.cycle.set('dusk');
    await settle();
    s.tick(3);
    expect(s.inst.light.peek()).toBeUndefined();
    s.cycle.set('night');
    await settle();
    s.tick(1.9);
    expect(s.inst.light.peek()).toBeUndefined();
    s.tick(0.2);
    expect(s.inst.hasTag('NOCLICK')).toBe(false);
    s.tick(3.1);
    expect(s.inst.light.peek()).toEqual(FIREFLIES_LIGHT);

    s.cycle.set('day');
    await settle();
    s.tick(2.1);
    expect(['swarm_pst', undefined]).toContain(s.clip());
    s.tick(1);
    expect(s.inst.light.peek()).toBeUndefined();
    expect(s.inst.hasTag('NOCLICK')).toBe(true);
  });

  it('is a mouse target only while lit and a held tool can NET it', async () => {
    const s = setup(false);
    const target = findActionEntity(s.model);
    expect(target).toBeDefined();
    s.handEquipment.set(netEquipment());
    await settle();
    // NOCLICK by day.
    expect(mouseTargets.has(target!)).toBe(false);
    s.cycle.set('night');
    await settle();
    s.tick(2.1);
    await settle();
    expect(mouseTargets.has(target!)).toBe(true);
    s.handEquipment.set({ itemId: 'axe', EQUIPSLOTS: 'HANDS' });
    await settle();
    expect(mouseTargets.has(target!)).toBe(false);
    expect(s.inst.hasTag('NOCLICK')).toBe(false);
  });
});

describe('real fireflies archive and ground transfers', () => {
  it('orients active billboards from the world camera rotation signal only when it changes', async () => {
    assets();
    const scheduler = new GameTimeScheduler();
    const { camerarotation, cycle, playerpositions, getWatchWorldContent, tickingarea, unbind } =
      bindTestWorld(scheduler);
    cycle.set('night');
    playerpositions.set([new THREE.Vector3(40, 0, 0)]);
    const scene = new THREE.Scene(),
      inventory = createPickupInventory();
    const canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    });
    const manager = new ItemWorldFixture(
      scene,
      new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer,
      'images.zip',
      inventory,
      '/anim',
      new THREE.Group(),
      undefined,
      { getWatchWorldContent, tickingarea },
      undefined,
      undefined,
      scheduler,
      undefined,
      undefined,
      undefined,
    );
    cleanups.push(() => {
      manager.dispose();
      inventory.dispose();
      unbind();
      scheduler.dispose();
    });
    const definition = { itemId: 'fireflies', count: 1, name: '萤火虫', icon: 'fireflies.tex' };
    const first = await manager.spawnFromSave('fireflies:a', definition, new THREE.Vector3());
    await vi.waitFor(() => expect(prefabInstance(first)!.sprite.loaded).toBe(true));
    const turned = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 3);
    camerarotation.set(turned);
    expect(first.children[0].quaternion.equals(turned)).toBe(true);
    // A frame that publishes the same camera leaves the billboard as it is.
    manager.update(0.1, turned);
    expect(first.children[0].quaternion.equals(turned)).toBe(true);
    // Items created after the turn start from the current rotation.
    const later = await manager.spawnFromSave('fireflies:b', definition, new THREE.Vector3(1, 0, 0));
    await vi.waitFor(() => expect(prefabInstance(later)!.sprite.loaded).toBe(true));
    expect(later.children[0].quaternion.equals(turned)).toBe(true);
  });

  it('keeps resources only in active tiles, disposes departing geometry and restores the same logical entities on return', async () => {
    assets();
    const scheduler = new GameTimeScheduler();
    const position = createSignal<THREE.Vector3 | undefined>(new THREE.Vector3());
    const { cycle, playerpositions, getWatchWorldContent, tickingarea, unbind } = bindTestWorld(
      scheduler,
      GetTileStateAtPoint(position),
    );
    cycle.set('night');
    playerpositions.set([new THREE.Vector3()]);
    const scene = new THREE.Scene(),
      inventory = createPickupInventory();
    const canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    });
    const manager = new ItemWorldFixture(
      scene,
      new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer,
      'images.zip',
      inventory,
      '/anim',
      new THREE.Group(),
      undefined,
      { getWatchWorldContent, tickingarea },
    );
    cleanups.push(() => {
      manager.dispose();
      inventory.dispose();
      unbind();
      DisposeTileStates(position);
      scheduler.dispose();
    });
    const definition = { itemId: 'fireflies', count: 1, name: '萤火虫', icon: 'fireflies.tex' };
    const near = await manager.spawnFromSave('fireflies:near', definition, new THREE.Vector3(30, 0, 0));
    const far = await manager.spawnFromSave('fireflies:far', definition, new THREE.Vector3(300, 0, 0));
    await settle();
    const geometry = (model: THREE.Object3D) => {
      let result: THREE.BufferGeometry | undefined;
      model.traverse(object => {
        if (object instanceof THREE.Mesh) {
          result = object.geometry;
        }
      });
      return result;
    };
    // Source frame buffers belong to ArchiveSpriteAssets; a departing swarm drops its visual and instance.
    // The near swarm fades in on load, and its sprite is built when swarm_pre starts.
    await vi.waitFor(() => expect(geometry(near)).toBeDefined());
    expect(geometry(far)).toBeUndefined();
    expect(far.parent).toBeNull();
    expect(manager.renderEntities.map(entry => entry.object)).toEqual([near]);
    const records = manager.exportRecords();
    const nearEntity = manager.entities.get('fireflies:near');
    for (let i = 0; i < 51; i++) {
      scheduler.advance(0.1);
      manager.update(0.1, new THREE.Quaternion());
    }
    expect(declaredLight(near)?.intensity).toBe(0.5);
    await settle();
    expect(listed(near)).toBe(true);
    const target = workTargets('NET')[0];
    const nearUpdate = vi.spyOn(prefabInstance(near)!.sprite, 'update');
    position.set(new THREE.Vector3(300, 0, 0));
    playerpositions.set([new THREE.Vector3(300, 0, 0)]);
    await settle();
    expect(geometry(near)).toBeUndefined();
    expect(near.parent).toBeNull();
    // inst.Light stays declared through OnEntitySleep; the swarm's display stops listing it for the renderer.
    expect(declaredLight(near)?.intensity).toBe(0.5);
    expect(listed(near)).toBe(false);
    // playerprox's OnEntityWake finds the player beside the woken swarm, which fades out.
    expect(prefabInstance(far)!.sprite.sprite.peek().clip.name).toBe('swarm_pst');
    expect(manager.renderEntities.map(entry => entry.object)).not.toContain(near);
    expect(prefabInstance(target.model)!.status.peek()).toBe('asleep');
    nearUpdate.mockClear();
    manager.update(0.1, new THREE.Quaternion());
    expect(nearUpdate).not.toHaveBeenCalled();
    expect(manager.exportRecords()).toEqual(records);
    expect(manager.entities.get('fireflies:near')).toBe(nearEntity);

    position.set(new THREE.Vector3());
    playerpositions.set([new THREE.Vector3()]);
    await settle();
    expect(geometry(near)).toBeDefined();
    expect(geometry(far)).toBeUndefined();
    expect(near.visible).toBe(true);
    expect(manager.exportRecords()).toEqual(records);
    expect(manager.entities.get('fireflies:near')).toBe(nearEntity);
    manager.update(0.1, new THREE.Quaternion());
    expect(declaredLight(near)?.intensity).toBe(0.5);
    manager.dispose();
    position.set(new THREE.Vector3(300, 0, 0));
    await settle();
    expect(scene.children).toHaveLength(0);
    expect(geometry(near)).toBeUndefined();
    expect(geometry(far)).toBeUndefined();
  });

  it('splits live drops, prevents bare-hand pickup, captures atomically and restores dark daytime swarms', async () => {
    assets();
    const scene = new THREE.Scene();
    const canvas = Object.assign(new EventTarget(), {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
    });
    const inventory = createPickupInventory();
    const pickup = vi.spyOn(inventory, 'GiveItem');
    pickup.mockImplementationOnce(entity => {
      entity.components.inventoryitem.OnDropped();
      return false;
    });
    const scheduler = new GameTimeScheduler();
    const { cycle, getWatchWorldContent, tickingarea, unbind } = bindTestWorld(scheduler);
    cycle.set('night');
    cleanups.push(() => {
      unbind();
      scheduler.dispose();
    });
    const manager = new ItemWorldFixture(
      scene,
      new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer,
      'images.zip',
      inventory,
      '/anim',
      new THREE.Group(),
      undefined,
      { getWatchWorldContent, tickingarea },
    );
    cleanups.push(() => manager.dispose());
    const definition = { itemId: 'fireflies', count: 2, name: '萤火虫', icon: 'fireflies.tex' };
    expect(await manager.drop(definition, new THREE.Vector3(8, 0, 9), () => false)).toBe(false);
    expect(scene.children).toHaveLength(0);
    const entity = manager.entities.create(definition);
    expect(await manager.drop(definition, new THREE.Vector3(8, 0, 9), () => entity)).toBe(true);
    expect(manager.groundStacks().map(stack => stack.count)).toEqual([1, 1]);
    const records = manager.exportRecords();
    expect(records[0].id).toBe(entity.id);
    expect(records[1].id).not.toBe(entity.id);
    const [target] = workTargets('NET');
    expect(
      target.work({ components: { inventory } }) &&
        (!!target.entity.components.inventoryitem?.owner || target.entity.isRemoved),
    ).toBe(false);
    expect(scene.children).toHaveLength(2);
    expect(
      target.work({ components: { inventory } }) &&
        (!!target.entity.components.inventoryitem?.owner || target.entity.isRemoved),
    ).toBe(true);
    expect(pickup).toHaveBeenLastCalledWith(entity, { x: 8, y: 0, z: 9 });
    expect(
      target.work({ components: { inventory } }) &&
        (!!target.entity.components.inventoryitem?.owner || target.entity.isRemoved),
    ).toBe(false);
    expect(declaredLight(target.model)).toBeUndefined();
    expect(manager.exportRecords()).toHaveLength(1);
    // The save reloads into a world of its own, with its own inventory.
    const darkInventory = createPickupInventory();
    const dark = new ItemWorldFixture(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      { domElement: canvas } as unknown as THREE.WebGLRenderer,
      'images.zip',
      darkInventory,
      '/anim',
      new THREE.Group(),
    );
    cleanups.push(() => {
      dark.dispose();
      darkInventory.dispose();
    });
    const restored = await dark.spawnFromSave(records[0].id, { ...definition, count: 1 }, new THREE.Vector3(8, 0, 9));
    expect(dark.exportRecords()).toEqual([records[0]]);
    expect(declaredLight(restored)).toBeUndefined();
    expect(workTargets('NET', restored)).toEqual([]);
    dark.update(5, new THREE.Quaternion());
    expect(dark.exportRecords()).toHaveLength(1);
  });
});
