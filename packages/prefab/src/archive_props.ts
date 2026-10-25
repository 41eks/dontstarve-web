import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSharedArchiveSprite, preloadSharedArchiveSprite, ArchiveSpriteAssets } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, createEmptyEntity, type PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import { createEffect, createSignal, watchSignal, type ReadonlySignal, type TileStateQuery } from '@dontstarve-web/signals';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { modelEntries } from './modelRecords';
import { MiniMapEntity } from './minimapEntity';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import { PlaySound, PreloadSounds } from './sound';
import catalog from './groundItems.json' with { type: 'json' };

export const ARCHIVE_MOON_STATUE_ID = 'archive_moon_statue' as const;
export const ARCHIVE_RUNE_STATUE_ID = 'archive_rune_statue' as const;
export const ARCHIVE_PORTAL_ID = 'archive_portal' as const;
export const ARCHIVE_SWITCH_BASE_ID = 'archive_switch_base' as const;
export const ARCHIVE_SWITCH_PAD_ID = 'archive_switch_pad' as const;
export const ARCHIVE_AMBIENT_SFX_ID = 'archive_ambient_sfx' as const;
/** Prefabs that persist: archive_switch_pad has `persists = false` and the rubble worldgen items remove themselves. */
export const ARCHIVE_PROP_IDS = [ARCHIVE_MOON_STATUE_ID, ARCHIVE_RUNE_STATUE_ID, ARCHIVE_PORTAL_ID, ARCHIVE_SWITCH_BASE_ID,
  ARCHIVE_AMBIENT_SFX_ID] as const;
export const ARCHIVE_PROP_SPAWN_IDS = [...ARCHIVE_PROP_IDS, ARCHIVE_SWITCH_PAD_ID, 'rubble1', 'rubble2'] as const;
export type ArchivePropId = typeof ARCHIVE_PROP_IDS[number];
export type ArchivePropSpawnId = typeof ARCHIVE_PROP_SPAWN_IDS[number];

const MOON_STATUE_VARIANTS = 4;
const RUNE_STATUE_VARIANTS = 3;
const NUM_STORY_LINES = 5;
/** tuning.lua MARBLEPILLAR_MINE. */
export const MARBLEPILLAR_MINE = 10;
const PHYSICS_RADIUS = .66;
// archive_props.lua SetSharedLootTable('archive_statues', ...)
SetSharedLootTable('archive_statues', [['thulecite', 1], ['moonrocknugget', 1], ['moonrocknugget', .05]]);
const STATUE_LOOT = ['thulecite', 'moonrocknugget', 'moonrocknugget'] as const;
const BACKGROUND_RENDER_ORDER = -.5;

/** archive_props.lua OnSave: statues and rune statues write `anim`; rune statues add `storyprogress` once it is assigned. */
export interface ArchivePropSaveState { anim?: number; storyprogress?: number; }
export interface ArchivePropRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { archiveProp?: ArchivePropSaveState };
}

