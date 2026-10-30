import { PrefabDisplayGroup } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { Repairable } from '../../componets/src/repairable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { MiniMapState } from '../../map/src/minimapState';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { watchTileActivity } from './tileActivity';
import type { DisplayDrivenPrefabManager, DisplayManagerWorld } from './manager';

export const CHESSJUNK_IDS = ['chessjunk1', 'chessjunk2', 'chessjunk3'] as const;
export type ChessJunkId = typeof CHESSJUNK_IDS[number];
export interface ChessJunkRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { chessJunk?: { repaired?: true; repairerid?: string; repairerchar?: string } };
}
export interface ChessJunkWorld extends DisplayManagerWorld { tickingarea?: TileStateQuery; physics?: World; scheduler: GameTimeScheduler }
interface Pile {
  id: ChessJunkId;
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  workable: Workable;
  repairable: Repairable;
  hauntable: Hauntable;
  minimap: MiniMapState;
  saved?: ChessJunkRecord['components']['chessJunk'];
  stopActivity: () => void;
}

/** chessjunk.lua BasePile(style), OnSave and OnLoad. */
export class ChessJunkManager implements DisplayDrivenPrefabManager<{ prefabId: ChessJunkId; record: ChessJunkRecord }> {
  private readonly assets = new ArchiveSpriteAssets('chessjunk');
  private readonly piles = new Map<THREE.Group, Pile>();
  private disposed = false;
  private readonly displays: PrefabDisplayGroup;
  private readonly world: ChessJunkWorld;
  constructor(scene: THREE.Scene, world: ChessJunkWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }

  spawn(id: ChessJunkId, position: THREE.Vector3, saved?: ChessJunkRecord): THREE.Group {
    if (this.disposed) throw new Error('Chess junk has been disposed');
    const style = Number(id.at(-1));
    const entity = createArchiveEntity(id, { create: clip => createSharedArchiveSprite(this.assets, {
      animationArchive: 'chessmonster_ruins.zip', buildArchives: ['chessmonster_ruins.zip'],
      bank: 'chessmonster_ruins', animation: clip.name, loop: clip.loop,
    }, { instancedAnimations: 'all', name: id }) }, { name: `idle${style}`, billboard: true }, id);
    const { instance, display } = entity, model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.copy(position); model.rotation.y = saved?.transform.rotationY ?? 0;
    instance.addTag('chess'); instance.addTag('mech');
    MakeObstaclePhysics(instance, 1.2);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    // BasePile calls PlayAnimation(idleN) with no loop argument.
    instance.sprite.playOnce(`idle${style}`);
    const inst = actionEntity(model, id);
    const inspectable = new Inspectable(inst);
    const lootdropper = new LootDropper(inst, () => undefined);
    const workable = new Workable(inst);
    workable.SetWorkAction('HAMMER'); workable.SetWorkLeft(3); workable.SetMaxWork(6);
    const repairable = new Repairable(inst, workable, 'gears');
    const hauntable = new Hauntable({ addTag: tag => inst.addTag(tag), removeTag: tag => inst.removeTag(tag),
      PushEvent: (name, data) => inst.PushEvent?.(name, data) }, this.world.scheduler);
    hauntable.SetOnHauntFn(() => false);
    Object.assign(prefabInstance(model)!.components, { inspectable, lootdropper, workable, repairable, hauntable });
    const state = saved?.components.chessJunk;
    if (state?.repaired) {
      // OnLoad sets six work, then OnRepaired plays hitN loop and marks repaired.
      workable.SetWorkLeft(6);
      instance.sprite.start(`hit${style}`);
    }
    const minimap = instance.minimap; minimap.SetIcon('chessjunk.png');
    const pile: Pile = { id, instance, display, workable, repairable, hauntable, minimap, saved: state,
      stopActivity: watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active)) };
    this.piles.set(model, pile); this.displays.mount(display); this.world.trackDisplay(display);
    return model;
  }
  get renderEntities() { return [...this.piles].filter(([, pile]) => pile.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: ChessJunkId; record: ChessJunkRecord }[] {
    return [...this.piles].map(([model, pile]) => ({ prefabId: pile.id, record: {
      id: String(pile.instance.entityId),
      transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
      components: pile.saved?.repaired ? { chessJunk: { repaired: true,
        ...(pile.saved.repairerid === undefined ? {} : { repairerid: pile.saved.repairerid }),
        ...(pile.saved.repairerchar === undefined ? {} : { repairerchar: pile.saved.repairerchar }) } } : {},
    } }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [model, pile] of this.piles) {
      pile.stopActivity(); pile.workable.dispose(); pile.repairable.dispose(); pile.hauntable.dispose();
      model.userData.removed = true; pile.instance.remove();
    }
    this.piles.clear(); this.displays.dispose(); this.assets.dispose();

  }
}
