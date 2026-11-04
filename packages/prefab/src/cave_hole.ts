import { SpriteState } from '@dontstarve-web/display';
import { facingFromHeading } from '@dontstarve-web/animation/facing';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { ObjectSpawner } from '../../componets/src/objectspawner';
import { PlayerProx } from '../../componets/src/playerprox';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { Transform } from './transform';

export const CAVE_HOLE_ID = 'cave_hole' as const;
const CAVE_HOLE_SURFACE_ID = 'cave_hole_surface' as const;
const WORLD_SCALE = TILE_SIZE / 4;
const OUTER_RADIUS = 2.75;
const INNER_RADIUS = 1.5;
/**
 * Each eight-faced idle is one drawing turned by the camera's 45-degree step, which keeps it still in the world. These
 * quads already stay still in the world, so they keep the one clip drawn for a camera looking along their up (-z).
 */
const GROUND_FACING = facingFromHeading(90);
/** LAYER_BACKGROUND and LAYER_WORLD_BACKGROUND, both sort order 2: above turf, and the hole above the surface. */
const SURFACE_MESH_ORDER = -.5 + (2 - 3) * .01;
const HOLE_MESH_ORDER = -.4 + (2 - 3) * .01;
const ASSETS = { animationArchive: 'cave_hole.zip', buildArchives: ['cave_hole.zip'], bank: 'cave_hole' };

export interface CaveHoleWorld {
  getWatchWorldContent?: GetWatchWorldContent;
  /** SpawnPrefab for the surface child, whose display loads its art. */
  spawnPrefab(prefab: typeof CAVE_HOLE_SURFACE_ID, position: ReadonlyVector3): PrefabInstance;
}

function declareGroundArt(inst: PrefabInstance, hiddenLayer: string, meshOrder: number): void {
  inst.sprite.hideLayer(hiddenLayer);
  inst.sprite.playOnce('idle'); // PlayAnimation("idle"), never looping.
  inst.sprite.setFacing(GROUND_FACING);
  inst.sprite.setGround(0);
  inst.sprite.setMeshOrder(meshOrder);
}

/** cave_hole.lua fn. Its loot spawning, player flicking and resetruins are callbacks this port leaves out. */
export class CaveHoleInstance extends PrefabInstance {
  /** OnSave / OnLoad; tryspawn is what would clear it. */
  allowspawn = true;

  constructor(world: CaveHoleWorld, position: ReadonlyVector3) {
    super(CAVE_HOLE_ID, new SpriteState({ name: 'idle' }), Transform.stationary());
    // PlayerProx reads the position once.
    this.setPosition(position.x, 0, position.z);
    for (const tag of ['groundhole', 'blocker', 'blinkfocus']) this.addTag(tag);
    this._groundhole_innerradius = INNER_RADIUS * WORLD_SCALE;
    this._groundhole_outerradius = OUTER_RADIUS * WORLD_SCALE;
    this._groundhole_rangeoverride = 0;
    this.deploySmartRadius = 3 * WORLD_SCALE;
    declareGroundArt(this, 'surface', HOLE_MESH_ORDER);

    // CreateSurfaceAnim: a non-networked child that is never saved.
    const surface = world.spawnPrefab(CAVE_HOLE_SURFACE_ID, position);
    surface.entityParent = this as PrefabInstance<SpriteState, object>;

    const playerprox = new PlayerProx({ isValid: () => !this.isRemoved, getPosition: () => this.position }, world.getWatchWorldContent);
    playerprox.SetDist(OUTER_RADIUS * WORLD_SCALE, OUTER_RADIUS * WORLD_SCALE);
    Object.assign(this.components, { objectspawner: new ObjectSpawner(this), playerprox });
    this.onRemove(() => { playerprox.dispose(); surface.remove(); });

    this.OnSave = (_inst, data) => { data.allowspawn = this.allowspawn; };
    this.OnLoad = (_inst, data) => { if (data.allowspawn !== undefined) this.allowspawn = data.allowspawn; };
  }
}

function createSurfaceAnim(): PrefabInstance {
  const inst = new PrefabInstance(CAVE_HOLE_SURFACE_ID, new SpriteState({ name: 'idle' }), Transform.stationary());
  inst.addTag('DECOR');
  inst.addTag('NOCLICK');
  inst.persists = false;
  declareGroundArt(inst, 'hole', SURFACE_MESH_ORDER);
  return inst;
}

/** The Prefab cave_hole.lua returns, and its surface child. */
export function caveHolePrefabs(world: CaveHoleWorld): Readonly<Record<typeof CAVE_HOLE_ID, PrefabEntityDefinition<CaveHoleInstance>>
  & Record<typeof CAVE_HOLE_SURFACE_ID, PrefabEntityDefinition<PrefabInstance>>> {
  return {
    [CAVE_HOLE_ID]: {
      fn: position => new CaveHoleInstance(world, position),
      assets: ASSETS,
      // The source's triangle-mesh doughnut, outer radius 2.75 and height 6, as a solid capsule: its centre cannot be reached from outside.
      physics: { make: MakeObstaclePhysics, radius: OUTER_RADIUS, height: 6 },
      minimapIcon: 'cave_hole.png',
    },
    [CAVE_HOLE_SURFACE_ID]: { fn: createSurfaceAnim, assets: ASSETS, targetable: false },
  };
}
