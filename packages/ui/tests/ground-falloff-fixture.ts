import * as THREE from 'three';
import { TurfMap } from '../../prefab/src/turfMap';
import { FALLOFF_EDGES, groundFalloffGeometry, loadGroundFalloffAssets, type FalloffEdge } from '../../prefab/src/groundTiles';

const save = await (await fetch('/saves/Cluster_1/Caves.json')).json();
const map = new TurfMap(save.world.map.generator.options.size, save.world.map.tiles, save.world.map.defaultTileId);
const visual = await map.createVisual('/dst/data');
const assets = await loadGroundFalloffAssets('/dst/data');
const scene = new THREE.Scene(); scene.background = new THREE.Color(0);
scene.add(visual, new THREE.AmbientLight(0xffffff, 2));
const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
renderer.setSize(900, 600); document.body.append(renderer.domElement);
const camera = new THREE.PerspectiveCamera(35, 1.5, .1, 5000);
const target = new THREE.WebGLRenderTarget(900, 600);
const cliff = visual.getObjectByName('TurfFalloff') as THREE.Mesh;
const depth = cliff.getObjectByName('TurfFalloff:depth') as THREE.Mesh;
const edges: FalloffEdge[] = [];
for (const { col, row, tileId } of map.exportTiles()) {
  if (tileId === 200) continue;
  FALLOFF_EDGES.forEach(({ dx, dz }, edge) => {
    if (map.isVoidAtCell(col + dx, row + dz)) edges.push({ col, row, edge });
  });
}

function render(reverse: boolean, heading: number, useDepth: boolean): Uint8Array {
  cliff.geometry.dispose();
  cliff.geometry = groundFalloffGeometry(reverse ? [...edges].reverse() : edges, assets);
  depth.geometry = cliff.geometry;
  visual.traverse(object => { if (object.name.endsWith(':depth')) object.visible = useDepth; });
  const angle = heading * Math.PI / 180;
  camera.position.set(6 + Math.cos(angle) * 62, 62, -522 + Math.sin(angle) * 62);
  camera.lookAt(6, 0, -522); camera.updateMatrixWorld();
  renderer.setRenderTarget(target); renderer.render(scene, camera);
  const pixels = new Uint8Array(900 * 600 * 4);
  renderer.readRenderTargetPixels(target, 0, 0, 900, 600, pixels);
  renderer.setRenderTarget(null); renderer.render(scene, camera);
  return pixels;
}

function different(a: Uint8Array, b: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) count++;
  }
  return count;
}

(window as any).falloffTest = {
  compare(heading: number) {
    const normal = render(false, heading, true), reversed = render(true, heading, true);
    const withoutDepth = render(false, heading, false);
    render(false, heading, true);
    return { orderDifferences: different(normal, reversed), occlusionDifferences: different(normal, withoutDepth) };
  },
  preview: () => render(false, 45, true),
};
render(false, 45, true);
