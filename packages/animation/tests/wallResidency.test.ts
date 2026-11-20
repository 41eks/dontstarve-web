import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import { prefabDisplay } from '../../display/src/prefabDisplay';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { SpriteState } from '../../display/src';
import { wallsFixture } from './wallsFixture';
import { bindTestWorld } from './worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { WorldContext } from '../../prefab/src/worldContext';
import { reskinEntity } from '../../prefab/src/reskin_tool';
import { structureHealth } from '../../prefab/src/saveRecord';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })),
}));
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) =>
      new Response(
        await readFile(new URL(`../../../public/dst/data/${String(url).split('dst/data/')[1]}`, import.meta.url)),
      ),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const awake = createSignal(true),
    facing = createSignal(8),
    heading = createSignal(45);
  const world = {
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    cameraFacing: facing,
    cameraHeading: heading,
    ground: new THREE.Group(),
    player: new THREE.Group(),
    physics: new CANNON.World(),
    renderer: { domElement: new EventTarget() },
    tickingarea: () => createMemo(() => awake.get()),
    createCursorLabel: () => ({ show() {}, hide() {}, update() {} }),
    spawnItem: vi.fn((item: unknown) => item),
    dropItem: vi.fn(),
  } as unknown as WorldContext;
  return { world, awake, facing, heading };
}
function meshes(model: THREE.Object3D): THREE.Mesh[] {
  const result: THREE.Mesh[] = [];
  model.traverse(object => {
    if (object instanceof THREE.Mesh) {
      result.push(object);
    }
  });
  return result;
}

it('shares layered wall art, releases only visuals, restores current health/facing/skin, and saves dormant walls', async () => {
  const { world, awake } = setup();
  const scheduler = new GameTimeScheduler(),
    content = bindTestWorld(scheduler);
  const placement = wallsFixture(world, () => false);
  try {
    const record = {
      id: 'wall',
      transform: { position: [3, 0, 6] as [number, number, number], rotationY: 0 },
      components: { health: { current: 200, maximum: 400 } },
    };
    const model = await placement.spawnFromSave('wall_dreadstone', record);
    const other = await placement.spawnFromSave('wall_dreadstone', {
      ...record,
      id: 'other',
      transform: { position: [9, 0, 6], rotationY: 0 },
    });
    await Promise.all(placement.reskinTargets.map(target => prefabDisplay(target.transform.model)!.artLoaded()));
    const instance = lookupPrefabInstance(model)!;
    const controller = instance.sprite;
    expect(controller).toBeInstanceOf(SpriteState);
    const [mesh] = meshes(model),
      [second] = meshes(other);
    expect(mesh.geometry).toBe(second.geometry);
    expect(mesh.geometry.drawRange.count).toBe(12);
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshBasicMaterial;
    const textureDispose = vi.spyOn(material.map!, 'dispose');
    const components = { ...instance.components };
    expect(reskinEntity(placement.reskinTargets[0])).toBe(true);
    const saved = placement.exportRecords();
    const health = instance.components.health!;
    health.SetVal(100);
    awake.set(false);
    await settle();
    expect(controller.loaded).toBe(false);
    expect(meshes(model)).toHaveLength(0);
    expect(placement.renderEntities).toHaveLength(0);
    expect(world.physics!.bodies).toHaveLength(2);
    expect(textureDispose).not.toHaveBeenCalled();
    content.camerarotation.set(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4));
    health.DoDelta(-health.currenthealth);
    await settle();
    expect(world.physics!.bodies).toHaveLength(1);
    expect(structureHealth(placement.exportRecords()[0].record.components)!.current).toBe(0);
    awake.set(true);
    await settle();
    expect(instance.sprite).toBe(controller);
    expect(controller.currentAnimation).toBe('broken');
    expect(meshes(model)[0].geometry.drawRange.count).toBe(12);
    for (const [key, component] of Object.entries(components)) {
      expect(instance.components[key as keyof typeof components]).toBe(component);
    }
    expect(lookupPrefabInstance(model)?.skinId).toBe(saved[0].record.components.wall!.skinId);
    const restored = wallsFixture(world, () => false);
    try {
      const exportRecord = placement.exportRecords()[0];
      await restored.spawnFromSave('wall_dreadstone', exportRecord.record);
      expect(restored.exportRecords()[0]).toEqual(exportRecord);
    } finally {
      restored.dispose();
    }
    placement.dispose();
    await settle();
    expect(textureDispose).toHaveBeenCalledOnce();
    awake.set(false);
    awake.set(true);
    await settle();
    expect(meshes(model)).toHaveLength(0);
  } finally {
    placement.dispose();
    content.unbind();
    scheduler.dispose();
  }
});