export interface ArchivePropsWorld {
  tickingarea?: TileStateQuery;
  physics?: CANNON.World;
  /** FACING_* bit that the camera heading gives an eight-faced inst with rotation 0. */
  cameraFacing?: ReadonlySignal<number>;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

interface PropDefinition {
  animationArchive: string;
  buildArchive: string;
  bank: string;
  /** Layered background decals (AnimState:SetOrientation(OnGround), LAYER_BACKGROUND) and their sort order. */
  ground?: { sortOrder: number; finalOffset?: number };
  eightFaced?: true;
  /** Animation symbols that the prefab's own build lacks; the engine draws nothing for them. */
  hiddenSymbols?: readonly string[];
  /** Only source-looping clips participate in scenery instance batches. */
  instancedAnimations?: readonly string[];
  minimap?: string;
  tags: readonly string[];
}

const PROPS: Readonly<Record<Exclude<ArchivePropId | typeof ARCHIVE_SWITCH_PAD_ID, typeof ARCHIVE_AMBIENT_SFX_ID>, PropDefinition>> = {
  [ARCHIVE_MOON_STATUE_ID]: { animationArchive: 'archive_moon_statue.zip', buildArchive: 'archive_moon_statue.zip', bank: 'archive_moon_statue',
    instancedAnimations: Array.from({ length: MOON_STATUE_VARIANTS }, (_, index) =>
      ['full', 'med', 'low'].map(state => `idle_${state}_${index + 1}`)).flat(),
    tags: ['structure', 'statue', 'dustable'] },
  [ARCHIVE_RUNE_STATUE_ID]: { animationArchive: 'archive_runes.zip', buildArchive: 'archive_runes.zip', bank: 'archive_rune',
    minimap: 'archive_runes.png', tags: ['structure', 'statue', 'dustable', 'ancient_text'] },
  [ARCHIVE_PORTAL_ID]: { animationArchive: 'archive_portal.zip', buildArchive: 'archive_portal.zip', bank: 'archive_portal',
    ground: { sortOrder: 1, finalOffset: 2 }, eightFaced: true, minimap: 'archive_portal.png', tags: ['groundhole', 'blocker'],
    // The idle clip also lists archive_portal_base_01, which only the archive_portal_base build (the drop shadow child) holds.
    hiddenSymbols: ['archive_portal_base_01'] },
  [ARCHIVE_SWITCH_BASE_ID]: { animationArchive: 'archive_switch_ground.zip', buildArchive: 'archive_switch_ground.zip',
    bank: 'archive_switch_ground', ground: { sortOrder: 1 }, tags: [] },
  [ARCHIVE_SWITCH_PAD_ID]: { animationArchive: 'archive_switch_ground_small.zip', buildArchive: 'archive_switch_ground_small.zip',
    bank: 'archive_switch_ground_small', ground: { sortOrder: 2 }, tags: [] },
};
/** archive_props.lua CreateDropShadow: the portal's DECOR | NOCLICK child under the portal art. */
const PORTAL_SHADOW = { animationArchive: 'archive_portal_base.zip', buildArchive: 'archive_portal_base.zip', bank: 'archive_portal_base' } as const;

export function isArchivePropId(value: string): value is ArchivePropId {
  return (ARCHIVE_PROP_IDS as readonly string[]).includes(value);
}

interface ArchiveProp {
  prefab: ArchivePropId | typeof ARCHIVE_SWITCH_PAD_ID;
  model: THREE.Group;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  sprite?: ArchiveSpriteCommands;
  shadow?: ReturnType<typeof createArchiveEntity>;
  stopActivity?: () => void;
  minimap?: MiniMapEntity;
  workable?: Workable;
  loot?: Map<string, PreparedGroundSpawn[]>;
  anim?: number;
  storyprogress?: number;
  /** Mined: the statue has dropped its loot and is gone this frame. */
  removed: boolean;
  stopFacing?: () => void;
}

/** archive_props.lua: the static Archive props. The power-driven security desk, switch and pulse prefabs are separate. */
export class ArchivePropsManager {
  private readonly scene: THREE.Scene;
  private readonly world: ArchivePropsWorld;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly props = new Map<THREE.Group, ArchiveProp>();
  private readonly effects = new Set<ReturnType<typeof createArchiveEntity>>();
  private readonly sources = new Map<string, ReturnType<typeof preloadSharedArchiveSprite>>();
  /** Module-level `_storyprogress`: the last story line handed to a rune statue. */
  private storyprogress = 0;
  private disposed = false;

  constructor(scene: THREE.Scene, world: ArchivePropsWorld) {
    this.scene = scene; this.world = world;
  }

