import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { PrefabDisplay, PrefabDisplayGroup, SpriteResources, SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { LootDropper, SetSharedLootTable, type ChanceLootTable } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, bindInstance } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import { actionEntity } from './actionEntity';
import { PlaySound } from './sound';
import type { DisplayDrivenPrefabManager, DisplayManagerWorld } from './manager';

export const STALAGMITE_IDS = ['stalagmite', 'stalagmite_full', 'stalagmite_med', 'stalagmite_low',
  'stalagmite_tall', 'stalagmite_tall_full', 'stalagmite_tall_med', 'stalagmite_tall_low'] as const;
export type StalagmiteId = typeof STALAGMITE_IDS[number];
type Stage = 'full' | 'med' | 'low';
export const stalagmiteBank = (id: StalagmiteId): string => id.startsWith('stalagmite_tall') ? 'rock_stalagmite_tall' : 'rock_stalagmite';
const initialStage = (id: StalagmiteId): Stage => id.endsWith('_low') ? 'low' : id.endsWith('_med') ? 'med' : 'full';
const WORK = { full: 6, med: 4, low: 2 } as const; // tuning.lua ROCKS_MINE / ROCKS_MINE_MED / ROCKS_MINE_LOW.

// These are the literal tables in stalagmite.lua and stalagmite_tall.lua, selected by constructor, not workleft.
const LOOT: Readonly<Record<string, ChanceLootTable>> = {
  full_rock: [['rocks', 1], ['rocks', 1], ['rocks', 1], ['goldnugget', 1], ['flint', 1], ['fossil_piece', .1],
    ['goldnugget', .25], ['flint', .6], ['bluegem', .05], ['redgem', .05]],
  med_rock: [['rocks', 1], ['rocks', 1], ['flint', 1], ['goldnugget', .5], ['fossil_piece', .1], ['flint', .6]],
  low_rock: [['rocks', 1], ['flint', 1], ['goldnugget', .5], ['fossil_piece', .1], ['flint', .3]],
  stalagmite_tall_full_rock: [['rocks', 1], ['rocks', 1], ['goldnugget', 1], ['flint', 1], ['fossil_piece', .1],
    ['goldnugget', .25], ['flint', .6], ['redgem', .05], ['log', .05]],
  stalagmite_tall_med_rock: [['rocks', 1], ['rocks', 1], ['flint', 1], ['fossil_piece', .1], ['goldnugget', .15], ['flint', .6]],
  stalagmite_tall_low_rock: [['rocks', 1], ['flint', 1], ['fossil_piece', .1], ['goldnugget', .15], ['flint', .3]],
};
for (const [name, entries] of Object.entries(LOOT)) SetSharedLootTable(name, entries);

/** Neither prefab has OnSave / OnLoad; workable.savestate stays false. */
export interface StalagmiteRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}
export interface StalagmiteWorld extends DisplayManagerWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  physics?: World;
  spawnLoot: ConstructorParameters<typeof LootDropper>[1];
}

/** Source commonfn + fullrock/medrock/lowrock: synchronous logical construction, including when restoring a save. */
export class StalagmiteInstance extends PrefabInstance<SpriteState> {
  readonly prefabId: StalagmiteId;
  /** The source tall rock's inst.type; not saved and never rerolled when only the visual sleeps. */
  readonly type: '' | '_1' | '_2';
  readonly prefabNameOverride: 'stalagmite' | 'stalagmite_tall';
  readonly scrapbookAnimation: 'full' | 'full_1';

