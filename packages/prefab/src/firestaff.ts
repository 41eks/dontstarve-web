import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle } from '@dontstarve-web/signals';
import { WORLD_SCALE } from './standardcomponents';
import type { CombatActor, CombatInst } from '../../componets/src/combat';
import type { Projectile, ProjectileTarget } from '../../componets/src/projectile';
import type { Burnable } from '../../componets/src/burnable';
import type { WorkInst } from '../../componets/src/workable';
import type { EquipmentVisualFactory } from './equipmentVisual';
import { staffVisual } from './yellowstaff';
import { FIRE_PROJECTILE_ID } from './staff_projectile';

export const FIRESTAFF_ID = 'firestaff' as const;
/** tuning.lua FIRESTAFF_USES and SANITY_SUPERTINY. */
export const FIRESTAFF_USES = 20;
const SANITY_SUPERTINY = 1;
/** staff.lua red(): inst.projectiledelay = FRAMES. */
const PROJECTILE_DELAY = 1 / 30;
/** staff.lua weapon:SetRange(8, 10), in scene units. */
const ATTACK_RANGE = 8 * WORLD_SCALE;
const HIT_RANGE = 10 * WORLD_SCALE;
export const FIRESTAFF_SOUNDS = ['dontstarve/wilson/attack_firestaff', 'dontstarve/wilson/fireball_explo'] as const;
export const FIRESTAFF_TAGS = ['firestaff', 'rangedweapon', 'rangedlighter', 'shadowlevel'] as const;

export interface FireStaffWorld {
  /** Load the projectile art and the effect an unlit hit leaves, before the first attack. */
  prepare(): Promise<void>;
  /** SpawnPrefab("fire_projectile") at the attacker, thrown at the target. */
  launch(owner: ItemEntity, target: ProjectileTarget, attacker: CombatActor): Projectile;
  /** SpawnPrefab("cutgrass"): the burnable fuel offered to a target that takes it. */
  createFuel?(): FuelItemLike | undefined;
}
interface FuelItemLike {
  remove(): boolean;
  readonly components: { fuel?: { readonly fueltype: string } };
}

/** What onattack_red reads from a target besides burnable. */
export interface FireStaffTarget extends CombatInst {
  readonly components: CombatInst['components'] & {
    burnable?: Burnable;
    freezable?: { IsFrozen(): boolean; Unfreeze(): void; AddColdness(amount: number): void };
    fueled?: { readonly fueltype: string; readonly secondaryfueltype?: string; readonly accepting: boolean; TakeFuelItem(item: FuelItemLike): boolean };
    sleeper?: { IsAsleep(): boolean; WakeUp(): void };
  };
  readonly isRemoved?: boolean;
  PushEvent?(name: string, data: unknown): void;
}
export interface FireStaffAttacker extends CombatActor {
  readonly components: CombatActor['components'] & {
    sanity?: { doDelta(delta: number): void };
    staffsanity?: { doCastingDelta(delta: number): void };
  };
}

/** staff.lua red: a ranged lighter whose projectile ignites, unfreezes and wakes its target. */
export class FireStaffController implements EquipmentLifecycle {
  private readonly entity: ItemEntity;
  private readonly world: FireStaffWorld;
  constructor(entity: ItemEntity, world: FireStaffWorld) {
    this.entity = entity; this.world = world;
    entity.projectiledelay = PROJECTILE_DELAY;
    entity.components.finiteuses.setMaxUses(FIRESTAFF_USES);
    const weapon = entity.components.weapon!;
    weapon.SetRange(ATTACK_RANGE, HIT_RANGE);
    weapon.SetOnAttack((_, attacker, target) => this.onAttack(attacker as FireStaffAttacker, target as FireStaffTarget));
    weapon.SetProjectile(FIRE_PROJECTILE_ID, (attacker, target) => {
      const projectile = world.launch(entity, target as ProjectileTarget, attacker as CombatActor);
      projectile.DelayVisibility(entity.projectiledelay ?? 0);
      return projectile;
    });
  }
  /** Prepare the projectile art and effect while the staff is held. */
  onequip(): void { void this.world.prepare().catch((error: unknown) => console.error('Unable to prepare fire staff', error)); }
  onunequip(): void {}
  dispose(): void {}

  /** onattack_red(inst, attacker, target, skipsanity) */
  private onAttack(attacker: FireStaffAttacker | undefined, target: FireStaffTarget, skipsanity = false): void {
    if (!skipsanity && attacker) {
      if (attacker.components.staffsanity) attacker.components.staffsanity.doCastingDelta(-SANITY_SUPERTINY);
      else attacker.components.sanity?.doDelta(-SANITY_SUPERTINY);
    }
    if (target.isRemoved) return; // killed or removed in the combat damage phase
    const { burnable, freezable, fueled, sleeper, combat } = target.components;
    if (burnable && !burnable.IsBurning()) {
      if (freezable?.IsFrozen()) freezable.Unfreeze();
      else if (!fueled || (fueled.fueltype !== 'BURNABLE' && fueled.secondaryfueltype !== 'BURNABLE')) {
        // Does not take burnable fuel, so just burn it.
        if (burnable.canlight || combat) burnable.Ignite(true, this.entity as unknown as WorkInst, attacker as unknown as WorkInst);
      } else if (fueled.accepting) {
        // Takes burnable fuel, so fuel it.
        const fuel = this.world.createFuel?.();
        if (fuel) { if (fuel.components.fuel?.fueltype !== 'BURNABLE' || !fueled.TakeFuelItem(fuel)) fuel.remove(); }
      }
    }
    if (freezable) {
      freezable.AddColdness(-1);
      if (freezable.IsFrozen()) freezable.Unfreeze();
    }
    if (sleeper?.IsAsleep()) sleeper.WakeUp();
    target.PushEvent?.('attacked', { attacker, damage: 0, weapon: this.entity });
  }
}

export function getFireStaffController(entity: ItemEntity, world: FireStaffWorld): FireStaffController {
  return entity.component('firestaff', () => new FireStaffController(entity, world));
}

/** swap_staffs symbol `swap_redstaff`, plus the swing and impact sounds. */
export const fireStaffVisual: EquipmentVisualFactory = item => staffVisual({ ...item, prefab: FIRESTAFF_ID });
