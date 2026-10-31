import type * as THREE from 'three';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle, ReadonlySignal } from '@dontstarve-web/signals';
import { WILSON_ACTION_TIMES } from '@dontstarve-web/stategraphs/SGwilson';
import type { SpellCastMap, SpellCastTarget } from '@dontstarve-web/stategraphs/castspell';
import type { CombatActor, CombatInst } from '../../componets/src/combat';
import type { Projectile, ProjectileTarget } from '../../componets/src/projectile';
import type { Burnable } from '../../componets/src/burnable';
import type { WorkInst } from '../../componets/src/workable';
import { getDeconstructionRecipe } from '../../componets/src/recipes';
import { SpellCaster, type SpellCastDoer } from '../../componets/src/spellcaster';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory, type EquipmentVisualItem } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PlaySound, type SoundEventPath } from './sound';
import { WORLD_SCALE } from './standardcomponents';
import { FIRE_PROJECTILE_ID } from './staff_projectile';

/** staff.lua: the staffs share swap_staffs and the spellcaster or weapon each colour configures. */

export const YELLOWSTAFF_ID = 'yellowstaff';
export const YELLOWSTAFF_COLOUR = [223 / 255, 208 / 255, 69 / 255] as const;
export const OPALSTAFF_ID = 'opalstaff';
export const OPALSTAFF_COLOUR = [64 / 255, 64 / 255, 208 / 255] as const;
export type StaffId = LightStaffId | 'greenstaff' | 'firestaff';
export function isStaff(itemId: string | null | undefined): itemId is StaffId { return isLightStaff(itemId) || itemId === 'greenstaff' || itemId === 'firestaff'; }
export type LightStaffId = typeof YELLOWSTAFF_ID | typeof OPALSTAFF_ID;
export const LIGHT_STAFF_USES = { yellowstaff: 20, opalstaff: 50 } as const;
export const LIGHT_STAFF_SANITY_COST = 20;
export const LIGHT_STAFF_CAST_SOUND = 'dontstarve/common/staffteleport';
export interface LightStaffWorld {
  readonly map: SpellCastMap;
  /** SpawnPrefab at the cast's commit; the product's display loads its art. */
  spawnPrefab(prefab: 'stafflight' | 'staffcoldlight', position: THREE.Vector3): void;
}

