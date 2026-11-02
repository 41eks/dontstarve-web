import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import * as THREE from 'three';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { watchTileActivity } from './tileActivity';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import type { SpawnGroundItem } from './groundPrefab';
import { WorldFx } from './world_fx';
import type { WorldContext } from './worldContext';
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
  fx?: WorldContext['fx'];
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

function onhammered(inst: PrefabInstance<ArchiveSpriteCommands>): void {
  inst.components.lootdropper!.DropLoot();
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'rock');
  inst.remove();
}

/** prefabs/houndbone.lua: a piece of hound remains, hammered once into boneshards (and, for piece3, maybe a houndstooth). */
export class HoundboneManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: HoundboneWorld;
  private readonly resources = new SpriteResources(undefined, 'houndbone');
  private readonly bones = new Map<THREE.Group, Houndbone>();
  private readonly localFx?: WorldFx;
  private disposed = false;

  constructor(scene: THREE.Scene, world: HoundboneWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world;
    this.localFx = world.fx?.collapse ? undefined : new WorldFx(scene);
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
    const workable = new Workable(instance);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(1);
    const bone: Houndbone = { model, instance, display, sprite, workable, bonetype };
    const lootdropper = new LootDropper(instance, (itemId, point) => this.world.spawnGroundItem(
      { ...catalog.items[itemId as keyof typeof catalog.items], itemId, count: 1 }, new THREE.Vector3(point.x, point.y, point.z), { fling: true }));
    lootdropper.SetChanceLootTable('houndbone');
    // SetBoneType: the chance loot is rebuilt for each bonetype.
    lootdropper.ClearChanceLoot();
    if (bonetype === TOOTH_BONETYPE) lootdropper.AddChanceLoot('houndstooth', .5);
    instance.worldServices = { fx: this.localFx ?? this.world.fx };
    workable.SetOnFinishCallback(onhammered);
    Object.assign(instance.components, { workable, lootdropper });
    instance.onRemove(() => {
      this.bones.delete(model);
      bone.stopActivity?.();
      workable.dispose();
    });
    new ToolMouseTarget(inst, instance, workable, this.world.handEquipment);
    this.bones.set(model, bone);
    this.displays.mount(prefabDisplay(model)!);
    bone.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    return model;
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    // Each shared display owner advances its declared clips.
    this.displays.update(dt);
    this.localFx?.update(dt, _quaternion);
  }

  get renderEntities() {
    return [...this.displays.renderEntities, ...(this.localFx?.renderEntities ?? [])];
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
    bone.stopActivity?.();
    bone.workable.dispose();
    bone.instance.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of [...this.bones.keys()]) this.remove(model);
    this.localFx?.dispose();
    this.displays.dispose();
    this.resources.dispose();
  }
}
