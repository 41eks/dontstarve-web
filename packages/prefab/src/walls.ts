import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import definitions from './definitions.json' with { type: 'json' };
import { WALL_SKIN_ARCHIVES, wallWorldPrefab, wallWorldSkin } from './wallSkins';
import { PlaySound } from './sound';
import { PrefabInstance, type PrefabEntityDefinition, type PrefabEntityManager } from './prefabInstance';
import { Health } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Workable } from '../../componets/src/workable';
import type { BuildingPlacerSpec } from './buildingPlacer';
import { PathfindingWall } from './pathfinder';
import { type EntityPersistData, structureHealth } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import { TILE_SIZE } from './tile';
import { ToolMouseTarget } from './toolMouseTarget';
import type { PrefabWorldContext } from './worldContext';
import {
  wall_stone_init_fn,
  wall_ruins_init_fn,
  wall_moonrock_init_fn,
  wall_dreadstone_init_fn,
  wall_hay_init_fn,
  wall_wood_init_fn,
  type PrefabSkinInitializer,
} from '@dontstarve-web/animation/prefabskin';

/** DST distance unit in world units. */
const UNIT = TILE_SIZE / 4;
/** walls.lua: MakeObstaclePhysics(inst, .5). */
export const WALL_PHYSICS_RADIUS = 0.5 * UNIT;

/** walls.lua anims: thresholds on health percent, low to high. */
const WALL_HEALTH_ANIMS: readonly { threshold: number; anim: string | readonly string[] }[] = [
  { threshold: 0, anim: 'broken' },
  { threshold: 0.4, anim: 'onequarter' },
  { threshold: 0.5, anim: 'half' },
  { threshold: 0.99, anim: 'threequarter' },
  { threshold: 1, anim: ['fullA', 'fullB', 'fullC'] },
];

/** walls.lua resolveanimtoplay; the full variant is stable for a world position in DST units. */
export function resolveWallAnim(percent: number, position: ReadonlyVector3): string {
  for (const { threshold, anim } of WALL_HEALTH_ANIMS) {
    if (percent > threshold) {
      continue;
    }
    if (typeof anim === 'string') {
      return anim;
    }
    const x = Math.floor(position.x / UNIT),
      z = Math.floor(position.z / UNIT);
    const q1 = anim.length + 1,
      q2 = anim.length + 4;
    const mod = (value: number, divisor: number) => value - Math.floor(value / divisor) * divisor;
    return anim[mod(mod(mod(x, q1) * (x + 3), q2) + mod(mod(z, q1) * (z + 3), q2), anim.length)];
  }
  return 'half';
}

/**
 * `wall_*` is the placed world prefab, `wall_*_item` the deployable stack.
 * Both IDs resolve to the constructed wall, matching `prefabs/walls.lua`.
 */
export const WALL_IDS = [
  'wall_stone',
  'wall_stone_item',
  'wall_stone_2',
  'wall_stone_2_item',
  'wall_wood',
  'wall_wood_item',
  'wall_hay',
  'wall_hay_item',
  'wall_ruins',
  'wall_ruins_item',
  'wall_ruins_2',
  'wall_ruins_2_item',
  'wall_moonrock',
  'wall_moonrock_item',
  'wall_dreadstone',
  'wall_dreadstone_item',
  'wall_scrap',
  'wall_scrap_item',
] as const;

export type WallId = (typeof WALL_IDS)[number];
/** The placed `wall_<name>` prefabs MakeWallType returns. */
export type WallPrefabId = Exclude<WallId, `${string}_item`>;
const isWallPrefabId = (id: string): id is WallPrefabId =>
  !id.endsWith('_item') && WALL_IDS.some(known => known === id);
/** The wall a wall_*_item (or the wall itself) builds. */
function wallPrefab(buildId: WallId): WallPrefabId {
  const prefab = wallWorldPrefab(buildId);
  if (!isWallPrefabId(prefab)) {
    throw new Error(`${buildId} builds no wall`);
  }
  return prefab;
}
export const WALL_PREFAB_IDS = WALL_IDS.filter((id): id is WallPrefabId => !id.endsWith('_item'));

export function isWallId(value: string): value is WallId {
  return WALL_IDS.some(wallId => wallId === value);
}

/** A wall's art from definitions.json: its build (SetBuild("wall_"..data.name)) and the bank's animation archive. */
interface WallArt {
  archive: string;
  /** Anim archive of the wall's bank; defaults to `wall.zip`, `wall_dreadstone` has its own bank. */
  animationArchive?: string;
  buildLabel: string;
  /** `AnimState:SetMultColour` RGB, e.g. hay walls' `[0.9, 0.9, 0.9]`. */
  multColour?: readonly number[];
  name: string;
}

