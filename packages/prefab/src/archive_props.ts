import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { createRenderEffect, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { actionEntity } from './actionEntity';
import { addComponent } from './components';
import { Transform } from './transform';
import type { SpawnGroundItem } from './groundPrefab';
import type { WorldFx } from './world_fx';
import catalog from './groundItems.json' with { type: 'json' };

export const ARCHIVE_MOON_STATUE_ID = 'archive_moon_statue' as const;
export const ARCHIVE_RUNE_STATUE_ID = 'archive_rune_statue' as const;
export const ARCHIVE_PORTAL_ID = 'archive_portal' as const;
export const ARCHIVE_SWITCH_BASE_ID = 'archive_switch_base' as const;
export const ARCHIVE_SWITCH_PAD_ID = 'archive_switch_pad' as const;
export const ARCHIVE_AMBIENT_SFX_ID = 'archive_ambient_sfx' as const;
/** CreateDropShadow's unnamed child of the portal. */
const ARCHIVE_PORTAL_SHADOW_ID = 'archive_portal_shadow' as const;
/** Prefabs that persist: archive_switch_pad has `persists = false` and the rubble worldgen items remove themselves. */
export const ARCHIVE_PROP_IDS = [ARCHIVE_MOON_STATUE_ID, ARCHIVE_RUNE_STATUE_ID, ARCHIVE_PORTAL_ID, ARCHIVE_SWITCH_BASE_ID,
  ARCHIVE_AMBIENT_SFX_ID] as const;
export const ARCHIVE_PROP_SPAWN_IDS = [...ARCHIVE_PROP_IDS, ARCHIVE_SWITCH_PAD_ID, 'rubble1', 'rubble2'] as const;
export type ArchivePropId = typeof ARCHIVE_PROP_IDS[number];
type ArchivePropPrefabId = typeof ARCHIVE_PROP_SPAWN_IDS[number] | typeof ARCHIVE_PORTAL_SHADOW_ID;

const MOON_STATUE_VARIANTS = 4;
const RUNE_STATUE_VARIANTS = 3;
const NUM_STORY_LINES = 5;
/** tuning.lua MARBLEPILLAR_MINE. */
export const MARBLEPILLAR_MINE = 10;
const PHYSICS_RADIUS = .66;
// archive_props.lua SetSharedLootTable('archive_statues', ...)
SetSharedLootTable('archive_statues', [['thulecite', 1], ['moonrocknugget', 1], ['moonrocknugget', .05]]);
const BACKGROUND_RENDER_ORDER = -.5;

/** archive_props.lua OnSave: statues and rune statues write `anim`; rune statues add `storyprogress` once it is assigned. */
export interface ArchivePropSaveState { anim?: number; storyprogress?: number; }

export interface ArchivePropsWorld extends ToolMouseTargetWorld {
  /** worldgenitemfn's DoTaskInTime(0). */
  scheduler: Pick<GameTimeScheduler, 'schedule'>;
  /** FACING_* bit that the camera heading gives an eight-faced inst with rotation 0. */
  cameraFacing?: ReadonlySignal<number>;
  /** lootdropper:SpawnLootPrefab when a statue is mined out; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
  /** SpawnAt("collapse_small") and SetMaterial when a statue is mined out. */
  fx: Pick<WorldFx, 'collapse'>;
  /** CreateDropShadow: the portal's child, whose display loads its art. */
  spawnPrefab(prefab: typeof ARCHIVE_PORTAL_SHADOW_ID, position: ReadonlyVector3): PrefabInstance;
}

const archive = (name: string, bank: string, hiddenSymbols?: string[]) =>
  ({ animationArchive: `${name}.zip`, buildArchives: [`${name}.zip`], bank, ...hiddenSymbols ? { hiddenSymbols } : {} });

/**
 * AnimState:SetOrientation(OnGround) and SetLayer(LAYER_BACKGROUND): flat art drawn under the world. Background decals
 * share one layer, where the source sort order (and FinalOffset) breaks ties.
 */
function layOnGround(inst: PrefabInstance, sortOrder: number, finalOffset = 0): void {
  inst.sprite.setGround(BACKGROUND_RENDER_ORDER + (sortOrder - 3) * .01 + finalOffset * .001);
}

/** Transform:SetEightFaced: a rotation-0 inst shows the facing the camera heading selects. */
function SetEightFaced(inst: PrefabInstance, cameraFacing: ReadonlySignal<number> | undefined): void {
  if (!cameraFacing) return;
  let stopWatching: (() => void) | undefined;
  const facing = watchSignal(cameraFacing, stop => { stopWatching = stop; });
  const stopFacing = createRenderEffect(() => inst.sprite.setFacing(facing.get()));
  inst.onRemove(() => { stopFacing(); stopWatching?.(); });
}

/** ShowWorkState: low under a third of the work, med under two thirds, otherwise full; looping. */
function ShowWorkState(inst: ArchiveMoonStatueInstance, _worker: unknown, workleft: number): void {
  inst.sprite.start(`${workleft < MARBLEPILLAR_MINE / 3 ? 'idle_low_' : workleft < MARBLEPILLAR_MINE * 2 / 3 ? 'idle_med_' : 'idle_full_'}${inst.anim}`);
}

function setminimapiconstatue(inst: ArchiveMoonStatueInstance): void {
  inst.minimap.SetIcon(`archive_moon_statue${inst.anim}.png`);
}

/** statuefn. MakeHauntableWork is not wired. */
export class ArchiveMoonStatueInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { lootdropper: LootDropper };
  anim: number;

  constructor(world: ArchivePropsWorld) {
    super(ARCHIVE_MOON_STATUE_ID, new SpriteState({ name: 'idle_full_1', billboard: true }), Transform.stationary());
    for (const tag of ['structure', 'statue', 'dustable']) this.addTag(tag);
    this.anim = 1 + Math.floor(Math.random() * MOON_STATUE_VARIANTS);
    this.sprite.playOnce(`idle_full_${this.anim}`); // PlayAnimation, never looping.

    const workable = addComponent(this as ArchiveMoonStatueInstance, 'workable');
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(MARBLEPILLAR_MINE);
    workable.SetOnWorkCallback(ShowWorkState);
    workable.SetOnFinishCallback(() => {
      // OnWorkFinished: DropLoot at the statue, collapse_small with the rock material, then Remove.
      this.components.lootdropper.DropLoot(this.position);
      world.fx.collapse('small', this.position, 'rock');
      this.remove();
    });
    const lootdropper = new LootDropper(this, (prefab, position) => world.spawnGroundItem(
      { ...catalog.items[prefab as keyof typeof catalog.items], itemId: prefab, count: 1 },
      new THREE.Vector3(position.x, position.y, position.z), { fling: true }));
    lootdropper.SetChanceLootTable('archive_statues');
    Object.assign(this.components, { lootdropper });
    setminimapiconstatue(this);

    // workable.savestate is false: a surviving statue reloads with its full work count.
    this.OnSave = (_inst, data) => { data.archiveProp = { anim: this.anim }; };
    // onloadpostpass: a loaded statue shows its work state, looping.
    this.OnLoad = (_inst, data) => {
      if (data.archiveProp?.anim !== undefined) this.anim = data.archiveProp.anim;
      setminimapiconstatue(this);
      ShowWorkState(this, undefined, workable.GetWorkLeft());
    };
  }
}

