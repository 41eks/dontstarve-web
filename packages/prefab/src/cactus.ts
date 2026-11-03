import { Pickable } from './components/pickable';
import { DefaultBurnFn, DefaultExtinguishFn, DefaultBurntFn } from './standardcomponents';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type * as THREE from 'three';
import { WorldContentKey, type SeasonState, type WorldContentSignal } from '@dontstarve-web/signals';
import type { PickDoer } from '@dontstarve-web/stategraphs/pick';
import { PickablePlantManager, PickablePlantInstance, type PickablePlantContext,
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
export class CactusInstance extends PickablePlantInstance {
  private readonly season?: WorldContentSignal<SeasonState>;
  private readonly cleanups: (() => void)[] = [];
  private has_flower = false;

  constructor(prefab: CactusId, context: PickablePlantContext) {
    super(CACTUS_DEFINITIONS[prefab], context);
    new Pickable(this, 'cactus_meat', CACTUS_REGROW_TIME, 1, doer => this.picked(doer), () => this.regen(), context.saved?.components.pickable, {
      scheduler: context.scheduler, growthDuration: context.growthDuration,
      onTransplant: () => this.components.pickable.MakeEmpty(), onEmpty: () => this.empty(),
    });
    this.bindBurnable({ propagator: 'medium', burnTime: 30, fxLevel: 4,
      onIgnite: () => DefaultBurnFn(this), onExtinguish: () => DefaultExtinguishFn(this), onBurnt: () => DefaultBurntFn(this, context.world) });
    this.onRemove(() => { for (const cleanup of this.cleanups.splice(0)) cleanup(); });
    this.season = context.getWatchWorldContent?.(WorldContentKey.Season, cleanup => this.cleanups.push(cleanup));
  }

  /** TheWorld.state.issummer, read when a callback runs. */
  private get issummer(): boolean { return this.season?.peek().season === 'summer'; }

  override initialize(): void {
    const { pickable } = this.components; const animation = this.sprite;
    if (pickable.canBePicked) {
      this.has_flower = this.issummer;
      if (this.has_flower) {
        this.play(['idle_flower'], true);
        animation.setFrame(Math.floor(Math.random() * animation.numFrames));
      }
    } else this.empty();
  }

  /** onpickedfn */
  picked(doer?: PickDoer): void {
    const { physics } = this; const instance = this;
    physics.SetActive(false);
    this.play([this.has_flower ? 'picked_flower' : 'picked', 'empty'], true);
    const picker = doer?.picker;
    if (picker) {
      const { combat, inventory } = picker.components;
      if (combat && !inventory?.EquipHasTag('bramble_resistant') && !picker.hasTag('shadowminion')) {
        combat.GetAttacked(instance, CACTUS_DAMAGE);
        picker.PushEvent?.('thorns');
      }
      if (this.has_flower) this.giveFlower(picker.components.inventory?.GiveItem?.bind(picker.components.inventory), instance.position);
    }
    this.has_flower = false;
  }

  private giveFlower(give: ((item: import('@dontstarve-web/inventory').ItemEntity, source?: THREE.Vector3) => boolean) | undefined,
    position: ReadonlyVector3): void {
    const loot = this.context.world.spawnItem?.({ itemId: CACTUS_FLOWER_ID, count: 1 });
    if (!loot) return;
    if (give) give(loot, position.clone());
    else this.context.world.dropItem?.(loot, position.clone());
  }

  /** onregenfn */
  regen(): void {
    const { physics } = this;
    this.has_flower = this.issummer;
    this.play(this.has_flower ? ['grow_flower', 'idle_flower'] : ['grow', 'idle'], true);
    physics.SetActive(true);
  }

  /** makeemptyfn */
  empty(): void {
    this.physics.SetActive(false);
    this.play(['empty'], true);
    this.has_flower = false;
  }
}

/** cactus.lua MakeCactus(name): bank/build share the name; MakeLargeBurnable, MakeMediumPropagator, MakeObstaclePhysics(.3). */
function cactusDefinition(prefab: CactusId): PickablePlantDefinition {
  return {
    prefab,
    animArchive: `${prefab}.zip`,
    buildArchive: `${prefab}.zip`,
    archiveSprite: { bank: prefab, instancedAnimations: 'all' },
    tags: ['plant', 'thorny'],
    idle: { name: 'idle', randomFrame: true },
    empty: { name: 'empty', frame: 'first' },
    physicsRadius: .3,
    obstaclePhysics: true,
    minimapIcon: `${prefab}.png`,
    createInstance: context => new CactusInstance(prefab, context),
  };
}
export const CACTUS_DEFINITIONS: Readonly<Record<CactusId, PickablePlantDefinition>> = {
  cactus: cactusDefinition(CACTUS_ID),
  oasis_cactus: cactusDefinition(OASIS_CACTUS_ID),
};

/** cactus.lua: PICK cactus_meat (and a summer flower) at the cost of thorns, burning and regrowth. */
export class CactusManager extends PickablePlantManager {
  spawn(prefabId: CactusId, position: ReadonlyVector3, saved?: CactusRecord): THREE.Group {
    return this.spawnPlant(CACTUS_DEFINITIONS[prefabId], position, saved);
  }

  exportRecords(): { prefabId: CactusId; record: CactusRecord }[] {
    return this.exportPlants().map(({ prefab, record }) => ({ prefabId: prefab as CactusId, record }));
  }
}