/** walls.lua walldata with tuning.lua *WALL_HEALTH / *WALL_PLAYERDAMAGEMOD, as far as it is ported. */
interface WallData {
  name: string;
  tags: readonly string[];
  material: 'wood' | 'stone' | 'straw';
  loot: string;
  maxloots: number;
  maxhealth: number;
  maxwork?: number;
  playerdamagemod?: number;
}

const WALL_DATA: Readonly<Record<WallPrefabId, WallData>> = {
  wall_stone: { name: 'stone', tags: ['stone'], material: 'stone', loot: 'rocks', maxloots: 2, maxhealth: 400 },
  wall_stone_2: { name: 'stone_2', tags: ['stone'], material: 'stone', loot: 'rocks', maxloots: 2, maxhealth: 400 },
  wall_wood: { name: 'wood', tags: ['wood'], material: 'wood', loot: 'log', maxloots: 2, maxhealth: 200 },
  wall_hay: { name: 'hay', tags: ['grass'], material: 'straw', loot: 'cutgrass', maxloots: 2, maxhealth: 100 },
  wall_ruins: {
    name: 'ruins',
    tags: ['stone', 'ruins'],
    material: 'stone',
    loot: 'thulecite_pieces',
    maxloots: 2,
    maxhealth: 800,
  },
  wall_ruins_2: {
    name: 'ruins_2',
    tags: ['stone', 'ruins'],
    material: 'stone',
    loot: 'thulecite_pieces',
    maxloots: 2,
    maxhealth: 800,
  },
  wall_moonrock: {
    name: 'moonrock',
    tags: ['stone', 'moonrock'],
    material: 'stone',
    loot: 'moonrocknugget',
    maxloots: 2,
    maxhealth: 600,
    maxwork: 25,
    playerdamagemod: 0.25,
  },
  wall_dreadstone: {
    name: 'dreadstone',
    tags: ['stone', 'dreadstone'],
    material: 'stone',
    loot: 'dreadstone',
    maxloots: 2,
    maxhealth: 800,
    maxwork: 25,
    playerdamagemod: 0.25,
  },
  wall_scrap: {
    name: 'scrap',
    tags: ['stone', 'scrap'],
    material: 'stone',
    loot: 'wagpunk_bits',
    maxloots: 1,
    maxhealth: 600,
    maxwork: 10,
    playerdamagemod: 0.25,
  },
};

const WALL_SKIN_INITIALIZERS: Readonly<Record<string, PrefabSkinInitializer>> = {
  wall_stone: wall_stone_init_fn,
  wall_ruins: wall_ruins_init_fn,
  wall_moonrock: wall_moonrock_init_fn,
  wall_dreadstone: wall_dreadstone_init_fn,
  wall_hay: wall_hay_init_fn,
  wall_wood: wall_wood_init_fn,
};

/** The skin builds a wall's display loads: each source skin's own build, as its prefabskin init_fn names it. */
function skinArchives(prefab: WallPrefabId): Readonly<Record<string, string>> {
  const init = WALL_SKIN_INITIALIZERS[prefab];
  return Object.fromEntries(
    Object.entries(WALL_SKIN_ARCHIVES[prefab] ?? {}).map(([id, archive]) => [id, init?.(id).skinArchive ?? archive]),
  );
}

/** MakeWallType's `bank`: dreadstone has its own, every other wall the shared `wall` bank of wall.zip. */
function wallAssets(prefab: WallPrefabId, art: WallArt) {
  return {
    animationArchive: art.animationArchive ?? 'wall.zip',
    buildArchives: [art.archive],
    bank: prefab === 'wall_dreadstone' ? 'wall_dreadstone' : 'wall',
  };
}

/**
 * Transform:SetEightFaced() at rotation 0: the archive sprite picks each clip's facing from the camera heading. SetMultColour,
 * for the hay wall, needs the sprite's own material copies (its assetOptions' colour).
 */
function declareWallArt(inst: PrefabInstance, art: WallArt): void {
  inst.sprite.setFacingRotation(0);
  if (art.multColour) {
    inst.sprite.setColour(art.multColour);
  }
}

