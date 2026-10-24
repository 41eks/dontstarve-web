import * as THREE from 'three';
import { createSharedArchiveSprite, preloadSharedArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { ResidentSprite } from '@dontstarve-web/animation/residentSprite';
import { createEffect, type TileStateQuery } from '@dontstarve-web/signals';
import { watchTileActivity } from './tileActivity';
import type { HammerTarget } from '@dontstarve-web/stategraphs/hammer';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { modelEntries } from './modelRecords';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import type { GroundItemDefinition, PreparedGroundSpawn } from './groundPrefab';
import { PlaySound, PreloadSounds } from './sound';
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

export interface HoundboneWorld {
  tickingarea?: TileStateQuery;
  prepareSpawn(definition: GroundItemDefinition, fling?: boolean): Promise<PreparedGroundSpawn>;
}

interface Houndbone {
  model: THREE.Group;
  sprite: ResidentSprite;
  stopActivity?: () => void;
  stopArt?: () => void;
  workable: Workable;
  loot: { itemId: string; output: PreparedGroundSpawn }[];
  bonetype: number;
}

/** prefabs/houndbone.lua: a piece of hound remains, hammered once into boneshards (and, for piece3, maybe a houndstooth). */
export class HoundboneManager {
  private readonly scene: THREE.Scene;
  private readonly world: HoundboneWorld;
  private readonly assets = new ArchiveSpriteAssets('houndbone');
  private readonly bones = new Map<THREE.Group, Houndbone>();
  private readonly effects = new Set<ArchiveSprite>();
  private creator?: Promise<Awaited<ReturnType<typeof preloadSharedArchiveSprite>>>;
  private readonly cameraQuaternion = new THREE.Quaternion();
  private disposed = false;

  constructor(scene: THREE.Scene, world: HoundboneWorld) {
    this.scene = scene; this.world = world;
  }

  private getCreator() {
    return this.creator ??= preloadSharedArchiveSprite(this.assets, { animationArchive: 'hound_base.zip', buildArchives: ['hound_base.zip'],
      bank: 'houndbase' }, { instancedAnimations: 'all' }).catch((error: unknown) => { this.creator = undefined; throw error; });
  }

  async spawn(position: THREE.Vector3, saved?: HoundboneRecord): Promise<THREE.Group> {
    if (this.disposed) throw new Error('Hound bones have been disposed');
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid houndbone position');
    // fn: SetBoneType(inst, math.random(#names)); onload restores data.bonetype.
    const bonetype = saved?.components.houndbone?.bonetype ?? 1 + Math.floor(Math.random() * HOUNDBONE_PIECES.length);
    if (!Number.isInteger(bonetype) || bonetype < 1 || bonetype > HOUNDBONE_PIECES.length) throw new RangeError(`Unsupported houndbone type: ${bonetype}`);
    const [create, loot] = await Promise.all([this.getCreator(), this.prepareHammered(bonetype)]);
    if (this.disposed) { loot.forEach(({ output }) => output.dispose()); throw new Error('Hound bones have been disposed'); }
    const build = (clip: { name: string; loop: boolean }) => create(clip.name, clip.loop, HOUNDBONE_ID);
    const clip = { name: HOUNDBONE_PIECES[bonetype - 1], loop: false };
    return this.create(new ResidentSprite(build, clip, build(clip), HOUNDBONE_ID), loot, position, bonetype, saved);
  }

  /** The collapse effect, rock_break sound and every item the bone's loot can roll, ready before the hit. */
  private async prepareHammered(bonetype: number): Promise<Houndbone['loot']> {
    const itemIds = bonetype === TOOTH_BONETYPE ? ['boneshard', 'houndstooth'] as const : ['boneshard'] as const;
    const settled = await Promise.allSettled([
      this.assets.loadAnimation('structure_collapse_fx.zip'), this.assets.loadBuild('structure_collapse_fx.zip'),
      PreloadSounds('dontstarve/common/destroy_smoke', 'dontstarve/wilson/rock_break'),
      ...itemIds.map(itemId => this.world.prepareSpawn({ ...catalog.items[itemId], itemId, count: 1 }, true)),
    ] as const);
    const loot = settled.slice(3).flatMap((result, index) => result.status === 'fulfilled'
      ? [{ itemId: itemIds[index], output: result.value as PreparedGroundSpawn }] : []);
    const failed = settled.find(result => result.status === 'rejected');
    if (failed) {
      loot.forEach(({ output }) => output.dispose());
      throw failed.status === 'rejected' ? failed.reason : undefined;
    }
    return loot;
  }

  private create(sprite: ResidentSprite, loot: Houndbone['loot'], position: THREE.Vector3, bonetype: number, saved?: HoundboneRecord): THREE.Group {
    const model = sprite.model;
    model.position.set(position.x, 0, position.z);
    Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: HOUNDBONE_ID, tags: ['bone'], animationController: sprite });
    const inst = actionEntity(model, HOUNDBONE_ID);
    inst.addTag('bone');
    // workable: HAMMER, 1 work; onhammered drops the loot, plays collapse_small with the rock material and removes it.
    const workable = new Workable(inst);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(1);
    const bone: Houndbone = { model, sprite, workable, loot, bonetype };
    const lootdropper = new LootDropper(inst, (itemId, point) => {
      const index = bone.loot.findIndex(entry => entry.itemId === itemId);
      const [prepared] = index < 0 ? [] : bone.loot.splice(index, 1).map(entry => entry.output);
      if (!prepared) return undefined;
      const spawned = prepared.spawn(new THREE.Vector3(point.x, point.y, point.z));
      if (!spawned) prepared.dispose();
      return spawned ? prepared.spawnedEntity : undefined;
    });
    lootdropper.SetChanceLootTable('houndbone');
    // SetBoneType: the chance loot is rebuilt for each bonetype.
    lootdropper.ClearChanceLoot();
    if (bonetype === TOOTH_BONETYPE) lootdropper.AddChanceLoot('houndstooth', .5);
    workable.SetOnFinishCallback(() => {
      lootdropper.DropLoot();
      this.playCollapse(model.position);
      this.remove(model);
    });
    Object.assign(model.userData.components, { workable, lootdropper });
    bone.stopArt = createEffect(() => { sprite.art.get(); sprite.faceCamera(this.cameraQuaternion); });
    this.bones.set(model, bone);
    this.scene.add(model);
    bone.stopActivity = watchTileActivity(model, this.world.tickingarea, active => sprite.setActive(active));
    return model;
  }

  /** structure_collapse_fx.lua: smoke plus the `rock` material sound over the collapse_small animation. */
  private playCollapse(position: THREE.Vector3): void {
    const at = position.clone();
    PlaySound('dontstarve/common/destroy_smoke', at);
    PlaySound('dontstarve/wilson/rock_break', at);
    void createSharedArchiveSprite(this.assets, { animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
      bank: 'collapse', animation: 'collapse_small', loop: false }).then(effect => {
      if (this.disposed) { effect.dispose(); return; }
      effect.model.position.copy(at); effect.model.userData.tags = ['FX', 'NOCLICK']; effect.model.userData.persists = false;
      this.scene.add(effect.model); this.effects.add(effect);
      effect.playOnce('collapse_small', () => { effect.dispose(); this.effects.delete(effect); });
    }).catch((error: unknown) => console.error('Unable to play collapse effect', error));
  }

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    this.cameraQuaternion.copy(quaternion);
    for (const { sprite } of this.bones.values()) if (sprite.loaded) { sprite.faceCamera(quaternion); sprite.update(dt); }
    for (const effect of [...this.effects]) { effect.model.quaternion.copy(quaternion); effect.update(dt); }
  }

  get renderEntities() {
    return [...[...this.bones].filter(([, { sprite }]) => sprite.loaded).map(([model]) => model), ...[...this.effects].map(({ model }) => model)]
      .map(object => ({ object, footPosition: object.position, cameraDepth: 0 }));
  }

  get hammerTargets(): HammerTarget[] { return this.getHammerTargets(); }

  getHammerTargets(model?: THREE.Object3D): HammerTarget[] {
    return modelEntries(this.bones, model).filter(([, bone]) => bone.workable.CanBeWorked()).map(([model, bone]) => ({
      id: String(model.userData.entityId), model, position: model.position, entity: actionEntity(model, HOUNDBONE_ID),
      isValid: () => this.bones.get(model) === bone && bone.workable.CanBeWorked(),
      playHit: () => { performToolWork('HAMMER', actionEntity(model, HOUNDBONE_ID), {}); },
    }));
  }

  /** workable.savestate is false: a surviving bone reloads with its full work count. */
  exportRecords(): { prefabId: typeof HOUNDBONE_ID; record: HoundboneRecord }[] {
    return [...this.bones].map(([model, { bonetype }]) => ({
      prefabId: HOUNDBONE_ID,
      record: {
        id: String(model.userData.entityId),
        transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 },
        components: { houndbone: { bonetype } },
      },
    }));
  }

  private remove(model: THREE.Group): void {
    const bone = this.bones.get(model); if (!bone) return;
    this.bones.delete(model); model.userData.removed = true;
    bone.stopActivity?.(); bone.stopArt?.();
    bone.workable.dispose();
    bone.loot.forEach(({ output }) => output.dispose()); bone.loot.length = 0;
    bone.sprite.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.bones.keys()]) this.remove(model);
    for (const effect of this.effects) effect.dispose();
    this.effects.clear();
    this.assets.dispose();
  }
}
