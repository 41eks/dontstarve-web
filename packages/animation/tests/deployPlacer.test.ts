import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { ItemEntity } from '../../inventory/src';
import { prefabDisplay } from '../../display/src';
import { DeployPlacer } from '../../prefab/src/deployPlacer';
import type { DeployPlacerMap } from '../../prefab/src/deployMap';
import { prefabInstance as lookupPrefabInstance } from '../../prefab/src/prefabInstance';
import type { WorldContext } from '../../prefab/src/worldContext';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';

beforeEach(() => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  vi.stubGlobal('window', new EventTarget());
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const settle = () => new Promise(resolve => setTimeout(resolve, 0));
/** An instanced sprite hides its own meshes; the shared batch draws it. */
const ownShown = (model: THREE.Object3D) => {
  let shown = 0;
  model.traverse(object => { if (object instanceof THREE.Mesh && object.visible) shown++; });
  return shown;
};

it('draws a plant placer in its item skin through the shared batches, tinted where it cannot deploy', async () => {
  const world = { scene: new THREE.Scene(), player: new THREE.Group(), camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(), renderer: { domElement: new EventTarget() } } as unknown as WorldContext;
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockImplementation(() => new THREE.Vector3(2, 0, 3));
  let valid = true;
  // plantables.lua dug_berrybush: MakePlacer("dug_berrybush_placer", "berrybush", "berrybush", "dead"), in the held item's skin.
  const item = { prefab: 'dug_berrybush', skinId: 'dug_berrybush_cawnival', isRemoved: false, components: { deployable: {
    usegridplacer: false, placer: { bank: 'berrybush', build: 'berrybush', animation: 'dead' }, CanDeploy: () => valid } } } as unknown as ItemEntity;
  const placer = new DeployPlacer(world, {} as DeployPlacerMap, () => item);
  try {
    placer.update();
    const [preview] = world.scene.children;
    const instance = lookupPrefabInstance(preview)!;
    expect(instance.prefab).toBe('dug_berrybush_placer');
    expect(instance.skinId).toBe('dug_berrybush_cawnival');
    expect(preview.position.toArray()).toEqual([2, 0, 3]);
    expect(instance.sprite.sprite.peek()).toMatchObject({ clip: { name: 'dead', loop: true }, visible: true, lightOverride: 1, colour: [1, 1, 1] });
    await prefabDisplay(preview)!.artLoaded(); await settle();
    expect(ownShown(preview)).toBe(0);

    // The tint is the placer's own AnimState colour; it stays in the batches.
    valid = false; placer.update(); await settle();
    expect(instance.sprite.sprite.peek().colour).toEqual([.75, .25, .25]);
    expect(ownShown(preview)).toBe(0);
  } finally { placer.dispose(); }
  expect(world.scene.children).toHaveLength(0);
});
