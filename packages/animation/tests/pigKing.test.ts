import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PigKingManager } from '../../prefab/src/pigking';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';
import { TILE_SIZE, snapToTileCenter } from '../../prefab/src/tile';
import { placeStaticLayout } from '../../prefab/src/staticLayout';
import { setSpriteEntityRenderOrder } from '../src/renderOrder';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const bytes = await readFile(new URL(`../../../public${url}`, import.meta.url));
    return new Response(bytes);
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Pig King prefab', () => {
  it.each([
    new THREE.Vector3(-13, 2, -25),
    new THREE.Vector3(12, 0, 0),
  ])('stands on its feet with obstacle physics, faces the camera and restores its identity at %s', async (feet) => {
    const scheduler = new GameTimeScheduler(), physics = new CANNON.World();
    const world = bindTestWorld(scheduler);
    const kings = new PigKingManager(new THREE.Scene(), '/dst/data/anim', { camera: new THREE.PerspectiveCamera(), scheduler, physics, dropLoot: vi.fn() });
    try {
      const standee = await kings.spawn(feet.clone());
      await new Promise(resolve => setTimeout(resolve, 0));
      const body = kings.get(standee)!.instance.physicsBody!;
      expect(standee.position.toArray()).toEqual(feet.toArray());
      // pigking.lua MakeObstaclePhysics(inst, 2, .5): a static capsule on the feet origin.
      expect(physics.bodies).toContain(body);
      expect(body.position.toArray()).toEqual([feet.x, feet.y + 0.75, feet.z]);
      expect(body.shapes.some(shape => shape instanceof CANNON.Sphere && shape.radius === 6)).toBe(true);
      expect(standee.userData.instance?.getPhysicsRadius(undefined)).toBe(6);
      expect(new THREE.Box3().setFromObject(standee).min.y).toBeCloseTo(feet.y);
      // The prefab owns no terrain: pigking.lua adds no turf, the world layout does.
      expect(standee.children.every(child => child.name !== 'PigKingFloor')).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
      setSpriteEntityRenderOrder(standee, 9);
      // The display root holds the drawn sprite, whose art group is the registered render group.
      expect(standee.children[0].children[0].renderOrder).toBe(9);
      // A billboard: the display turns the king to TheCamera itself.
      const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), .6);
      world.camerarotation.set(rotation);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(standee.quaternion.equals(rotation)).toBe(true);
      kings.update(0.1);

      const [saved] = kings.exportRecords();
      expect(saved).toEqual({ prefabId: 'pigking', record: { id: standee.userData.instance?.entityId,
        transform: { position: [feet.x, 0, feet.z], rotationY: 0 }, components: {} } });
      kings.dispose();
      expect(physics.bodies).not.toContain(body);
      expect(standee.parent).toBeNull();
      const restored = new PigKingManager(new THREE.Scene(), '/dst/data/anim', { camera: new THREE.PerspectiveCamera(), scheduler, physics, dropLoot: vi.fn() });
      const copy = await restored.spawn(new THREE.Vector3(...saved.record.transform.position), saved.record);
      expect(copy.userData.instance?.entityId).toBe(saved.record.id);
      expect(restored.exportRecords()).toEqual([saved]);
      restored.dispose();
    } finally { kings.dispose(); world.unbind(); scheduler.dispose(); }
  });
});

describe('default_pigking static layout', () => {
  it('places the BG_TILES octagon around the nearest tile corner and the rocks as authored', () => {
    const layout = placeStaticLayout('default_pigking', { x: 0, z: 25 }, 'pigking');
    // The 8x8 ground sampled from the 32x32 layer: 40 grass tiles around a core of 12 woodfloor tiles.
    expect(layout.tiles.filter(({ tile }) => tile === 'GRASS')).toHaveLength(40);
    const wood = layout.tiles.filter(({ tile }) => tile === 'WOODFLOOR');
    expect(wood).toHaveLength(12);
    expect(new Set(layout.tiles.map(({ position }) => `${position.x},${position.z}`)).size).toBe(52);
    for (const { position } of layout.tiles) {
      expect(snapToTileCenter(position)).toEqual(position);
      expect(Math.abs(position.x)).toBeLessThan(4 * TILE_SIZE);
      expect(Math.abs(position.z - 24)).toBeLessThan(4 * TILE_SIZE);
    }
    for (const { position } of wood) {
      expect(Math.abs(position.x)).toBeLessThan(2 * TILE_SIZE);
      expect(Math.abs(position.z - 24)).toBeLessThan(2 * TILE_SIZE);
    }
    // The pigking is the anchor: only the rocks are separate entities.
    expect(layout.objects.map(object => object.prefab).sort())
      .toEqual([...Array(4).fill('insanityrock'), ...Array(4).fill('sanityrock')]);
    const insanity = layout.objects.filter(object => object.prefab === 'insanityrock')
      .map(({ position }) => [position.x, position.z]);
    // Authored offsets in tile units: (-2.125, .125), (-.125, -2.125), (.0625, 2.171875), (2.125, .125).
    expect(insanity).toContainEqual([-2.125 * TILE_SIZE, 24 + .125 * TILE_SIZE]);
    expect(insanity).toContainEqual([2.125 * TILE_SIZE, 24 + .125 * TILE_SIZE]);
  });
});