const runeAnimation = (anim: number) => anim === 1 ? 'idle' : `idle${anim}`;

/** runefn: ancient_text statue whose story line is assigned on first inspection and saved. */
export class ArchiveRuneStatueInstance extends PrefabInstance {
  anim: number;
  storyprogress?: number;

  constructor(story: { progress: number }) {
    super(ARCHIVE_RUNE_STATUE_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
    for (const tag of ['structure', 'statue', 'dustable', 'ancient_text']) this.addTag(tag);
    this.anim = 1 + Math.floor(Math.random() * RUNE_STATUE_VARIANTS);
    this.sprite.playOnce(runeAnimation(this.anim));

    // rune_AdvanceStory: `story` is the module-level `_storyprogress`, one per world.
    const advance = () => {
      if (this.storyprogress === undefined) {
        story.progress = story.progress % NUM_STORY_LINES + 1;
        this.storyprogress = story.progress;
      }
    };
    Object.assign(this.components, { inspectable: {
      /** getstatus: `LINE_<n>`, advancing the story on first use. */
      getstatus: () => { advance(); return `LINE_${this.storyprogress}`; },
      /** rune_getdescription: only a viewer holding an ancient_reader gets the line's text key. */
      descriptionfn: (viewer: { components?: { inventory?: { EquipHasTag(tag: string): boolean } } }) => {
        if (!viewer.components?.inventory?.EquipHasTag('ancient_reader')) return undefined;
        advance();
        return `LINE_${this.storyprogress}`;
      },
    } });

    this.OnSave = (_inst, data) => {
      data.archiveProp = { anim: this.anim, ...this.storyprogress === undefined ? {} : { storyprogress: this.storyprogress } };
    };
    this.OnLoad = (_inst, data) => {
      const saved = data.archiveProp;
      if (!saved) return;
      if (saved.storyprogress !== undefined) {
        this.storyprogress = saved.storyprogress;
        story.progress = Math.max(story.progress, saved.storyprogress);
      }
      if (saved.anim !== undefined) {
        this.anim = saved.anim;
        const anim = runeAnimation(this.anim);
        if (this.sprite.currentAnimation !== anim) this.sprite.playOnce(anim);
      }
    };
  }
}

/** portalfn. The POWEROFF status and ms_register_vault_lobby_exit_target need the archive manager. */
function portalfn(world: ArchivePropsWorld, position: ReadonlyVector3): PrefabInstance {
  const inst = new PrefabInstance(ARCHIVE_PORTAL_ID, new SpriteState({ name: 'idle' }), Transform.stationary());
  SetEightFaced(inst, world.cameraFacing);
  inst.sprite.playOnce('idle');
  layOnGround(inst, 1, 2);
  inst.addTag('groundhole');
  inst.addTag('blocker');
  const shadow = world.spawnPrefab(ARCHIVE_PORTAL_SHADOW_ID, position);
  shadow.entityParent = inst as PrefabInstance<SpriteState, object>;
  inst.onRemove(() => shadow.remove());
  return inst;
}

/** CreateDropShadow: a DECOR | NOCLICK child that sorts just under the portal art (SortOrder 1, no FinalOffset). */
function CreateDropShadow(world: ArchivePropsWorld): PrefabInstance {
  const inst = new PrefabInstance(ARCHIVE_PORTAL_SHADOW_ID, new SpriteState({ name: 'idle' }), Transform.stationary());
  inst.sprite.playOnce('idle');
  layOnGround(inst, 1);
  SetEightFaced(inst, world.cameraFacing);
  inst.addTag('DECOR');
  inst.addTag('NOCLICK');
  inst.persists = false;
  return inst;
}

/** switchbasefn / switchpadfn: background decals. The base's archive_switch rotation and power listeners are not wired. */
function groundDecal(prefab: typeof ARCHIVE_SWITCH_BASE_ID | typeof ARCHIVE_SWITCH_PAD_ID, sortOrder: number): PrefabInstance {
  const inst = new PrefabInstance(prefab, new SpriteState({ name: 'idle' }), Transform.stationary());
  inst.sprite.playOnce('idle');
  layOnGround(inst, sortOrder);
  inst.persists = prefab !== ARCHIVE_SWITCH_PAD_ID;
  return inst;
}

/** ambientfn: NOBLOCK | NOCLICK sound source; the arhivepoweron/off listeners need the archive manager. */
function ambientfn(): PrefabInstance {
  const inst = new PrefabInstance(ARCHIVE_AMBIENT_SFX_ID, new SpriteState({ name: '' }), Transform.stationary());
  inst.addTag('NOBLOCK');
  inst.addTag('NOCLICK');
  return inst;
}

/** worldgenitemfn: a bare Transform that removes itself at the next tick. */
function worldgenitemfn(prefab: 'rubble1' | 'rubble2', scheduler: ArchivePropsWorld['scheduler']): PrefabInstance {
  const inst = new PrefabInstance(prefab, new SpriteState({ name: '' }), Transform.stationary());
  inst.persists = false;
  inst.onRemove(scheduler.schedule(0, () => inst.remove()));
  return inst;
}

/**
 * The Prefabs archive_props.lua returns, without the power-driven security desk, switch and pulse prefabs.
 * Each call is one world's `_storyprogress`.
 */
export function archivePropsPrefabs(world: ArchivePropsWorld): Readonly<Record<ArchivePropPrefabId, PrefabEntityDefinition<PrefabInstance>>> {
  const story = { progress: 0 };
  const obstacle = { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS };
  return {
    [ARCHIVE_MOON_STATUE_ID]: {
      fn: () => new ArchiveMoonStatueInstance(world),
      assets: archive('archive_moon_statue', 'archive_moon_statue'),
      assetOptions: { instancedAnimations: Array.from({ length: MOON_STATUE_VARIANTS }, (_, index) =>
        ['full', 'med', 'low'].map(state => `idle_${state}_${index + 1}`)).flat() },
      physics: obstacle,
      onSpawned: inst => {
        new ToolMouseTarget(actionEntity(inst.transform.model, ARCHIVE_MOON_STATUE_ID), inst, inst.components.workable, world.handEquipment);
      },
    },
    [ARCHIVE_RUNE_STATUE_ID]: {
      fn: () => new ArchiveRuneStatueInstance(story),
      assets: archive('archive_runes', 'archive_rune'),
      physics: obstacle,
      minimapIcon: 'archive_runes.png',
    },
    [ARCHIVE_PORTAL_ID]: {
      fn: position => portalfn(world, position),
      // The idle clip also lists archive_portal_base_01, which only the archive_portal_base build (the drop shadow child) holds.
      assets: archive('archive_portal', 'archive_portal', ['archive_portal_base_01']),
      minimapIcon: 'archive_portal.png',
    },
    [ARCHIVE_PORTAL_SHADOW_ID]: { fn: () => CreateDropShadow(world), assets: archive('archive_portal_base', 'archive_portal_base'), targetable: false },
    [ARCHIVE_SWITCH_BASE_ID]: { fn: () => groundDecal(ARCHIVE_SWITCH_BASE_ID, 1), assets: archive('archive_switch_ground', 'archive_switch_ground') },
    [ARCHIVE_SWITCH_PAD_ID]: { fn: () => groundDecal(ARCHIVE_SWITCH_PAD_ID, 2), assets: archive('archive_switch_ground_small', 'archive_switch_ground_small') },
    [ARCHIVE_AMBIENT_SFX_ID]: { fn: ambientfn },
    rubble1: { fn: () => worldgenitemfn('rubble1', world.scheduler), alwaysActive: true },
    rubble2: { fn: () => worldgenitemfn('rubble2', world.scheduler), alwaysActive: true },
  };
}
