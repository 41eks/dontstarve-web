import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testItem } from './testInventory';
import { createSignal, GameTimeScheduler } from '../../signals/src';
import { configureWallItemEntity } from '../../prefab/src/walls';
import { ResidentSprite } from '../src/residentSprite';
import { bindTestWorld } from './worldContentFixture';
import { configurePlantableEntity } from '../../prefab/src/plantables';
import { prefabDisplay } from '../../display/src';
import { DeployPlacer } from '../../prefab/src/deployPlacer';
import { createDeployMap } from '../../prefab/src/deployMap';
import { landTurf } from './deployActor';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** An instanced sprite hides its own meshes; the shared batch draws it. */
const ownShown = (model: THREE.Object3D) => {
  let shown = 0;
  model.traverse(object => {
    if (object instanceof THREE.Mesh && object.visible) {
      shown++;
    }
  });
  return shown;
};

function previewWorld(): WorldContext {
  return {
    scene: new THREE.Scene(),
    player: new THREE.Group(),
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    cameraHeading: createSignal(0),
    renderer: { domElement: new EventTarget() },
  } as unknown as WorldContext;
}

it('draws a plant placer in its item skin through the shared batches, tinted where it cannot deploy', async () => {
  const world = previewWorld();
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockImplementation(() => new THREE.Vector3(2, 0, 3));
  let valid = true;
  // plantables.lua dug_berrybush: MakePlacer("dug_berrybush_placer", "berrybush", "berrybush", "dead"), in the held item's skin.
  const item = testItem({ itemId: 'dug_berrybush', count: 1, skinId: 'dug_berrybush_cawnival' });
  configurePlantableEntity(item);
  const map = createDeployMap({
    turf: landTurf({ canDeployPlantAtPoint: () => valid }),
    ents: { FindEntities: () => [], GetEntitiesOnTileAtPoint: () => [] },
  });
  const placer = new DeployPlacer(world, map, () => item);
  try {
    placer.update();
    const [preview] = world.scene.children;
    const instance = lookupPrefabInstance(preview)!;
    expect(instance.prefab).toBe('dug_berrybush_placer');
    expect(instance.skinId).toBe('dug_berrybush_cawnival');
    expect(preview.position.toArray()).toEqual([2, 0, 3]);
    expect(instance.sprite.sprite.value).toMatchObject({
      clip: { name: 'dead', loop: true },
      visible: true,
      lightOverride: 1,
      colour: [1, 1, 1],
    });
    await prefabDisplay(preview)!.artLoaded();
    await settle();
    expect(ownShown(preview)).toBe(0);

    // The tint is the placer's own AnimState colour; it stays in the batches.
    valid = false;
    placer.update();
    await settle();
    expect(instance.sprite.sprite.value.colour).toEqual([0.75, 0.25, 0.25]);
    expect(ownShown(preview)).toBe(0);
  } finally {
    placer.dispose();
    item.remove();
  }
  expect(world.scene.children).toHaveLength(0);
});

it("turns the wall preview to the camera's facing as the shared camera rotates", async () => {
  const world = previewWorld();
  const scheduler = new GameTimeScheduler();
  const content = bindTestWorld(scheduler);
  const item = testItem({ itemId: 'wall_stone_item', count: 1 });
  configureWallItemEntity(item);
  const map = createDeployMap({
    turf: landTurf({}),
    ents: { FindEntities: () => [], GetEntitiesOnTileAtPoint: () => [] },
  });
  const placer = new DeployPlacer(world, map, () => item);
  const facing = vi.spyOn(ResidentSprite.prototype, 'setFacing');
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(new THREE.Vector3(3, 0, 4));
  const rotation = (heading: number) =>
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ((90 - heading) * Math.PI) / 180);
  try {
    content.camerarotation.set(rotation(0));
    placer.update();
    const display = prefabDisplay(world.scene.children[0])!;
    await display.artLoaded();
    const segment = () => display.resolveFrame().map(({ image }) => image.index);
    expect(facing.mock.lastCall?.[0]).toBe(8);
    expect(segment()).toEqual([14]);

    content.camerarotation.set(rotation(45));
    await settle();
    expect(facing.mock.lastCall?.[0]).toBe(128);
    expect(segment()).toEqual([4]);

    const camera = rotation(180);
    content.camerarotation.set(camera);
    await settle();
    expect(facing.mock.lastCall?.[0]).toBe(2);
    expect(segment()).toEqual([14]);
    const changes = facing.mock.calls.length;
    content.camerarotation.set(camera);
    await settle();
    expect(facing.mock.calls).toHaveLength(changes);
  } finally {
    placer.dispose();
    item.remove();
    content.unbind();
    scheduler.dispose();
  }
});