export class WallInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    health: Health;
    combat: Combat;
    lootdropper: LootDropper;
    workable: Workable;
    inspectable: Inspectable;
  };
  /** inst._ispathfinding. */
  declare _ispathfinding: boolean;
  /** inst._pfpos: the Pathfinder wall it registered, once InitializePathFinding listens. */
  declare _pfwall: PathfindingWall | undefined;
}

/** OnIsPathFindingDirty. */
function OnIsPathFindingDirty(inst: WallInstance): void {
  inst._pfwall?.set(inst._ispathfinding);
}

/** InitializePathFinding: delayed so the wall is at its position before it is added. */
function InitializePathFinding(inst: WallInstance): void {
  inst._pfwall = new PathfindingWall(inst.worldServices?.pathfinder, () => inst.position);
  OnIsPathFindingDirty(inst);
}

function makeobstacle(inst: WallInstance): void {
  inst.physics.SetActive(true);
  inst._ispathfinding = true;
  OnIsPathFindingDirty(inst);
}

function clearobstacle(inst: WallInstance): void {
  inst.physics.SetActive(false);
  inst._ispathfinding = false;
  OnIsPathFindingDirty(inst);
}

function onhealthchange(inst: WallInstance, old_percent: number, new_percent: number): void {
  const anim_to_play = resolveWallAnim(new_percent, inst.position);
  if (new_percent > 0) {
    if (old_percent <= 0) {
      makeobstacle(inst);
    }
    inst.sprite.playOnce(`${anim_to_play}_hit`);
    inst.sprite.pushAnimation(anim_to_play, false);
  } else {
    if (old_percent > 0) {
      clearobstacle(inst);
    }
    inst.sprite.playOnce(anim_to_play);
  }
}

function keeptargetfn(): boolean {
  return false;
}

/**
 * onload: a dead wall clears its obstacle. This project's record keeps health as `{ current, maximum }` under `health`,
 * which health:OnLoad reads here; the loaded health is shown as onhealthchange would.
 */
function onload(inst: WallInstance, data: EntityPersistData): void {
  const { health } = inst.components;
  const saved = structureHealth(data);
  if (saved) {
    health.OnLoad({ health: saved.current, maxhealth: saved.maximum });
  }
  inst.sprite.playOnce(resolveWallAnim(health.GetPercent(), inst.position));
  if (health.IsDead()) {
    clearobstacle(inst);
  }
}

/** The record's `health` entry, in place of health:OnSave's own shape. */
function onsave(inst: WallInstance, data: EntityPersistData): void {
  const { health } = inst.components;
  data.health = { current: health.currenthealth, maximum: health.maxhealth };
}

function onremove(inst: WallInstance): void {
  inst._ispathfinding = false;
  OnIsPathFindingDirty(inst);
}