/** staff.lua yellow/opal: configure one spellcaster on the actual inventory entity. */
export class LightStaffController implements EquipmentLifecycle {
  readonly spellcaster: SpellCaster;
  private readonly entity: ItemEntity;
  private readonly world: LightStaffWorld;
  constructor(entity: ItemEntity, world: LightStaffWorld) {
    if (!isLightStaff(entity.prefab)) throw new Error('LightStaffController requires a light staff');
    this.entity = entity; this.world = world;
    entity.addTag('nopunch'); entity.addTag('allow_action_on_impassable');
    if (entity.prefab === 'yellowstaff') entity.addTag('shadowlevel');
    entity.castsound = LIGHT_STAFF_CAST_SOUND;
    entity.fxcolour = entity.prefab === 'opalstaff' ? OPALSTAFF_COLOUR : YELLOWSTAFF_COLOUR;
    entity.components.finiteuses.setMaxUses(LIGHT_STAFF_USES[entity.prefab]);
    this.spellcaster = entity.component('spellcaster', () => new SpellCaster(entity, world.map));
    entity.components.spellcaster = this.spellcaster;
    this.spellcaster.setSpellFn((_staff, _target, position, doer) => this.createLight(position, doer));
    this.spellcaster.canUseOnPoint = true;
    this.spellcaster.canUseOnPointWater = true;
  }
  private get product(): 'stafflight' | 'staffcoldlight' {
    return this.entity.prefab === 'opalstaff' ? 'staffcoldlight' : 'stafflight';
  }
  onequip(): void {}
  onunequip(): void {}
  dispose(): void {}
  private createLight(position: THREE.Vector3, doer: SpellCastDoer): boolean {
    if (this.entity.isRemoved) return false;
    this.world.spawnPrefab(this.product, position);
    const depleted = (this.entity.components.finiteuses.remaining ?? LIGHT_STAFF_USES[this.entity.prefab as LightStaffId]) === 1;
    if (!this.entity.components.finiteuses.use(1)) return false;
    if (depleted) PlaySound('dontstarve/common/gem_shatter', doer.position);
    if (doer.components.staffsanity) doer.components.staffsanity.doCastingDelta(-LIGHT_STAFF_SANITY_COST);
    else doer.components.sanity?.doDelta(-LIGHT_STAFF_SANITY_COST);
    return true;
  }
}
export function getLightStaffController(entity: ItemEntity, world: LightStaffWorld): LightStaffController {
  return entity.component('lightstaff', () => new LightStaffController(entity, world));
}
export function isLightStaff(itemId: string | null | undefined): itemId is LightStaffId {
  return itemId === YELLOWSTAFF_ID || itemId === OPALSTAFF_ID;
}
export const YELLOWSTAFF_CAST_TIME = WILSON_ACTION_TIMES.cast;
/** staff.lua onequip: `swap_<colour>staff` of swap_staffs, or the skin's; the red staff's prefab id is firestaff. */
export function staffVisual(item: EquipmentVisualItem & { readonly prefab: StaffId }) {
  const skin = skinArchive(item.prefab, GROUND_ITEM_DEFINITIONS[item.prefab].skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_staffs'], `swap_${item.prefab === 'firestaff' ? 'redstaff' : item.prefab}`);
}

export const yellowstaffVisual: EquipmentVisualFactory = item => staffVisual({ ...item, prefab: item.prefab as StaffId });

// staff.lua red()

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
  onequip(): void {}
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

// staff.lua green()

export const GREENSTAFF_USES = 5;
export const GREENSTAFF_COLOUR = [51 / 255, 153 / 255, 51 / 255] as const;
export type DeconstructionTarget = SpellCastTarget & {
  readonly components: {
    finiteuses?: { readonly percent: ReadonlySignal<number | undefined> };
    fueled?: { readonly percent: ReadonlySignal<number | undefined> };
    armor?: { GetPercent(): number };
    inventoryitem?: object;
    container?: { DropEverything(position: THREE.Vector3): void };
    stewer?: { Harvest(): unknown };
  };
  flush?(): void;
  PushEvent(name: string, data: unknown): void;
  removeOne(): boolean;
};
export interface DeconstructionLoot { readonly itemId: string; readonly count: number; }
export interface GreenStaffWorld {
  /** lootdropper:SpawnLootPrefab for each piece, flung from `position`; created synchronously. */
  spawnLoot(items: readonly DeconstructionLoot[], position: THREE.Vector3): void;
}

/** staff.lua destroystructure: one recipe product, scaled by its current condition. */
export function deconstructionLoot(target: Pick<DeconstructionTarget, 'prefab' | 'components'>): DeconstructionLoot[] {
  const recipe = getDeconstructionRecipe(target.prefab);
  if (!recipe) return [];
  const components = target.components;
  const condition = (!recipe.ignoresFiniteUses ? components.finiteuses?.percent.peek() : undefined)
    ?? (components.inventoryitem ? components.fueled?.percent.peek() ?? components.armor?.GetPercent() : undefined) ?? 1;
  return recipe.ingredients.filter(({ type, amount }) => amount > 0 && (!type.endsWith('gem') || type.slice(-11, -3) === 'precious'))
    .map(({ type, amount }) => ({ itemId: type, count: Math.max(1, Math.ceil(amount * condition / recipe.numtogive)) }));
}

const ingredientSounds: Readonly<Record<string, SoundEventPath>> = {
  nightmarefuel: 'dontstarve/common/destroy_magic', livinglog: 'dontstarve/common/destroy_magic',
  silk: 'dontstarve/common/destroy_clothing', beefalowool: 'dontstarve/common/destroy_clothing',
  twigs: 'dontstarve/common/destroy_tool',
  ...Object.fromEntries(['redgem', 'bluegem', 'greengem', 'purplegem', 'yellowgem', 'orangegem']
    .map(id => [id, 'dontstarve/common/gem_shatter' as const])),
  log: 'dontstarve/common/destroy_wood', boards: 'dontstarve/common/destroy_wood',
  rocks: 'dontstarve/common/destroy_stone', cutstone: 'dontstarve/common/destroy_stone',
  cutgrass: 'dontstarve/common/destroy_straw', cutreeds: 'dontstarve/common/destroy_straw',
};

export class GreenStaffController implements EquipmentLifecycle {
  readonly spellcaster: SpellCaster;
  private readonly entity: ItemEntity;
  constructor(entity: ItemEntity, world: GreenStaffWorld) {
    this.entity = entity;
    entity.addTag('nopunch'); entity.addTag('shadowlevel');
    entity.fxcolour = GREENSTAFF_COLOUR;
    entity.components.finiteuses.setMaxUses(GREENSTAFF_USES);
    this.spellcaster = entity.component('spellcaster', () => new SpellCaster(entity));
    entity.components.spellcaster = this.spellcaster;
    this.spellcaster.canUseOnTargets = true;
    this.spellcaster.canOnlyUseOnRecipes = true;
    this.spellcaster.setSpellFn((_staff, target, _position, doer) =>
      this.destroyStructure(target as DeconstructionTarget, doer, world));
  }
  onequip(): void {}
  onunequip(): void {}
  dispose(): void {}
  private destroyStructure(target: DeconstructionTarget, doer: SpellCastDoer, world: GreenStaffWorld): boolean {
    const recipe = getDeconstructionRecipe(target.prefab);
    if (!recipe || !target.isValid() || this.entity.isRemoved) return false;
    target.flush?.();
    if (!target.isValid()) return false;
    world.spawnLoot(deconstructionLoot(target), target.position);
    for (const ingredient of recipe.ingredients) {
      const sound = ingredientSounds[ingredient.type];
      if (sound) PlaySound(sound, doer.position);
    }
    target.components.container?.DropEverything(target.position);
    target.components.stewer?.Harvest();
    target.PushEvent('ondeconstructstructure', doer);
    target.removeOne();
    PlaySound('dontstarve/common/staff_dissassemble', doer.position);
    if (doer.components.staffsanity) doer.components.staffsanity.doCastingDelta(-20);
    else doer.components.sanity?.doDelta(-20);
    const depleted = (this.entity.components.finiteuses.remaining ?? GREENSTAFF_USES) === 1;
    this.entity.components.finiteuses.use(1);
    if (depleted) PlaySound('dontstarve/common/gem_shatter', doer.position);
    return true;
  }
}
export function getGreenStaffController(entity: ItemEntity, world: GreenStaffWorld): GreenStaffController {
  return entity.component('greenstaff', () => new GreenStaffController(entity, world));
}
