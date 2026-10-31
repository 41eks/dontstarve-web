import { PrefabDisplayGroup } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
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

export const RUINS_STATUE_MAGE_ID = 'ruins_statue_mage' as const;
export const RUINS_STATUE_HEAD_NOGEM_ID = 'ruins_statue_head_nogem' as const;
export const RUINS_STATUE_GEMS = ['greengem', 'redgem', 'bluegem', 'yellowgem', 'orangegem', 'purplegem'] as const;
export type RuinsStatueGem = typeof RUINS_STATUE_GEMS[number];
interface RuinsStatueSaveRecord<Components> {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Components;
}
export type RuinsStatueMageRecord = RuinsStatueSaveRecord<{ ruinsStatueMage: { gem: RuinsStatueGem } }>;
/** nogem() never calls SetGemmed, so onsave writes `gem = nil`: the record holds only identity and transform. */
export type RuinsStatueHeadNoGemRecord = RuinsStatueSaveRecord<Record<string, never>>;
interface RuinsStatueRecords {
  [RUINS_STATUE_MAGE_ID]: RuinsStatueMageRecord;
  [RUINS_STATUE_HEAD_NOGEM_ID]: RuinsStatueHeadNoGemRecord;
}
export type RuinsStatueId = keyof RuinsStatueRecords;
export interface RuinsStatueMageWorld extends DisplayManagerWorld { tickingarea?: TileStateQuery; physics?: World; scheduler: GameTimeScheduler }

// statueruins.lua SetSharedLootTable('statue_ruins_no_gem', ...).
SetSharedLootTable('statue_ruins_no_gem', [['thulecite', 1], ['nightmarefuel', 1], ['thulecite', .05]]);

/** commonfn(small): SetBank / SetBuild; gem() adds SetGemmed from the matching gem build, nogem() a chance loot table. */
const VARIANTS: Readonly<Record<RuinsStatueId, { archive: string; bank: string; gemArchive?: string; chanceLootTable?: string }>> = {
  [RUINS_STATUE_MAGE_ID]: { archive: 'statue_ruins.zip', bank: 'statue_ruins', gemArchive: 'statue_ruins_gem.zip' },
  [RUINS_STATUE_HEAD_NOGEM_ID]: { archive: 'statue_ruins_small.zip', bank: 'statue_ruins_small', chanceLootTable: 'statue_ruins_no_gem' },
};

interface Statue {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  workable: Workable;
  hauntable: Hauntable;
  minimap: MiniMapState;
  gem?: RuinsStatueGem;
  stopActivity: () => void;
}

/** statueruins.lua commonfn() with gem() or nogem(); one manager per prefab and its art. */
export class RuinsStatueManager<Id extends RuinsStatueId> implements DisplayDrivenPrefabManager<{ prefabId: Id; record: RuinsStatueRecords[Id] }> {
  private readonly assets: ArchiveSpriteAssets;
  private readonly statues = new Map<THREE.Group, Statue>();
  private disposed = false;
  private readonly displays: PrefabDisplayGroup;
  private readonly world: RuinsStatueMageWorld;
  private readonly prefabId: Id;
  constructor(scene: THREE.Scene, world: RuinsStatueMageWorld, prefabId: Id) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world; this.prefabId = prefabId;
    this.assets = new ArchiveSpriteAssets(prefabId);
  }

  spawn(position: THREE.Vector3, saved?: RuinsStatueRecords[Id]): THREE.Group {
    if (this.disposed) throw new Error('Ruins statues have been disposed');
    const id = this.prefabId, variant = VARIANTS[id];
    const entity = createArchiveEntity(id, { create: clip => createSharedArchiveSprite(this.assets, {
      animationArchive: variant.archive, buildArchives: [variant.archive, ...variant.gemArchive ? [variant.gemArchive] : []],
      bank: variant.bank, animation: clip.name, loop: clip.loop,
    }, { instancedAnimations: 'all', name: id }) },
    { name: 'idle_full', billboard: true }, id);
    const { instance, display } = entity, model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.copy(position); model.rotation.y = saved?.transform.rotationY ?? 0;
    for (const tag of ['cavedweller', 'structure', 'statue']) instance.addTag(tag);
    MakeObstaclePhysics(instance, .66);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    const inst = actionEntity(model, id);
    const workable = new Workable(inst);
    workable.SetWorkAction('MINE'); workable.SetWorkLeft(10);
    const lootdropper = new LootDropper(inst, () => undefined);
    if (variant.chanceLootTable) lootdropper.SetChanceLootTable(variant.chanceLootTable);
    const inspectable = new Inspectable(inst);
    const hauntable = new Hauntable({ addTag: tag => inst.addTag(tag), removeTag: tag => inst.removeTag(tag),
      PushEvent: (name, data) => inst.PushEvent?.(name, data) }, this.world.scheduler);
    hauntable.SetOnHauntFn(() => false);
    Object.assign(prefabInstance(model)!.components, { workable, lootdropper, inspectable, hauntable });
    // commonfn immediately invokes OnNightmarePhaseChanged(..., true): ShowWorkState plays idle_full looping, with no
    // `_night` suffix because this world has the calm phase.
    instance.sprite.start('idle_full');
    let gem: RuinsStatueGem | undefined;
    if (variant.gemArchive) {
      // gem() chooses a gem; OnLoad calls SetGemmed again when data.gem exists.
      const initialGem = RUINS_STATUE_GEMS[Math.floor(Math.random() * RUINS_STATUE_GEMS.length)];
      instance.sprite.setSymbolOverride('swap_gem', variant.gemArchive, initialGem);
      gem = (saved as RuinsStatueMageRecord | undefined)?.components.ruinsStatueMage.gem ?? initialGem;
      if (saved) instance.sprite.setSymbolOverride('swap_gem', variant.gemArchive, gem);
    }
    const minimap = instance.minimap; minimap.SetIcon('statue_ruins.png');
    const statue: Statue = { instance, display, workable, hauntable, minimap, gem,
      stopActivity: watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active)) };
    this.statues.set(model, statue); this.displays.mount(display); this.world.trackDisplay(display);
    return model;
  }
  get renderEntities() { return [...this.statues].filter(([, statue]) => statue.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: Id; record: RuinsStatueRecords[Id] }[] {
    return [...this.statues].map(([model, statue]) => ({ prefabId: this.prefabId, record: {
      id: String(statue.instance.entityId),
      transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
      // onsave: data.gem = inst.gemmed.
      components: statue.gem === undefined ? {} : { ruinsStatueMage: { gem: statue.gem } },
    } as RuinsStatueRecords[Id] }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [model, statue] of this.statues) {
      statue.stopActivity(); statue.workable.dispose(); statue.hauntable.dispose();
      model.userData.removed = true; statue.instance.remove();
    }
    this.statues.clear(); this.displays.dispose(); this.assets.dispose();
  }
}

/** statueruins.lua gem() / commonfn() for the large mage statue. */
export class RuinsStatueMageManager extends RuinsStatueManager<typeof RUINS_STATUE_MAGE_ID> {
  constructor(scene: THREE.Scene, world: RuinsStatueMageWorld) { super(scene, world, RUINS_STATUE_MAGE_ID); }
}