  async spawn(prefab: ArchivePropSpawnId, position: THREE.Vector3, saved?: ArchivePropRecord): Promise<THREE.Group | undefined> {
    if (this.disposed) throw new Error('Archive props have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid archive prop position');
    // worldgenitemfn: a bare Transform that removes itself at the next tick.
    if (prefab === 'rubble1' || prefab === 'rubble2') return undefined;
    if (prefab === ARCHIVE_AMBIENT_SFX_ID) return this.createAmbient(position, saved);
    const state = saved?.components.archiveProp;
    const variants = prefab === ARCHIVE_MOON_STATUE_ID ? MOON_STATUE_VARIANTS : RUNE_STATUE_VARIANTS;
    // statuefn / runefn: anim = math.random(variants); OnLoad restores the saved one.
    const anim = prefab === ARCHIVE_MOON_STATUE_ID || prefab === ARCHIVE_RUNE_STATUE_ID
      ? state?.anim ?? 1 + Math.floor(Math.random() * variants) : undefined;
    const definition = PROPS[prefab];
    const initial = prefab === ARCHIVE_MOON_STATUE_ID ? `idle_full_${anim}` : prefab === ARCHIVE_RUNE_STATUE_ID
      ? (anim === 1 ? 'idle' : `idle${anim}`) : 'idle';
    const resources = await Promise.allSettled([
      this.getSource(definition),
      prefab === ARCHIVE_PORTAL_ID ? this.getSource(PORTAL_SHADOW) : undefined,
      prefab === ARCHIVE_MOON_STATUE_ID ? this.prepareStatue() : undefined,
    ] as const);
    const failed = resources.find(result => result.status === 'rejected');
    const sprite = resources[0].status === 'fulfilled' ? resources[0].value : undefined;
    const shadow = resources[1].status === 'fulfilled' ? resources[1].value : undefined;
    const loot = resources[2].status === 'fulfilled' ? resources[2].value : undefined;
    if (failed || this.disposed || !sprite) {
      loot?.forEach(outputs => outputs.forEach(output => output.dispose()));
      throw failed?.status === 'rejected' ? failed.reason : new Error('Archive props have been disposed');
    }
    const create = (clip: { name: string; loop: boolean }) => sprite(clip.name, clip.loop, prefab);
    const entity = createArchiveEntity(prefab, { create, initial: create({ name: initial, loop: false }) }, { name: initial, billboard: !definition.ground }, prefab);
    entity.instance.sprite.playOnce(initial);
    const childCreate = shadow && ((clip: { name: string; loop: boolean }) => shadow(clip.name, clip.loop, `${prefab}_shadow`));
    const child = childCreate && createArchiveEntity(`${prefab}_shadow`, { create: childCreate, initial: childCreate({ name: 'idle', loop: false }) }, { name: 'idle' });
    child?.instance.sprite.playOnce('idle');
    return this.create(prefab, definition, entity, child, loot, position, anim, state?.storyprogress, saved);
  }

  private getSource(definition: Pick<PropDefinition, 'animationArchive' | 'buildArchive' | 'bank' | 'hiddenSymbols' | 'instancedAnimations'>) {
    const key = definition.animationArchive;
    let request = this.sources.get(key);
    if (!request) {
      request = preloadSharedArchiveSprite(this.assets, { animationArchive: key, buildArchives: [definition.buildArchive],
        bank: definition.bank, hiddenSymbols: definition.hiddenSymbols }, { instancedAnimations: definition.instancedAnimations })
        .catch(error => { this.sources.delete(key); throw error; });
      this.sources.set(key, request);
    }
    return request;
  }

