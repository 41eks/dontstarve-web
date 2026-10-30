import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { Leader, PointOfInterest } from '../../componets/src/statueglommerSignatures';
import { Pickable } from './components/pickable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { MiniMapState } from '../../map/src/minimapState';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { watchTileActivity } from './tileActivity';

export const STATUEGLOMMER_ID = 'statueglommer' as const;
export const STATUEGLOMMER_WORK = 6;

/** statueglommer.lua OnSave plus the two component OnSave records. */
export interface StatueGlommerRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: {
    statueglommer?: { worked?: true; spawned?: true };
    pickable?: { picked?: boolean; caninteractwith?: true };
    workable?: { maxwork: -1; workleft: number };
  };
}

export interface StatueGlommerWorld {
  tickingarea?: TileStateQuery;
  physics?: World;
  scheduler: GameTimeScheduler;
}

interface Statue {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  workable?: Workable;
  lootdropper?: LootDropper;
  pickable: Pickable;
  hauntable: Hauntable;
  minimap: MiniMapState;
  spawned: boolean;
  stopActivity: () => void;
}

SetSharedLootTable('statueglommer', [['marble', 1], ['marble', 1], ['marble', 1]]);

/** The constructor and load sequence from statueglommer.lua; world moon events are outside this display/save port. */
export class StatueGlommerManager {
  private readonly assets = new ArchiveSpriteAssets(STATUEGLOMMER_ID);
  private readonly statues = new Map<THREE.Group, Statue>();
  private disposed = false;

  private readonly displays: PrefabDisplayGroup;
  private readonly world: StatueGlommerWorld;
  constructor(scene: THREE.Scene, world: StatueGlommerWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }

  spawn(position: THREE.Vector3, saved?: StatueGlommerRecord): THREE.Group {
    if (this.disposed) throw new Error('Glommer statues have been disposed');
    const entity = createArchiveEntity(STATUEGLOMMER_ID, { create: clip => createSharedArchiveSprite(this.assets, {
      animationArchive: 'glommer_statue.zip', buildArchives: ['glommer_statue.zip', 'glommer_swap_flower.zip'],
      bank: 'glommer_statue', animation: clip.name, loop: clip.loop,
    }, { instancedAnimations: 'all', name: STATUEGLOMMER_ID }) },
    { name: 'full', held: true, billboard: true }, STATUEGLOMMER_ID);
    const { instance, display } = entity, model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.copy(position);
    model.rotation.y = saved?.transform.rotationY ?? 0;
    instance.addTag('statue');
    MakeObstaclePhysics(instance, .75);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    // fn: PlayAnimation("full") without the loop flag. No animover handler or queued clip.
    instance.sprite.playOnce('full');
    instance.sprite.setSymbolHidden('swap_flower', true);
    const inst = actionEntity(model, STATUEGLOMMER_ID);
    const minimap = instance.minimap;
    minimap.SetIcon('statueglommer.png');
    minimap.SetPriority(5);
    const pickable = new Pickable(model, 'glommerflower', undefined, 1, undefined, undefined,
      { picked: !saved?.components.pickable || saved.components.pickable.picked === true }, { scheduler: this.world.scheduler });
    // Lua's new Pickable has canbepicked=nil; OnInit/full moon may make it full later.
    if (saved?.components.pickable && !saved.components.pickable.picked) pickable.canBePicked = true;
    const inspectable = new Inspectable(inst);
    const leader = new Leader(inst);
    const pointofinterest = new PointOfInterest(inst);
    const hauntable = new Hauntable({ addTag: tag => inst.addTag(tag), removeTag: tag => inst.removeTag(tag),
      PushEvent: (name, data) => inst.PushEvent?.(name, data) }, this.world.scheduler);
    // MakeHauntableWork's active Lua branch returns false (its work attempt is commented out).
    hauntable.SetOnHauntFn(() => false);
    let workable: Workable | undefined = new Workable(inst);
    workable.SetWorkAction('MINE');
    workable.SetWorkLeft(STATUEGLOMMER_WORK);
    workable.savestate = true;
    let lootdropper: LootDropper | undefined = new LootDropper(inst, () => undefined);
    lootdropper.SetChanceLootTable('statueglommer');
    // Component OnLoad invokes OnLoadWorked before the prefab's OnLoad.
    if (saved?.components.workable) {
      workable.OnLoad(saved.components.workable);
      if (workable.GetWorkLeft() <= 0) {
        instance.sprite.playOnce('low');
        workable.dispose(); workable = undefined; lootdropper = undefined;
      } else instance.sprite.playOnce(workable.GetWorkLeft() < STATUEGLOMMER_WORK * .5 ? 'med' : 'full');
    }
    // prefab OnLoad: a separately saved worked flag also removes the two components.
    if (saved?.components.statueglommer?.worked && workable) {
      instance.sprite.playOnce('low');
      workable.dispose(); workable = undefined; lootdropper = undefined;
    }
    if (pickable.canBePicked) {
      instance.sprite.setSymbolOverride('swap_flower', 'glommer_swap_flower.zip', 'swap_flower');
      instance.sprite.setSymbolHidden('swap_flower', false);
      // OnLoad finishes OnLightDirty's six-frame tween immediately for a flower-bearing statue.
      instance.light.set({ radius: .75 * WORLD_SCALE, intensity: .9, falloff: .3,
        colour: [180 / 255, 195 / 255, 150 / 255] });
    }
    const statue: Statue = { instance, display, workable, lootdropper, pickable, hauntable, minimap,
      spawned: saved?.components.statueglommer?.spawned === true,
      stopActivity: watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active)) };
    Object.assign(prefabInstance(model)!.components, { ...(workable ? { workable } : {}), ...(lootdropper ? { lootdropper } : {}),
      inspectable, leader, pointofinterest, hauntable });
    this.statues.set(model, statue);
    this.displays.mount(prefabDisplay(model)!);
    return model;
  }

  update(dt: number): void { for (const { instance } of this.statues.values()) instance.sprite.update(dt); }
  get renderEntities() { return [...this.statues].filter(([, statue]) => statue.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: typeof STATUEGLOMMER_ID; record: StatueGlommerRecord }[] {
    return [...this.statues].map(([model, statue]) => ({ prefabId: STATUEGLOMMER_ID, record: {
      id: String(statue.instance.entityId),
      transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
      components: {
        ...(statue.workable ? { workable: { maxwork: -1 as const, workleft: statue.workable.GetWorkLeft() } } : {}),
        ...(statue.pickable.canBePicked ? { pickable: { caninteractwith: true as const } }
          : { pickable: { picked: true as const, caninteractwith: true as const } }),
        ...(!statue.workable || statue.spawned ? { statueglommer: {
          ...(!statue.workable ? { worked: true as const } : {}), ...(statue.spawned ? { spawned: true as const } : {}),
        } } : {}),
      },
    } }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [model, statue] of this.statues) {
      statue.stopActivity(); statue.pickable.dispose(); statue.workable?.dispose(); statue.hauntable.dispose();
      model.userData.removed = true; statue.instance.remove();
    }
    this.statues.clear(); this.displays.dispose(); this.assets.dispose();

  }
}
