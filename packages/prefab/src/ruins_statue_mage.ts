import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import { LootDropper } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { MiniMapEntity } from './minimapEntity';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { watchTileActivity } from './tileActivity';
import type { DisplayDrivenPrefabManager, DisplayManagerWorld } from './manager';

export const RUINS_STATUE_MAGE_ID = 'ruins_statue_mage' as const;
export const RUINS_STATUE_GEMS = ['greengem', 'redgem', 'bluegem', 'yellowgem', 'orangegem', 'purplegem'] as const;
export type RuinsStatueGem = typeof RUINS_STATUE_GEMS[number];
export interface RuinsStatueMageRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { ruinsStatueMage: { gem: RuinsStatueGem } };
}
export interface RuinsStatueMageWorld extends DisplayManagerWorld { tickingarea?: TileStateQuery; physics?: World; scheduler: GameTimeScheduler }
interface Statue {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  workable: Workable;
  hauntable: Hauntable;
  minimap: MiniMapEntity;
  gem: RuinsStatueGem;
  stopActivity: () => void;
}

/** statueruins.lua gem() / commonfn() for the large mage statue. */
export class RuinsStatueMageManager implements DisplayDrivenPrefabManager<{ prefabId: typeof RUINS_STATUE_MAGE_ID; record: RuinsStatueMageRecord }> {
  private readonly assets = new ArchiveSpriteAssets(RUINS_STATUE_MAGE_ID);
  private readonly statues = new Map<THREE.Group, Statue>();
  private disposed = false;
  private readonly scene: THREE.Scene;
  private readonly world: RuinsStatueMageWorld;
  constructor(scene: THREE.Scene, world: RuinsStatueMageWorld) { this.scene = scene; this.world = world; }

  spawn(position: THREE.Vector3, saved?: RuinsStatueMageRecord): THREE.Group {
    if (this.disposed) throw new Error('Ruins mage statues have been disposed');
    const entity = createArchiveEntity(RUINS_STATUE_MAGE_ID, { create: clip => createSharedArchiveSprite(this.assets, {
      animationArchive: 'statue_ruins.zip', buildArchives: ['statue_ruins.zip', 'statue_ruins_gem.zip'],
      bank: 'statue_ruins', animation: clip.name, loop: clip.loop,
    }, { instancedAnimations: 'all', name: RUINS_STATUE_MAGE_ID }) },
    { name: 'idle_full', billboard: true }, RUINS_STATUE_MAGE_ID);
    const { instance, display } = entity, model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.copy(position); model.rotation.y = saved?.transform.rotationY ?? 0;
    for (const tag of ['cavedweller', 'structure', 'statue']) instance.addTag(tag);
    MakeObstaclePhysics(instance, .66);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    const inst = actionEntity(model, RUINS_STATUE_MAGE_ID);
    const workable = new Workable(inst);
    workable.SetWorkAction('MINE'); workable.SetWorkLeft(10);
    const lootdropper = new LootDropper(inst, () => undefined);
    const inspectable = new Inspectable(inst);
    const hauntable = new Hauntable({ addTag: tag => inst.addTag(tag), removeTag: tag => inst.removeTag(tag),
      PushEvent: (name, data) => inst.PushEvent?.(name, data) }, this.world.scheduler);
    hauntable.SetOnHauntFn(() => false);
    Object.assign(model.userData.components, { workable, lootdropper, inspectable, hauntable });
    const initialGem = RUINS_STATUE_GEMS[Math.floor(Math.random() * RUINS_STATUE_GEMS.length)];
    // commonfn immediately invokes OnNightmarePhaseChanged(..., true); this world has the calm phase.
    instance.sprite.start('idle_full');
    // gem() chooses a gem; OnLoad calls SetGemmed again when data.gem exists.
    instance.sprite.setSymbolOverride('swap_gem', 'statue_ruins_gem.zip', initialGem);
    const gem = saved?.components.ruinsStatueMage.gem ?? initialGem;
    if (saved) instance.sprite.setSymbolOverride('swap_gem', 'statue_ruins_gem.zip', gem);
    const minimap = new MiniMapEntity(model.position); minimap.SetIcon('statue_ruins.png');
    const statue: Statue = { instance, display, workable, hauntable, minimap, gem,
      stopActivity: watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active)) };
    this.statues.set(model, statue); display.mount(this.scene); this.world.trackDisplay(display);
    return model;
  }
  get renderEntities() { return [...this.statues].filter(([, statue]) => statue.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  get miniMapEntities(): MiniMapEntity[] { return [...this.statues.values()].map(({ minimap }) => minimap); }
  exportRecords(): { prefabId: typeof RUINS_STATUE_MAGE_ID; record: RuinsStatueMageRecord }[] {
    return [...this.statues].map(([model, statue]) => ({ prefabId: RUINS_STATUE_MAGE_ID, record: {
      id: String(statue.instance.entityId),
      transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
      components: { ruinsStatueMage: { gem: statue.gem } },
    } }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const [model, statue] of this.statues) {
      statue.stopActivity(); statue.workable.dispose(); statue.hauntable.dispose(); statue.minimap.dispose();
      model.userData.removed = true; statue.instance.remove();
    }
    this.statues.clear(); this.assets.dispose();
  }
}
