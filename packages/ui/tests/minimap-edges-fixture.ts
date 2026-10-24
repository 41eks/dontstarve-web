import { DstMinimapElement } from '../src/minimap';
import { createMinimapTilePainter } from '../src/minimap-terrain';
import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { Vector3 } from 'three';
import { MiniMapEntity } from '../../prefab/src/minimapEntity';

customElements.define('dst-minimap', DstMinimapElement);
const tiles = [];
for (let row = -4; row < 4; row++) for (let col = -4; col < 4; col++) {
  if (col >= -1 && col <= 0 && row >= -1 && row <= 0) continue;
  tiles.push({ col, row, tileId: WORLD_TILES.OCEAN_COASTAL });
}
const terrain = new TurfMap(96, tiles);
terrain.setOriginalTile({ x: -6, z: -6 }, WORLD_TILES.WOODFLOOR);
await terrain.createVisual('/dst/data');
const map = new DstMinimapElement();
const playerIcon = new MiniMapEntity(new Vector3(6, 0, 6));
playerIcon.SetIcon('willow.png');
playerIcon.SetPriority(10);
playerIcon.SetCanUseCache(false);
playerIcon.SetDrawOverFogOfWar(true);
document.body.append(map);
map.bind({ terrain, cellSize: 12, getPlayerPosition: () => playerIcon.position, miniMapEntities: [playerIcon] });
map.setOpen(true);
(window as any).minimapEdges = { terrain, map, playerIcon, createMinimapTilePainter };
