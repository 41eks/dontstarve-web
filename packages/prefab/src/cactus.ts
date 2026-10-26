import type * as THREE from 'three';
import { WorldContentKey, type SeasonState, type WorldContentSignal } from '@dontstarve-web/signals';
import type { PickDoer } from '@dontstarve-web/stategraphs/pick';
import { actionEntity } from './actionEntity';
import { PickablePlantManager, type PickablePlantBehavior, type PickablePlantBehaviorContext,
  type PickablePlantDefinition, type PickablePlantRecord } from './pickablePlant';

export const CACTUS_ID = 'cactus' as const;
export const OASIS_CACTUS_ID = 'oasis_cactus' as const;
export const CACTUS_IDS = [CACTUS_ID, OASIS_CACTUS_ID] as const;
export type CactusId = typeof CACTUS_IDS[number];
export const CACTUS_FLOWER_ID = 'cactus_flower';
/** tuning.lua CACTUS_DAMAGE = wilson_health * .04. */
export const CACTUS_DAMAGE = 150 * .04;
/** tuning.lua CACTUS_REGROW_TIME = total_day_time * 4. */
export const CACTUS_REGROW_TIME = 4 * 480;

export type CactusRecord = PickablePlantRecord;

/**
 * cactus.lua: picking hurts a picker without bramble_resistant equipment, and a summer cactus also gives its flower.
 * has_flower is not saved; on load it follows the season, as OnEntityWake does.
 */
class Cactus implements PickablePlantBehavior {
  private readonly context: PickablePlantBehaviorContext;
  private readonly prefab: CactusId;
  private readonly season?: WorldContentSignal<SeasonState>;
  private readonly cleanups: (() => void)[] = [];
  private has_flower = false;

  constructor(context: PickablePlantBehaviorContext, prefab: CactusId) {
    this.context = context; this.prefab = prefab;
    this.season = context.getWatchWorldContent?.(WorldContentKey.Season, cleanup => this.cleanups.push(cleanup));
  }

  /** TheWorld.state.issummer, read when a callback runs. */
  private get issummer(): boolean { return this.season?.peek().season === 'summer'; }

  initialize(): void {
    const { pickable, animation, play } = this.context;
    if (pickable.canBePicked) {
      this.has_flower = this.issummer;
      if (this.has_flower) {
        play(['idle_flower'], true);
        animation.setFrame(Math.floor(Math.random() * animation.numFrames));
      }
    } else this.empty();
  }

  /** onpickedfn */
  picked(doer?: PickDoer): void {
    const { physics, play, model } = this.context;
    physics.SetActive(false);
    play([this.has_flower ? 'picked_flower' : 'picked', 'empty'], true);
    const picker = doer?.picker;
    if (picker) {
      const { combat, inventory } = picker.components;
      if (combat && !inventory?.EquipHasTag('bramble_resistant') && !picker.hasTag('shadowminion')) {
        combat.GetAttacked(actionEntity(model, this.prefab), CACTUS_DAMAGE);
        picker.PushEvent?.('thorns');
      }
      if (this.has_flower) this.giveFlower(picker.components.inventory?.GiveItem?.bind(picker.components.inventory), model.position);
    }
    this.has_flower = false;
  }

  private giveFlower(give: ((item: import('@dontstarve-web/inventory').ItemEntity, source?: THREE.Vector3) => boolean) | undefined,
    position: THREE.Vector3): void {
    const loot = this.context.spawnItem?.({ itemId: CACTUS_FLOWER_ID, count: 1 });
    if (!loot) return;
    if (give) give(loot, position.clone());
    else this.context.dropItem?.(loot, position.clone());
  }

  /** onregenfn */
  regen(): void {
    const { physics, play } = this.context;
    this.has_flower = this.issummer;
    play(this.has_flower ? ['grow_flower', 'idle_flower'] : ['grow', 'idle'], true);
    physics.SetActive(true);
  }

  /** makeemptyfn */
  empty(): void {
    this.context.physics.SetActive(false);
    this.context.play(['empty'], true);
    this.has_flower = false;
  }

  barren(): void {}
  burnt(): void {}
  exportState(): PickablePlantRecord['components'] { return {}; }
  dispose(): void { for (const cleanup of this.cleanups.splice(0)) cleanup(); }
}

/** cactus.lua MakeCactus(name): bank/build share the name; MakeLargeBurnable, MakeMediumPropagator, MakeObstaclePhysics(.3). */
function cactusDefinition(prefab: CactusId): PickablePlantDefinition {
  return {
    prefab,
    animArchive: `${prefab}.zip`,
    buildArchive: `${prefab}.zip`,
    archiveSprite: { bank: prefab, instancedAnimations: 'all' },
    tags: ['plant', 'thorny'],
    product: 'cactus_meat',
    regrowTime: CACTUS_REGROW_TIME,
    // No MakeNoGrowInWinter; pickable.picksound is read by WX-78's stategraph, not the player's.
    noGrowInWinter: false,
    idle: { name: 'idle', randomFrame: true },
    picked: { clips: ['picked', 'empty'] },
    empty: { name: 'empty', frame: 'first' },
    grow: 'grow',
    burnTime: 30,
    burnFxLevel: 4,
    propagatorSize: 'medium',
    physicsRadius: .3,
    obstaclePhysics: true,
    minimapIcon: `${prefab}.png`,
    onTransplant: pickable => pickable.MakeEmpty(),
    createBehavior: context => new Cactus(context, prefab),
  };
}
export const CACTUS_DEFINITIONS: Readonly<Record<CactusId, PickablePlantDefinition>> = {
  cactus: cactusDefinition(CACTUS_ID),
  oasis_cactus: cactusDefinition(OASIS_CACTUS_ID),
};

/** cactus.lua: PICK cactus_meat (and a summer flower) at the cost of thorns, burning and regrowth. */
export class CactusManager extends PickablePlantManager {
  spawn(prefabId: CactusId, position: THREE.Vector3, saved?: CactusRecord): Promise<THREE.Group> {
    return this.spawnPlant(CACTUS_DEFINITIONS[prefabId], position, saved);
  }

  exportRecords(): { prefabId: CactusId; record: CactusRecord }[] {
    return this.exportPlants().map(({ prefab, record }) => ({ prefabId: prefab as CactusId, record }));
  }
}
