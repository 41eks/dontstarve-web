import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import * as THREE from 'three';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { watchTileActivity } from './tileActivity';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { modelEntries } from './modelRecords';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import type { SpawnGroundItem } from './groundPrefab';
import { PlaySound } from './sound';
import catalog from './groundItems.json' with { type: 'json' };

export const HOUNDBONE_ID = 'houndbone' as const;
/** houndbone.lua `names`: bonetype 1..3 selects piece1..piece3. */
export const HOUNDBONE_PIECES = ['piece1', 'piece2', 'piece3'] as const;
/** The bonetype whose hammering may also drop a houndstooth. */
const TOOTH_BONETYPE = 3;
// houndbone.lua SetSharedLootTable('houndbone', ...)
SetSharedLootTable('houndbone', [['boneshard', 1]]);

/** houndbone.lua OnSave: data.bonetype. */
export interface HoundboneSaveState { bonetype: number }
export interface HoundboneRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { houndbone?: HoundboneSaveState };
}

export interface HoundboneWorld extends ToolMouseTargetWorld {
  tickingarea?: TileStateQuery;
  /** lootdropper:SpawnLootPrefab when the bone is hammered; the loot's display loads its art. */
  spawnGroundItem: SpawnGroundItem;
}

interface Houndbone {
  model: THREE.Group;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  sprite: ArchiveSpriteCommands;
  stopActivity?: () => void;
  workable: Workable;
  bonetype: number;
}

/** prefabs/houndbone.lua: a piece of hound remains, hammered once into boneshards (and, for piece3, maybe a houndstooth). */
export class HoundboneManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: HoundboneWorld;
  private readonly resources = new SpriteResources(undefined, 'houndbone');
  private readonly bones = new Map<THREE.Group, Houndbone>();
  private readonly effects = new Set<ReturnType<typeof createArchiveEntity>>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: HoundboneWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world;
  }

  spawn(position: THREE.Vector3, saved?: HoundboneRecord): THREE.Group {
    if (this.disposed) throw new Error('Hound bones have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid houndbone position');
    // fn: SetBoneType(inst, math.random(#names)); onload restores data.bonetype.
    const bonetype = saved?.components.houndbone?.bonetype ?? 1 + Math.floor(Math.random() * HOUNDBONE_PIECES.length);
    if (!Number.isInteger(bonetype) || bonetype < 1 || bonetype > HOUNDBONE_PIECES.length) throw new RangeError(`Unsupported houndbone type: ${bonetype}`);
    const clip = { name: HOUNDBONE_PIECES[bonetype - 1], loop: false };
    const entity = createArchiveEntity(HOUNDBONE_ID, this.resources.archive({ animationArchive: 'hound_base.zip',
      buildArchives: ['hound_base.zip'], bank: 'houndbase' }, { instancedAnimations: 'all' }),
    { name: clip.name, billboard: true }, HOUNDBONE_ID);
    entity.instance.sprite.playOnce(clip.name);
    return this.create(entity, position, bonetype, saved);
  }

  private create({ instance, display }: ReturnType<typeof createArchiveEntity>, position: THREE.Vector3, bonetype: number, saved?: HoundboneRecord): THREE.Group {
    const model = display.model;
    const sprite = instance.sprite;
    model.position.set(position.x, 0, position.z);
    instance.entityId = saved?.id ?? newEntityId();
    const inst = actionEntity(model, HOUNDBONE_ID);
    inst.addTag('bone');
    // workable: HAMMER, 1 work; onhammered drops the loot, plays collapse_small with the rock material and removes it.
    const workable = new Workable(inst);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(1);
    const bone: Houndbone = { model, instance, display, sprite, workable, bonetype };
    const lootdropper = new LootDropper(inst, (itemId, point) => this.world.spawnGroundItem(
      { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    lootdropper.SetChanceLootTable('houndbone');
    // SetBoneType: the chance loot is rebuilt for each bonetype.
    lootdropper.ClearChanceLoot();
    if (bonetype === TOOTH_BONETYPE) lootdropper.AddChanceLoot('houndstooth', .5);
    workable.SetOnFinishCallback(() => {
      lootdropper.DropLoot();
      this.playCollapse(model.position);
      this.remove(model);
    });
    Object.assign(prefabInstance(model)!.components, { workable, lootdropper });
    new ToolMouseTarget(inst, instance, workable, this.world.handEquipment);
    this.bones.set(model, bone);
    inst.hammerTarget = {
      get id() { return String(instance.entityId); }, instance, display, entity: inst, position: instance.position,
      isValid: () => this.bones.get(model) === bone && workable.CanBeWorked(),
      playHit: () => { performToolWork('HAMMER', inst, {}); },
    };
    this.displays.mount(prefabDisplay(model)!);
    bone.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    return model;
  }

  /** structure_collapse_fx.lua: smoke plus the `rock` material sound over the collapse_small animation. */
  private playCollapse(position: THREE.Vector3): void {
    const at = position.clone();
    PlaySound('dontstarve/common/destroy_smoke', at);
    PlaySound('dontstarve/wilson/rock_break', at);
    const entity = createArchiveEntity('collapse_small', this.resources.archive({ animationArchive: 'structure_collapse_fx.zip',
      buildArchives: ['structure_collapse_fx.zip'], bank: 'collapse' }), { name: 'collapse_small', billboard: true }, 'collapse_small',
    instance => instance.sprite.playOnce('collapse_small', () => { instance.remove(); this.effects.delete(entity); }));
    entity.instance.position.copy(at); entity.instance.persists = false;
    for (const tag of ['FX', 'NOCLICK']) entity.instance.addTag(tag);
    this.displays.mount(entity.display); this.effects.add(entity);
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const { sprite } of this.bones.values()) if (sprite.loaded) sprite.update(dt);
    for (const { instance } of [...this.effects]) instance.sprite.update(dt);
  }

  get renderEntities() {
    return [...[...this.bones].filter(([, { sprite }]) => sprite.loaded).map(([model]) => model), ...[...this.effects].map(({ display }) => display.model)]
      .map(object => ({ object, footPosition: object.position, cameraDepth: 0 }));
  }

  get hammerTargets(): HammerTarget[] { return this.getHammerTargets(); }

  getHammerTargets(model?: THREE.Object3D): HammerTarget[] {
    return modelEntries(this.bones, model).filter(([, bone]) => bone.workable.CanBeWorked())
      .map(([model]) => actionEntity(model, HOUNDBONE_ID).hammerTarget)
      .filter((target): target is HammerTarget => target !== undefined);
  }

  /** workable.savestate is false: a surviving bone reloads with its full work count. */
  exportRecords(): { prefabId: typeof HOUNDBONE_ID; record: HoundboneRecord }[] {
    return [...this.bones].map(([model, { bonetype, instance }]) => ({
      prefabId: HOUNDBONE_ID,
      record: {
        id: String(instance.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { houndbone: { bonetype } },
      },
    }));
  }

  private remove(model: THREE.Group): void {
    const bone = this.bones.get(model); if (!bone) return;
    this.bones.delete(model); model.userData.removed = true;
    bone.stopActivity?.();
    bone.workable.dispose();
    bone.instance.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.bones.keys()]) this.remove(model);
    for (const { instance } of this.effects) instance.remove();
    this.effects.clear();
    this.displays.dispose();
    this.resources.dispose();
  }
}
