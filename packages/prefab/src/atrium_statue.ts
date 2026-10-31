import { PrefabDisplayGroup } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { World } from 'cannon-es';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { RoseInspectable } from '../../componets/src/pandoraschestSignatures';
import type { MiniMapState } from '../../map/src/minimapState';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { watchTileActivity } from './tileActivity';
import type { DisplayDrivenPrefabManager, DisplayManagerWorld } from './manager';

export const ATRIUM_STATUE_ID = 'atrium_statue' as const;
/** atrium_statue.lua writes no OnSave data: the record holds only identity and transform. */
export interface AtriumStatueRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}
export interface AtriumStatueWorld extends DisplayManagerWorld { tickingarea?: TileStateQuery; physics?: World }
interface Statue {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  minimap: MiniMapState;
  stopActivity: () => void;
}

/**
 * atrium_statue.lua MakeStatue("atrium_statue", false). Its workable and lootdropper are commented out in the source,
 * so the statue cannot be mined; it has no tags and no skins.
 */
export class AtriumStatueManager implements DisplayDrivenPrefabManager<{ prefabId: typeof ATRIUM_STATUE_ID; record: AtriumStatueRecord }> {
  private readonly assets = new ArchiveSpriteAssets(ATRIUM_STATUE_ID);
  private readonly statues = new Map<THREE.Group, Statue>();
  private disposed = false;
  private readonly displays: PrefabDisplayGroup;
  private readonly world: AtriumStatueWorld;
  constructor(scene: THREE.Scene, world: AtriumStatueWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }

  spawn(position: THREE.Vector3, saved?: AtriumStatueRecord): THREE.Group {
    if (this.disposed) throw new Error('Atrium statues have been disposed');
    // fn: SetBank("atrium_statue"), SetBuild("atrium_statue"), PlayAnimation("idle_full") without looping.
    const entity = createArchiveEntity(ATRIUM_STATUE_ID, { create: clip => createSharedArchiveSprite(this.assets, {
      animationArchive: 'atrium_statue.zip', buildArchives: ['atrium_statue.zip'],
      bank: 'atrium_statue', animation: clip.name, loop: clip.loop,
    }, { instancedAnimations: 'all', name: ATRIUM_STATUE_ID }) }, { name: 'idle_full', held: true, billboard: true }, ATRIUM_STATUE_ID);
    const { instance, display } = entity, model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.copy(position); model.rotation.y = saved?.transform.rotationY ?? 0;
    MakeObstaclePhysics(instance, .45);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    const minimap = instance.minimap; minimap.SetIcon('atrium_statue.png');
    const inst = actionEntity(model, ATRIUM_STATUE_ID);
    Object.assign(instance.components, {
      inspectable: new Inspectable(inst),
      // MakeRoseTarget_CreateFuel_IncreasedHorror.
      roseinspectable: new RoseInspectable(inst),
    });
    // OnNightmarePhaseChanged(inst, TheWorld.state.nightmarephase, true) -> ShowPhaseState(instant) -> OnWorked with
    // MARBLEPILLAR_MINE: PlayAnimation("idle_full" .. _suffix, true). This world has no nightmare clock, so the phase is
    // never "wild" and the suffix stays "". There is no OnLoad, so a loaded statue declares the same clips.
    instance.sprite.start('idle_full');
    const statue: Statue = { instance, display, minimap,
      stopActivity: watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active)) };
    this.statues.set(model, statue); this.displays.mount(display); this.world.trackDisplay(display);
    return model;
  }
  get renderEntities() { return [...this.statues].filter(([, statue]) => statue.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: typeof ATRIUM_STATUE_ID; record: AtriumStatueRecord }[] {
    return [...this.statues].map(([model, statue]) => ({ prefabId: ATRIUM_STATUE_ID, record: {
      id: String(statue.instance.entityId),
      transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
      components: {},
    } }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const statue of this.statues.values()) { statue.stopActivity(); statue.instance.remove(); }
    this.statues.clear(); this.displays.dispose(); this.assets.dispose();
  }
}