  constructor(id: StalagmiteId, world: StalagmiteWorld, saved?: StalagmiteRecord) {
    const tall = id.startsWith('stalagmite_tall'), stage = initialStage(id);
    const type = tall ? Math.random() < .5 ? '_1' : '_2' : '';
    super(id, new SpriteState({ name: stage + type, held: true, billboard: true }));
    this.prefabId = id; this.type = type;
    this.prefabNameOverride = tall ? 'stalagmite_tall' : 'stalagmite';
    this.scrapbookAnimation = tall ? 'full_1' : 'full';
    this.entityId = saved?.id ?? newEntityId(); this.saveRecord = saved;
    this.minimap.SetIcon(`${this.prefabNameOverride}.png`);
    MakeObstaclePhysics(this, 1);
    this.addTag('boulder');
    this.sprite.playOnce(stage + type); // PlayAnimation(anim) / PlayAnimation(anim..inst.type), never looping.
    const colour = .5 + Math.random() * .5;
    this.sprite.setColour([colour, colour, colour]);
    const lootdropper = new LootDropper(this, world.spawnLoot);
    const workable = new Workable(this);
    workable.SetWorkAction('MINE'); workable.SetWorkLeft(WORK.full);
    workable.SetOnWorkCallback((_inst, _worker, workleft) => {
      if (workleft <= 0) {
        // rock_break_fx.lua has no art: its local proxy only plays this sound.
        PlaySound('dontstarve/wilson/rock_break', this.position);
        lootdropper.DropLoot(this.position); this.remove();
      } else {
        const next = workleft <= WORK.full / 3 ? 'low' : workleft <= WORK.full * 2 / 3 ? 'med' : 'full';
        this.sprite.playOnce(next + this.type);
      }
    });
    const hauntable = new Hauntable(this, world.scheduler);
    hauntable.SetOnHauntFn(() => false); // MakeHauntableWork's work code is commented out in source.
    Object.assign(this.components, { lootdropper, workable, hauntable, inspectable: new Inspectable(this) });
    // Inspectable is an existing constructor-only dependency, so retain its source constructor tag here.
    this.addTag('inspectable');
    if (stage !== 'full') workable.SetWorkLeft(WORK[stage]);
    lootdropper.SetChanceLootTable(`${tall ? 'stalagmite_tall_' : ''}${stage}_rock`);
    this.onRemove(() => { workable.dispose(); hauntable.dispose(); });
    // No prefab OnLoad or workable saved fields override the constructor's stage/work count/type/colour.
  }
}

export class StalagmiteManager implements DisplayDrivenPrefabManager<{ prefabId: StalagmiteId; record: StalagmiteRecord }> {
  private readonly resources = new SpriteResources(undefined, 'stalagmite');
  private readonly displays: PrefabDisplayGroup;
  private readonly world: StalagmiteWorld;
  private readonly instances = new Map<THREE.Group, StalagmiteInstance>();
  private disposed = false;
  constructor(scene: THREE.Scene, world: StalagmiteWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }

  spawn(id: StalagmiteId, position: THREE.Vector3, saved?: StalagmiteRecord): THREE.Group {
    if (this.disposed) throw new Error('Stalagmites disposed');
    const instance = new StalagmiteInstance(id, this.world, saved), bank = stalagmiteBank(id);
    const display = new PrefabDisplay({ root: instance.transform.model, name: id, status: instance.status, sprite: instance.sprite,
      archive: this.resources.archive({ animationArchive: `${bank}.zip`, buildArchives: [`${bank}.zip`], bank },
        { instancedAnimations: 'all', colour: [1, 1, 1] }) });
    const model = display.model; bindInstance(model, instance);
    instance.position.copy(position); model.rotation.y = saved?.transform.rotationY ?? 0;
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    const stop = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => { stop(); this.instances.delete(model); });
    actionEntity(model, id);
    this.instances.set(model, instance); this.displays.mount(display); this.world.trackDisplay(display);
    return model;
  }
  get renderEntities() { return [...this.instances].filter(([, inst]) => inst.sprite.loaded)
    .map(([object, inst]) => ({ object, footPosition: inst.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: StalagmiteId; record: StalagmiteRecord }[] {
    return [...this.instances].filter(([, inst]) => inst.persists && !inst.isRemoved).map(([model, inst]) => ({
      prefabId: inst.prefabId,
      record: { id: String(inst.entityId), transform: { position: inst.position.toArray(), rotationY: model.rotation.y }, components: {} },
    }));
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const inst of this.instances.values()) inst.remove();
    this.instances.clear(); this.displays.dispose(); this.resources.dispose();
  }
}
