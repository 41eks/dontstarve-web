// src/building.ts

import { createTurfGround } from '@dontstarve-web/prefab/turf';
import { Pathfinder } from '@dontstarve-web/prefab/pathfinder';
import { TurfMap, WORLD_TILES } from '@dontstarve-web/prefab/turfMap';
import { WorldTopology } from '@dontstarve-web/prefab/topology';
import { GroundDisplay } from '@dontstarve-web/display';
import { initialSave } from './save/initialSave';

const ground = await createTurfGround({
  assetBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
  noiseTexture: 'Ground_noise_deciduous',
  tileAtlas: 'DECIDUOUS',
  size: initialSave.world.map.generator.options.size,
});

export const turfMap = new TurfMap(
  initialSave.world.map.generator.options.size,
  initialSave.world.map.tiles,
  initialSave.world.map.defaultTileId,
);
/** TheWorld.topology and the map's per-tile node IDs. */
export const worldTopology = new WorldTopology(initialSave.world.map.topology);
/** TheWorld.Pathfinder. */
export const pathfinder = new Pathfinder(turfMap);
// The plane remains a pointer target; local maps draw only their saved land cells.
ground.material.visible = turfMap.defaultTileId === WORLD_TILES.DECIDUOUS;
/** The turf layers, cliffs and ocean turfMap declares; edits redraw only the chunks they reach. */
export const groundDisplay = new GroundDisplay(turfMap, `${import.meta.env.BASE_URL}dst/data`);
await groundDisplay.prepare();

export { ground };