  /** The statue's collapse effect, rock_break sound and the three prepared pieces of the `archive_statues` table. */
  private async prepareStatue(): Promise<Map<string, PreparedGroundSpawn[]>> {
    const settled = await Promise.allSettled([
      this.assets.loadAnimation('structure_collapse_fx.zip'), this.assets.loadBuild('structure_collapse_fx.zip'),
      PreloadSounds('dontstarve/common/destroy_smoke', 'dontstarve/wilson/rock_break'),
      ...STATUE_LOOT.map(itemId => this.world.prepareSpawn({ ...catalog.items[itemId], itemId, count: 1 }, true)),
    ] as const);
    const loot = new Map<string, PreparedGroundSpawn[]>();
    STATUE_LOOT.forEach((itemId, index) => {
      const result = settled[index + 3] as PromiseSettledResult<PreparedGroundSpawn>;
      if (result.status === 'fulfilled') loot.set(itemId, [...loot.get(itemId) ?? [], result.value]);
    });
    const failed = settled.find(result => result.status === 'rejected');
    if (failed) {
      loot.forEach(outputs => outputs.forEach(output => output.dispose()));
      throw failed.status === 'rejected' ? failed.reason : undefined;
    }
    return loot;
  }

  private create(prefab: ArchivePropId | typeof ARCHIVE_SWITCH_PAD_ID, definition: PropDefinition, { instance, display }: ReturnType<typeof createArchiveEntity>, shadow: ReturnType<typeof createArchiveEntity> | undefined,
    loot: Map<string, PreparedGroundSpawn[]> | undefined, position: THREE.Vector3, anim: number | undefined, storyprogress: number | undefined,
    saved: ArchivePropRecord | undefined): THREE.Group {
    const model = display.model;
    const sprite = instance.sprite;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab });
    for (const tag of definition.tags) instance.addTag(tag);
    const inst = actionEntity(model, prefab);
    const prop: ArchiveProp = { prefab, model, instance, display, sprite, shadow, loot, anim, storyprogress, removed: false };
    if (definition.ground) this.layOnGround(prop, definition.ground);
    if (shadow) {
      // The shadow is a DECOR | NOCLICK child that sorts just under the portal art (SortOrder 1, no FinalOffset).
      shadow.display.model.userData.billboard = false;
      for (const tag of ['DECOR', 'NOCLICK']) shadow.instance.addTag(tag);
      shadow.instance.persists = false;
      shadow.instance.sprite.setGround(this.groundRenderOrder(1));
      sprite.attachFx('shadow', { sprite: shadow.instance.sprite, display: shadow.display, active: createSignal(true),
        sortLayer: 0, background: true });
    }
    if (definition.eightFaced && this.world.cameraFacing) {
      // Transform:SetEightFaced: a rotation-0 inst shows the facing the camera heading selects.
      const facing = watchSignal(this.world.cameraFacing, stop => { prop.stopFacing = stop; });
      createEffect(() => { const value = facing.get(); sprite.setFacing(value); shadow?.instance.sprite.setFacing(value); });
    }
    if (prefab === ARCHIVE_MOON_STATUE_ID) this.createStatue(prop, inst, anim!, saved !== undefined);
    else if (prefab === ARCHIVE_RUNE_STATUE_ID) this.createRune(prop, storyprogress);
    if (definition.minimap || prefab === ARCHIVE_MOON_STATUE_ID) {
      prop.minimap = new MiniMapEntity(model.position);
      prop.minimap.SetIcon(definition.minimap ?? `archive_moon_statue${anim}.png`);
    }
    if (prefab === ARCHIVE_MOON_STATUE_ID || prefab === ARCHIVE_RUNE_STATUE_ID) {
      MakeObstaclePhysics(prop.instance, PHYSICS_RADIUS);
      if (this.world.physics) prop.instance.bindPhysics(this.world.physics);
    }
    this.props.set(model, prop);
    this.scene.add(model);
    instance.persists = prefab !== ARCHIVE_SWITCH_PAD_ID;
    prop.stopActivity = watchTileActivity(model, this.world.tickingarea, active => {
      instance.setActive(active); shadow?.instance.setActive(active);
    });
    return model;
  }

  /** AnimState:SetOrientation(ANIM_ORIENTATION.OnGround) and SetLayer(LAYER_BACKGROUND): flat art drawn under the world. */
  private layOnGround(prop: ArchiveProp, { sortOrder, finalOffset = 0 }: NonNullable<PropDefinition['ground']>): void {
    prop.model.userData.billboard = false;
    prop.sprite!.setGround(this.groundRenderOrder(sortOrder, finalOffset));
  }

  /** Background decals share one layer: the source sort order (and FinalOffset) breaks ties within it. */
  private groundRenderOrder(sortOrder: number, finalOffset = 0): number {
    return BACKGROUND_RENDER_ORDER + (sortOrder - 3) * .01 + finalOffset * .001;
  }

  /** statuefn: MINE workable (MARBLEPILLAR_MINE), `archive_statues` loot, work-state idle poses and collapse_small on finish. */
  private createStatue(prop: ArchiveProp, inst: ReturnType<typeof actionEntity>, anim: number, loaded: boolean): void {
    const { model, sprite } = prop;
    const workable = new Workable(inst);
    prop.workable = workable;
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(MARBLEPILLAR_MINE);
    // ShowWorkState: low under a third of the work, med under two thirds, otherwise full; looping.
    const showWorkState = (workleft: number) => sprite!.start(`${workleft < MARBLEPILLAR_MINE / 3 ? 'idle_low_'
      : workleft < MARBLEPILLAR_MINE * 2 / 3 ? 'idle_med_' : 'idle_full_'}${anim}`);
    // OnLoadPostPass shows the work state of a loaded statue; a new one plays idle_full_<anim> once.
    if (loaded) showWorkState(workable.GetWorkLeft());
    const lootdropper = new LootDropper(inst, (itemId, point) => {
      const prepared = prop.loot?.get(itemId)?.shift();
      if (!prepared) return undefined;
      const spawned = prepared.spawn(new THREE.Vector3(point.x, point.y, point.z));
      if (!spawned) prepared.dispose();
      return spawned ? prepared.spawnedEntity : undefined;
    });
    lootdropper.SetChanceLootTable('archive_statues');
    workable.SetOnWorkCallback((_worker, workleft) => showWorkState(workleft));
    workable.SetOnFinishCallback(() => {
      // OnWorkFinished: DropLoot at the statue, collapse_small with the rock material, then Remove.
      lootdropper.DropLoot();
      this.playCollapse(model.position);
      this.remove(model);
    });
    Object.assign(model.userData.components, { workable, lootdropper });
  }

  /** structure_collapse_fx.lua: smoke plus the `rock` material sound over the collapse_small animation. */
  private playCollapse(position: THREE.Vector3): void {
    const at = position.clone();
    PlaySound('dontstarve/common/destroy_smoke', at);
    PlaySound('dontstarve/wilson/rock_break', at);
    void createSharedArchiveSprite(this.assets, { animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
      bank: 'collapse', animation: 'collapse_small', loop: false }).then(effect => {
      if (this.disposed) { effect.dispose(); return; }
      const entity = createArchiveEntity('collapse_small', { initial: effect, create: clip => createSharedArchiveSprite(this.assets, {
        animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'], bank: 'collapse', animation: clip.name, loop: clip.loop,
      }) }, { name: 'collapse_small', billboard: true });
      entity.instance.position.copy(at); entity.instance.persists = false;
      for (const tag of ['FX', 'NOCLICK']) entity.instance.addTag(tag);
      this.scene.add(entity.display.model); this.effects.add(entity);
      entity.instance.sprite.playOnce('collapse_small', () => { entity.instance.remove(); this.effects.delete(entity); });
    }).catch((error: unknown) => console.error('Unable to play collapse effect', error));
  }

  /** runefn: ancient_text statue whose story line is assigned on first inspection and saved. */
  private createRune(prop: ArchiveProp, storyprogress: number | undefined): void {
    // onloadRune: the module counter keeps the highest line already handed out.
    if (storyprogress !== undefined) this.storyprogress = Math.max(this.storyprogress, storyprogress);
    const advance = () => {
      if (prop.storyprogress === undefined) {
        this.storyprogress = this.storyprogress % NUM_STORY_LINES + 1;
        prop.storyprogress = this.storyprogress;
      }
    };
    Object.assign(prop.model.userData.components, { inspectable: {
      /** getstatus: `LINE_<n>`, advancing the story on first use. */
      getstatus: () => { advance(); return `LINE_${prop.storyprogress}`; },
      /** rune_getdescription: only a viewer holding an ancient_reader gets the line's text key. */
      descriptionfn: (viewer: { components?: { inventory?: { EquipHasTag(tag: string): boolean } } }) => {
        if (!viewer.components?.inventory?.EquipHasTag('ancient_reader')) return undefined;
        advance();
        return `LINE_${prop.storyprogress}`;
      },
    } });
  }

  /** ambientfn: NOBLOCK | NOCLICK sound source; the arhivepoweron/off listeners need the archive manager. */
  private createAmbient(position: THREE.Vector3, saved?: ArchivePropRecord): THREE.Group {
    const { instance, display } = createEmptyEntity(ARCHIVE_AMBIENT_SFX_ID);
    const model = display.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: ARCHIVE_AMBIENT_SFX_ID });
    for (const tag of ['NOBLOCK', 'NOCLICK']) instance.addTag(tag);
    actionEntity(model, ARCHIVE_AMBIENT_SFX_ID);
    const prop: ArchiveProp = { prefab: ARCHIVE_AMBIENT_SFX_ID, model, instance, display, removed: false };
    this.props.set(model, prop);
    prop.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    this.scene.add(model);
    return model;
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const { sprite } of this.props.values()) {
      if (sprite?.loaded) sprite.update(dt);
    }
    for (const { instance } of [...this.effects]) instance.sprite.update(dt);
  }

  /** Only upright art needs depth sorting; background decals draw first. */
  get renderEntities() {
    return [...this.props.values()].filter(({ model, sprite }) => sprite?.loaded && model.userData.billboard !== false)
      .map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 }))
      .concat([...this.effects].map(({ display: { model } }) => ({ object: model, footPosition: model.position, cameraDepth: 0 })));
  }

  get miniMapEntities(): MiniMapEntity[] {
    return [...this.props.values()].flatMap(({ minimap }) => minimap ? [minimap] : []);
  }

  get mineTargets(): PickaxeTarget[] { return this.getMineTargets(); }

  getMineTargets(model?: THREE.Object3D): PickaxeTarget[] {
    return modelEntries(this.props, model).filter(([, prop]) => prop.workable?.CanBeWorked()).map(([model, prop]) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, prop.prefab),
      isValid: () => this.props.get(model) === prop && !!prop.workable?.CanBeWorked(),
    }));
  }

  /** workable.savestate is false: a surviving statue reloads with its full work count. */
  exportRecords(): { prefabId: ArchivePropId; record: ArchivePropRecord }[] {
    return [...this.props].filter(([, prop]) => prop.prefab !== ARCHIVE_SWITCH_PAD_ID).map(([model, prop]) => ({
      prefabId: prop.prefab as ArchivePropId,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: prop.anim === undefined ? {} : { archiveProp: {
          anim: prop.anim, ...prop.storyprogress === undefined ? {} : { storyprogress: prop.storyprogress } } },
      },
    }));
  }

  private remove(model: THREE.Group): void {
    const prop = this.props.get(model); if (!prop) return;
    this.props.delete(model); model.userData.removed = true; prop.removed = true;
    prop.stopActivity?.(); prop.stopFacing?.(); prop.minimap?.dispose(); prop.workable?.dispose();
    for (const outputs of prop.loot?.values() ?? []) outputs.forEach(output => output.dispose());
    prop.loot?.clear(); prop.shadow?.instance.remove(); prop.instance.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.props.keys()]) this.remove(model);
    for (const { instance } of this.effects) instance.remove();
    this.effects.clear();
    this.assets.dispose();
  }
}
