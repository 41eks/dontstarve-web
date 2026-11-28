import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { DstMinimapElement } from '../../packages/ui/src/minimap';
import { TurfMap, WORLD_TILES } from '../../packages/prefab/src/turfMap';
import { GroundDisplay } from '../../packages/display/src/groundDisplay';
import { createTurfGround } from '../../packages/prefab/src/turf';
import { Vector3, WebGLRenderer, Scene, AmbientLight } from 'three';
import { MiniMapEntity } from '../../packages/prefab/src/minimapEntity';
import { BindTileMapSize } from '../../packages/componets/src/tileManager';

customElements.define('dst-minimap', DstMinimapElement);
const tiles = [];
for (let row = -4; row < 4; row++) {
  for (let col = -4; col < 4; col++) {
    if (col >= -1 && col <= 0 && row >= -1 && row <= 0) {
      continue;
    }
    tiles.push({ col, row, tileId: WORLD_TILES.OCEAN_COASTAL });
  }
}
const terrain = new TurfMap(96, tiles);
terrain.setOriginalTile({ x: -6, z: -6 }, WORLD_TILES.WOODFLOOR);
const groundDisplay = new GroundDisplay(terrain, '/dst/data');
await groundDisplay.prepare();
const ground = await createTurfGround({
  assetBaseUrl: '/dst/data',
  noiseTexture: 'Ground_noise_deciduous',
  tileAtlas: 'DECIDUOUS',
  size: 96,
});
const scene = new Scene();
scene.add(ground, groundDisplay.root, new AmbientLight(0xffffff, 1));
const renderer = new WebGLRenderer({ alpha: true });
const map = new DstMinimapElement();
BindTileMapSize(96);
const playerIcon = new MiniMapEntity(new Vector3(6, 0, 6));
playerIcon.SetIcon('willow.png');
playerIcon.SetPriority(10);
playerIcon.SetCanUseCache(false);
playerIcon.SetDrawOverFogOfWar(true);
document.body.append(map);
const heading = createSignal(-90);
map.bind({
  terrain,
  cellSize: 12,
  getPlayerPosition: () => playerIcon.position,
  cameraHeading: readonlySignal(heading),
});
await map.prepareTerrain();
map.setOpen(true);
(window as any).minimapEdges = {
  terrain,
  map,
  playerIcon,
  heading,
  renderer,
  scene,
  ground,
  groundDisplay,
  GroundDisplay,
  WORLD_TILES,
};