/** MakeWallType(data): the placed wall, its deployable item's ondeploywall and its placer. */
function MakeWallType(prefab: WallPrefabId, data: WallData, art: WallArt, world: PrefabWorldContext) {
  /** fence_item-style SpawnPrefab("wall_"..data.name, linked skin) at the wall slot; consuming the item is the build flow's. */
  function ondeploywall(
    prefabs: Pick<PrefabEntityManager<string, PrefabInstance>, 'spawnAs'>,
    pt: ReadonlyVector3,
    skinId?: string,
  ): WallInstance {
    return prefabs.spawnAs(WallInstance, prefab, pt, undefined, skinId);
  }

  /** onhammered: condition-scaled loot, collapse_small with the wall's material, then Remove. */
  function onhammered(inst: WallInstance): void {
    const num_loots = Math.max(1, Math.floor(data.maxloots * inst.components.health.GetPercent()));
    for (let i = 0; i < num_loots; i++) {
      inst.components.lootdropper.SpawnLootPrefab(data.loot);
    }
    inst.worldServices?.fx?.collapse?.('small', inst.position, data.material);
    inst.remove();
  }

  function onhit(inst: WallInstance): void {
    PlaySound(`dontstarve/common/destroy_${data.material}`, inst.position);
    const healthpercent = inst.components.health.GetPercent();
    if (healthpercent > 0) {
      const anim_to_play = resolveWallAnim(healthpercent, inst.position);
      inst.sprite.playOnce(`${anim_to_play}_hit`);
      inst.sprite.pushAnimation(anim_to_play, false);
    }
  }

  function fn(): WallInstance {
    const inst = new WallInstance(prefab, new SpriteState({ name: 'half', held: true, billboard: true }));
    inst.worldServices = world;
    declareWallArt(inst, art);
    for (const tag of ['wall', 'noauradamage', 'electricdamageimmune', ...data.tags]) {
      inst.addTag(tag);
    }
    inst._pfwall = undefined;
    inst._ispathfinding = false;
    makeobstacle(inst);
    // Delay this because makeobstacle sets pathfinding on by default, but it is handled once the position is set.
    inst.DoTaskInTime(0, InitializePathFinding);
    inst.onRemove(() => onremove(inst));

    addComponent(inst, 'inspectable', Inspectable);
    addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
    const combat = addComponent(inst, 'combat', Combat, () => inst.worldServices?.scheduler?.now ?? 0);
    combat.SetKeepTargetFunction(keeptargetfn);
    combat.onhitfn = onhit;
    const health = addComponent(inst, 'health', Health, data.maxhealth);
    health.SetCurrentHealth(data.maxhealth * 0.5);
    health.ondelta = onhealthchange;
    health.nofadeout = true;
    health.canheal = false;
    if (data.playerdamagemod !== undefined) {
      health.SetAbsorptionAmountFromPlayer(data.playerdamagemod);
    }
    const workable = addComponent(inst, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(data.maxwork ?? 3);
    workable.SetOnFinishCallback(onhammered);
    workable.SetOnWorkCallback(onhit);
    inst.onRemove(() => {
      combat.onhitfn = undefined;
    });
    // The half-health anim of a new wall.
    inst.sprite.playOnce(resolveWallAnim(health.GetPercent(), inst.position));
    inst.OnLoad = onload;
    inst.OnSave = onsave;
    return inst;
  }

  const skins = skinArchives(prefab);
  const definition: PrefabEntityDefinition<WallInstance> = {
    fn,
    assets: wallAssets(prefab, art),
    // Every health anim and its _hit rests on its last frame: all of them are drawn by the shared batches.
    assetOptions: { instancedAnimations: 'all', ...(art.multColour ? { colour: [1, 1, 1] as const } : {}) },
    skins,
    // MakeObstaclePhysics(inst, .5); inst.Physics:SetDontRemoveOnSleep(true).
    physics: { make: (inst, radius) => MakeObstaclePhysics(inst, radius).SetDontRemoveOnSleep(true), radius: 0.5 },
    onSpawned: inst => {
      new ToolMouseTarget(inst, world.handEquipment);
    },
  };

  /** MakePlacer("wall_"..data.name.."_item_placer", bank, "wall_"..data.name, "half", ..., snap, ..., "eight"). */
  const placer = (buildId: WallId, snap: BuildingPlacerSpec['snap']): BuildingPlacerSpec => ({
    buildLabel: art.buildLabel,
    name: art.name,
    animation: 'half',
    snap,
    art: (resources: SpriteResources, skinId?: string) => ({
      archive: wallAssets(prefab, art),
      initialize: entity => {
        entity.skinId = wallWorldSkin(buildId, skinId);
        entity.sprite.setSkinSource({ art: resources.archives, archives: skins });
        declareWallArt(entity, art);
      },
    }),
  });

  return { definition, ondeploywall, placer };
}

const WALL_ART: Readonly<Record<WallPrefabId, WallArt>> = definitions.walls;

/** The Prefab list walls.lua returns, for the placed walls; the items are ground and inventory items. */
export function wallPrefabs(world: PrefabWorldContext) {
  const types = Object.fromEntries(
    WALL_PREFAB_IDS.map(prefab => [prefab, MakeWallType(prefab, WALL_DATA[prefab], WALL_ART[prefab], world)]),
  ) as Record<WallPrefabId, ReturnType<typeof MakeWallType>>;
  return {
    prefabs: Object.fromEntries(WALL_PREFAB_IDS.map(prefab => [prefab, types[prefab].definition])) as Readonly<
      Record<WallPrefabId, PrefabEntityDefinition<WallInstance>>
    >,
    /** wall_*_item's placer, or the wall's own when it is built by its world ID. */
    placer: (buildId: WallId, snap: BuildingPlacerSpec['snap']) => types[wallPrefab(buildId)].placer(buildId, snap),
    /** wall_*_item's deployable ondeploywall, with the item's skin linked to the wall's. */
    ondeploywall: (
      prefabs: Pick<PrefabEntityManager<string, PrefabInstance>, 'spawnAs'>,
      buildId: WallId,
      pt: ReadonlyVector3,
      skinId?: string,
    ) => types[wallPrefab(buildId)].ondeploywall(prefabs, pt, wallWorldSkin(buildId, skinId)),
  };
}
