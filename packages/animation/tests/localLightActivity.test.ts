import { useTestTileMap } from './tileMapFixture';
import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createSignal, type Memo, type TileStateQuery } from '@dontstarve-web/signals';
import { DisposeTileStates, GetTileStateAtPoint } from '../../componets/src/tileManager';
import { getPrefabLocalLight, setPrefabLocalLight } from '../../prefab/src/localLight';
import { DstLocalLighting } from '../../../src/dstLocalLighting';

useTestTileMap();

it('gates lightmap sources and CPU samples by shared world-space tiles, restores lights and releases tile watches', async () => {
  const player = createSignal<THREE.Vector3 | undefined>(new THREE.Vector3());
  const query = GetTileStateAtPoint(player), memos: Memo<boolean>[] = [];
  const tickingarea: TileStateQuery = vi.fn((tile, radius) => {
    const memo = query(tile, radius);
    if (memo) { vi.spyOn(memo, 'dispose'); memos.push(memo); }
    return memo;
  });
  const lighting = new DstLocalLighting(tickingarea), scene = new THREE.Scene();
  const parent = new THREE.Group(); parent.position.x = 120; scene.add(parent);
  const near = new THREE.Object3D(), far = new THREE.Object3D(), sameTile = new THREE.Object3D();
  near.position.x = 11.9; far.position.x = 12.1; parent.add(near, far);
  sameTile.position.x = 130; scene.add(sameTile);
  const outsideGrid = new THREE.Object3D(), detached = new THREE.Object3D();
  outsideGrid.position.x = 1000; scene.add(outsideGrid);
  const red = { radius: 4, intensity: .2, falloff: 1, colour: [1, 0, 0] as const };
  for (const owner of [near, sameTile, outsideGrid, detached]) setPrefabLocalLight(owner, red);
  setPrefabLocalLight(far, { ...red, colour: [0, 1, 0] });
  let sources = 0;
  const renderer = {
    autoClear: false,
    getRenderTarget: () => null,
    setRenderTarget: vi.fn(),
    render: (lightScene: THREE.Scene) => {
      const mesh = lightScene.children[1] as THREE.Mesh<THREE.InstancedBufferGeometry>;
      sources = mesh.geometry.instanceCount;
    },
  } as unknown as THREE.WebGLRenderer;
  const sample = new THREE.Vector3(132, 0, 0);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const renderLightmap = () => {
    scene.updateMatrixWorld();
    lighting.renderLightmap(renderer, scene);
  };
  try {
    const query = vi.spyOn(near, 'getWorldPosition');
    renderLightmap();
    expect(query).not.toHaveBeenCalled(); // Rendering consumes the settled world matrices.
    query.mockRestore();
    expect(sources).toBe(2); // Tile 10 is active; tile 11, detached and out-of-grid lights are excluded.
    expect(lighting.sampleLightLevel(sample)).toBeCloseTo(.4 * .2126);
    expect(tickingarea).toHaveBeenCalledTimes(2); // Rendering, sampling and same-tile owners share watches.
    const extents = lighting.getRenderPassLighting().extents;
    expect(extents.x).toBeCloseTo(118);
    expect(1 / extents.z).toBeCloseTo(25.9); // Inactive sources do not expand the lightmap.

    player.set(new THREE.Vector3(12, 0, 0)); await settle();
    renderLightmap();
    expect(sources).toBe(3);
    expect(lighting.sampleLightLevel(sample)).toBeCloseTo(.4 * .2126 + .2 * .7152);
    expect(getPrefabLocalLight(far)?.intensity).toBe(.2);
    expect(tickingarea).toHaveBeenCalledTimes(2);

    player.set(new THREE.Vector3()); await settle();
    near.position.x = 24.1; // Moving a child must query its new world tile, not its local tile.
    renderLightmap();
    expect(sources).toBe(1);
    expect(lighting.sampleLightLevel(sample)).toBeCloseTo(.2 * .2126);
    expect(tickingarea).toHaveBeenCalledTimes(3);
    near.position.x = 11.9;
    renderLightmap();
    expect(sources).toBe(2);
    expect(tickingarea).toHaveBeenCalledTimes(3);

    player.set(undefined); await settle();
    renderLightmap();
    expect(sources).toBe(0);
    expect(lighting.sampleLightLevel(sample)).toBe(0);
    lighting.dispose(); lighting.dispose();
    for (const memo of memos) expect(memo.dispose).toHaveBeenCalledOnce();
    // Disposal removes both each memo's grid dependencies and the local watch bridge.
    const reads = memos.map(memo => vi.spyOn(memo, 'get'));
    player.set(new THREE.Vector3(12, 0, 0)); await settle();
    for (const read of reads) expect(read).not.toHaveBeenCalled();
  } finally {
    lighting.dispose();
    for (const owner of [near, far, sameTile, outsideGrid, detached]) setPrefabLocalLight(owner, null);
    scene.clear(); DisposeTileStates(player);
    vi.restoreAllMocks();
  }
});
