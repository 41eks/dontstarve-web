import * as THREE from 'three';
import { addComponent } from './components';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { ItemEntity } from '@dontstarve-web/inventory';
import type { ReadonlySignal } from '@dontstarve-web/signals';
import { WILSON_ACTION_TIMES } from '@dontstarve-web/stategraphs/SGwilson';
import type { SpellCastMap } from '@dontstarve-web/stategraphs/castspell';
import type { CombatActor, CombatInst } from '../../componets/src/combat';
import type { Projectile, ProjectileTarget } from '../../componets/src/projectile';
import type { Burnable } from '../../componets/src/burnable';
import { getDeconstructionRecipe } from '../../componets/src/recipes';
import { SpellCaster, type SpellCastDoer } from '../../componets/src/spellcaster';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory, type EquipmentVisualItem, type HeldEquipFunctions } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { PlaySound, type SoundEventPath } from './sound';
import { WORLD_SCALE } from './standardcomponents';
import { FIRE_PROJECTILE_ID, ICE_PROJECTILE_ID } from './staff_projectile';
import { PrefabInstance } from './prefabInstance';
import { Weapon } from '../../componets/src/weapon';
import { BlinkStaff, type BlinkCaster, type BlinkStaffWorld } from '../../componets/src/blinkstaff';
import { WILSON_ATTACK } from './handTool';

/** staff.lua: the staffs share swap_staffs and the spellcaster or weapon each colour configures. */

export const YELLOWSTAFF_ID = 'yellowstaff';
export const YELLOWSTAFF_COLOUR = [223 / 255, 208 / 255, 69 / 255] as const;
export const OPALSTAFF_ID = 'opalstaff';
export const OPALSTAFF_COLOUR = [64 / 255, 64 / 255, 208 / 255] as const;
export type StaffId = LightStaffId | 'greenstaff' | 'firestaff' | 'telestaff' | 'orangestaff' | 'icestaff';
export function isStaff(itemId: string | null | undefined): itemId is StaffId { return isLightStaff(itemId) || itemId === 'greenstaff' || itemId === 'firestaff' || itemId === 'telestaff' || itemId === 'orangestaff' || itemId === 'icestaff'; }
export type LightStaffId = typeof YELLOWSTAFF_ID | typeof OPALSTAFF_ID;
export const LIGHT_STAFF_USES = { yellowstaff: 20, opalstaff: 50 } as const;
export const LIGHT_STAFF_SANITY_COST = 20;
export const LIGHT_STAFF_CAST_SOUND = 'dontstarve/common/staffteleport';
export interface LightStaffWorld {
  readonly map: SpellCastMap;
  /** SpawnPrefab at the cast's commit; the product's display loads its art. */
  spawnPrefab(prefab: 'stafflight' | 'staffcoldlight', position: ReadonlyVector3): void;
}

/** staff.lua yellow/opal: configure one spellcaster on the actual inventory entity. */
export class LightStaffController implements HeldEquipFunctions {
  readonly spellcaster: SpellCaster;
  private readonly entity: ItemEntity;
  private readonly world: LightStaffWorld;
  /** finiteuses' maximum, which an unworn staff's uses default to. */
  private readonly maxUses: number;
  constructor(entity: ItemEntity, world: LightStaffWorld) {
    if (!isLightStaff(entity.prefab)) { throw new Error('LightStaffController requires a light staff'); }
    this.entity = entity; this.world = world; this.maxUses = LIGHT_STAFF_USES[entity.prefab];
    entity.addTag('nopunch'); entity.addTag('allow_action_on_impassable');
    if (entity.prefab === 'yellowstaff') { entity.addTag('shadowlevel'); }
    entity.castsound = LIGHT_STAFF_CAST_SOUND;
    entity.fxcolour = entity.prefab === 'opalstaff' ? OPALSTAFF_COLOUR : YELLOWSTAFF_COLOUR;
    entity.components.finiteuses.setMaxUses(this.maxUses);
    this.spellcaster = addComponent(entity, 'spellcaster', SpellCaster, world.map);
    this.spellcaster.SetSpellFn((_staff, _target, position, doer) => !!position && this.createLight(position, doer));
    this.spellcaster.canUseOnPoint = true;
    this.spellcaster.canUseOnPointWater = true;
  }
  private get product(): 'stafflight' | 'staffcoldlight' {
    return this.entity.prefab === 'opalstaff' ? 'staffcoldlight' : 'stafflight';
  }
  onequip(): void {}
  onunequip(): void {}
  dispose(): void {}
  private createLight(position: ReadonlyVector3, doer: SpellCastDoer): boolean {
    if (this.entity.isRemoved) { return false; }
    this.world.spawnPrefab(this.product, position);
    const depleted = (this.entity.components.finiteuses.remaining ?? this.maxUses) === 1;
    if (!this.entity.components.finiteuses.use(1)) { return false; }
    if (depleted) { PlaySound('dontstarve/common/gem_shatter', doer.position); }
    if (doer.components.staffsanity) { doer.components.staffsanity.doCastingDelta(-LIGHT_STAFF_SANITY_COST); }
    else { doer.components.sanity?.DoDelta(-LIGHT_STAFF_SANITY_COST); }
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
/** staff.lua commonfn's anim, colour.."staff": the red staff's prefab id is firestaff and the purple one's telestaff. */
const STAFF_ANIMS: Readonly<Record<StaffId, string>> = {
  yellowstaff: 'yellowstaff', opalstaff: 'opalstaff', greenstaff: 'greenstaff', firestaff: 'redstaff', telestaff: 'purplestaff', orangestaff: 'orangestaff', icestaff: 'bluestaff',
};
/** staff.lua onequip: `swap_<anim>` of swap_staffs, or the skin's. */
export function staffVisual(item: EquipmentVisualItem & { readonly prefab: StaffId }) {
  const skin = skinArchive(item.prefab, GROUND_ITEM_DEFINITIONS[item.prefab].skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_staffs'], `swap_${STAFF_ANIMS[item.prefab]}`);
}

export const yellowstaffVisual: EquipmentVisualFactory = item => {
  const { prefab } = item;
  if (!isStaff(prefab)) { throw new Error(`${prefab} is not a staff`); }
  return staffVisual({ ...item, prefab });
};

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
    sanity?: { DoDelta(delta: number): void };
    staffsanity?: { doCastingDelta(delta: number): void };
  };
}

/** staff.lua red: a ranged lighter whose projectile ignites, unfreezes and wakes its target. */
export class FireStaffController implements HeldEquipFunctions {
  private readonly entity: ItemEntity;
  private readonly world: FireStaffWorld;
  constructor(entity: ItemEntity, world: FireStaffWorld) {
    this.entity = entity; this.world = world;
    entity.projectiledelay = PROJECTILE_DELAY;
    entity.components.finiteuses.setMaxUses(FIRESTAFF_USES);
    const weapon = entity.components.weapon!;
    weapon.SetRange(ATTACK_RANGE, HIT_RANGE);
    weapon.SetOnAttack((_, attacker, target) => this.onAttack(attacker, target));
    weapon.SetProjectile(FIRE_PROJECTILE_ID, (attacker, target) => {
      const projectile = world.launch(entity, target, attacker);
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
      if (attacker.components.staffsanity) { attacker.components.staffsanity.doCastingDelta(-SANITY_SUPERTINY); }
      else { attacker.components.sanity?.DoDelta(-SANITY_SUPERTINY); }
    }
    if (target.isRemoved) { return; } // killed or removed in the combat damage phase
    const { burnable, freezable, fueled, sleeper, combat } = target.components;
    if (burnable && !burnable.IsBurning()) {
      if (freezable?.IsFrozen()) { freezable.Unfreeze(); }
      else if (!fueled || (fueled.fueltype !== 'BURNABLE' && fueled.secondaryfueltype !== 'BURNABLE')) {
        // Does not take burnable fuel, so just burn it.
        if (burnable.canlight || combat) { burnable.Ignite(true, this.entity, attacker); }
      } else if (fueled.accepting) {
        // Takes burnable fuel, so fuel it.
        const fuel = this.world.createFuel?.();
        if (fuel) { if (fuel.components.fuel?.fueltype !== 'BURNABLE' || !fueled.TakeFuelItem(fuel)) { fuel.remove(); } }
      }
    }
    if (freezable) {
      freezable.AddColdness(-1);
      if (freezable.IsFrozen()) { freezable.Unfreeze(); }
    }
    if (sleeper?.IsAsleep()) { sleeper.WakeUp(); }
    target.PushEvent?.('attacked', { attacker, damage: 0, weapon: this.entity });
  }
}

export function getFireStaffController(entity: ItemEntity, world: FireStaffWorld): FireStaffController {
  return entity.component('firestaff', () => new FireStaffController(entity, world));
}

/** swap_staffs symbol `swap_redstaff`, plus the swing and impact sounds. */
export const fireStaffVisual: EquipmentVisualFactory = item => staffVisual({ ...item, prefab: FIRESTAFF_ID });

// staff.lua green()

/** tuning.lua GREENSTAFF_USES and SANITY_MEDLARGE. */
export const GREENSTAFF_USES = 5;
const SANITY_MEDLARGE = 20;
export const GREENSTAFF_COLOUR = [51 / 255, 153 / 255, 51 / 255] as const;
/** What staff.lua destroystructure reads from the entity it deconstructs. */
export interface DeconstructionComponents {
  finiteuses?: { readonly percent: ReadonlySignal<number | undefined> };
  fueled?: { readonly percent: ReadonlySignal<number | undefined> };
  armor?: { GetPercent(): number };
  inventoryitem?: object;
}
export interface DeconstructionLoot { readonly itemId: string; readonly count: number; }
export interface GreenStaffWorld {
  /** lootdropper:SpawnLootPrefab for each piece, flung from `position`; created synchronously. */
  spawnLoot(items: readonly DeconstructionLoot[], position: ReadonlyVector3): void;
}

/** staff.lua destroystructure: one recipe product, scaled by its current condition. */
export function deconstructionLoot(target: { readonly prefab: string; readonly components: DeconstructionComponents }): DeconstructionLoot[] {
  const recipe = getDeconstructionRecipe(target.prefab);
  if (!recipe) { return []; }
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

/**
 * destroystructure(staff, target): the recipe's ingredients scaled by the target's condition, the target's contents
 * dropped and one of it removed, then the caster's sanity and one use of the staff. The caster is the doer holding the
 * staff (inventoryitem.owner). The itemmimic branch and the inventory, spawner, occupiable, trap, dryer, harvestable,
 * constructionsite and inventoryitemholder drops are for components not ported.
 */
function destroystructure(staff: ItemEntity, target: unknown, caster: SpellCastDoer): boolean {
  const world = (staff.equipmentWorld as { greenStaffWorld?: GreenStaffWorld } | undefined)?.greenStaffWorld;
  if (!world || !(target instanceof PrefabInstance) || staff.isRemoved) { return false; }
  // Action filters should prevent us from reaching here normally.
  const recipe = getDeconstructionRecipe(target.prefab);
  if (!recipe || !target.isValid()) { return false; }
  // An item's pending stack and use changes settle before its condition is read.
  if (target instanceof ItemEntity) { target.flush(); }
  if (!target.isValid()) { return false; }
  for (const ingredient of recipe.ingredients) {
    const sound = ingredientSounds[ingredient.type];
    if (sound) { PlaySound(sound, caster.position); }
  }
  world.spawnLoot(deconstructionLoot(target), target.position);
  target.components.container?.DropEverything(target.position);
  target.components.stewer?.Harvest();
  target.PushEvent('ondeconstructstructure', caster);
  // If it's stackable we only want to destroy one of them.
  if (target.components.stackable) { target.components.stackable.Consume(); } else { target.remove(); }
  PlaySound('dontstarve/common/staff_dissassemble', caster.position);
  if (caster.components.staffsanity) { caster.components.staffsanity.doCastingDelta(-SANITY_MEDLARGE); }
  else { caster.components.sanity?.DoDelta(-SANITY_MEDLARGE); }
  staff.components.finiteuses.use(1);
  return true;
}

/** staff.lua green(): a spellcaster usable only on targets that have a recipe. */
export function configureGreenStaffEntity(inst: ItemEntity): void {
  // commonfn: the nopunch tag and the shadowlevel component's pristine tag.
  inst.addTag('nopunch'); inst.addTag('shadowlevel');
  inst.fxcolour = GREENSTAFF_COLOUR;
  if (inst.components.spellcaster) { return; }
  inst.components.finiteuses.setMaxUses(GREENSTAFF_USES);
  inst.components.finiteuses.setOnFinished(() => onfinished(inst));
  const spellcaster = addComponent(inst, 'spellcaster', SpellCaster);
  spellcaster.canUseOnTargets = true;
  spellcaster.canOnlyUseOnRecipes = true;
  spellcaster.SetSpellFn((_staff, target, _pos, caster) => destroystructure(inst, target, caster));
}

// staff.lua purple(), registered as telestaff

export const TELESTAFF_ID = 'telestaff' as const;
/** tuning.lua TELESTAFF_USES, TELESTAFF_MOISTURE and SANITY_HUGE. */
export const TELESTAFF_USES = 5;
export const TELESTAFF_MOISTURE = 500;
const SANITY_HUGE = 50;
export const TELESTAFF_COLOUR = [104 / 255, 40 / 255, 121 / 255] as const;
export const TELESTAFF_SOUND = 'dontstarve/common/staffteleport';
/** constants.lua NODE_TYPE.SeparatedRoom: a room walled off by impassable ground. */
const NODE_TYPE_SEPARATED_ROOM = 7;

/** TheWorld as the teleport reads it. */
export interface TeleStaffWorld {
  /** TheWorld:HasTag("cave"). */
  readonly isCave: boolean;
  /** TheWorld.topology.nodes: each node's centre (node.x, node.y as the ground's X and Z) and its NODE_TYPE. */
  readonly topologyNodes: readonly { readonly x: number; readonly z: number; readonly type: number }[];
  /** TheWorld.Map:IsPassableAtPoint. */
  isPassableAtPoint(position: THREE.Vector3): boolean;
  /** TheWorld:PushEvent("ms_sendlightningstrike", pos). */
  sendLightningStrike(position: THREE.Vector3): void;
  /** TheWorld:PushEvent("ms_deltamoisture", delta). */
  deltaMoisture(delta: number): void;
}

/** What the staff's teleport reads and writes on the inst it moves. */
interface Teleportee {
  readonly position: ReadonlyVector3;
  readonly physics: { Teleport(): void };
  readonly components: {
    locomotor?: { StopMoving(): void };
    health?: { SetInvincible(invincible: boolean): void };
    sanity?: { DoDelta(delta: number): void };
    staffsanity?: { doCastingDelta(delta: number): void };
  };
  hasTag(tag: string): boolean;
  setPosition(x: number, y: number, z: number): void;
  Hide(): void;
  Show(): void;
  PushEvent(name: string, data?: unknown): void;
  DoTaskInTime(time: number, fn: () => void): { Cancel(): void };
}
/** The player inst: SGwilson's forcetele state holds the pending teleport_task in its statemem. */
interface TeleporteePlayer extends Teleportee {
  readonly sg: {
    GoToState(state: 'forcetele' | 'wakeup' | 'appear'): void;
    readonly statemem: { teleport_task?: { Cancel(): void } };
  };
  readonly SoundEmitter?: { PlaySound(path: SoundEventPath): void };
  SnapCamera?(): void;
  ScreenFade?(isfadein: boolean, time: number): void;
}
function isTeleporteePlayer(teleportee: Teleportee): teleportee is TeleporteePlayer {
  return teleportee.hasTag('player') && 'sg' in teleportee;
}

/**
 * getrandomposition: the centre of a random passable topology node outside the separated rooms, else the caster's
 * position. The ocean branch (FindRandomPointInOcean / FindSwimmableOffset) is for an aquatic locomotor, which no
 * creature here has.
 */
function getrandomposition(world: TeleStaffWorld, caster: Teleportee | undefined, teleportee: Teleportee): THREE.Vector3 {
  const centers: THREE.Vector3[] = [];
  for (const node of world.topologyNodes) {
    const center = new THREE.Vector3(node.x, 0, node.z);
    if (world.isPassableAtPoint(center) && node.type !== NODE_TYPE_SEPARATED_ROOM) { centers.push(center); }
  }
  if (centers.length > 0) { return centers[Math.floor(Math.random() * centers.length)]; }
  // caster:GetPosition(); a haunted staff has no caster, and the haunt is not ported.
  const { x, y, z } = (caster ?? teleportee).position;
  return new THREE.Vector3(x, y, z);
}

/** teleport_end: the arrival strike, then the player wakes up (or the creature reappears) at `locpos`. */
function teleport_end(teleportee: Teleportee, locpos: THREE.Vector3, world: TeleStaffWorld): void {
  // The loctarget's onteleto (a telebase) and the heavy-lifting drop are not ported. The preventburning guard is not
  // needed: the lightning strike here does not ignite anything.
  world.sendLightningStrike(locpos);
  if (isTeleporteePlayer(teleportee)) {
    teleportee.sg.statemem.teleport_task = undefined;
    teleportee.sg.GoToState(teleportee.hasTag('playerghost') ? 'appear' : 'wakeup');
    teleportee.SoundEmitter?.PlaySound(TELESTAFF_SOUND);
  } else {
    teleportee.Show();
    teleportee.components.health?.SetInvincible(false);
    teleportee.PushEvent('teleported');
  }
}

/** teleport_continue: Physics:Teleport to `locpos`; the player fades back in and wakes up a second later. */
function teleport_continue(teleportee: Teleportee, locpos: THREE.Vector3, world: TeleStaffWorld): void {
  teleportee.setPosition(locpos.x, 0, locpos.z);
  teleportee.physics.Teleport();
  teleportee.PushEvent('teleport_move');
  if (isTeleporteePlayer(teleportee)) {
    teleportee.SnapCamera?.();
    teleportee.ScreenFade?.(true, 1);
    teleportee.sg.statemem.teleport_task = teleportee.DoTaskInTime(1, () => teleport_end(teleportee, locpos, world));
  } else {
    teleport_end(teleportee, locpos, world);
  }
}

/**
 * teleport_start: one use of the staff, then (above ground) the departure strike, the caster's sanity cost and the
 * world's moisture; the player waits three seconds hidden in forcetele before moving.
 */
function teleport_start(teleportee: Teleportee, staff: ItemEntity, caster: Teleportee | undefined, no_teleport: boolean,
  world: TeleStaffWorld): void {
  // Gotta do this RIGHT AWAY in case anything happens to loctarget or caster. teleportedoverride and the telebase
  // destinations are not ported, so the destination is always random.
  let locpos: THREE.Vector3 | undefined;
  if (!no_teleport) {
    locpos = getrandomposition(world, caster, teleportee);
    teleportee.components.locomotor?.StopMoving();
  }
  staff.components.finiteuses.use(1);
  // There's a roof over your head, magic lightning can't strike! The ms_miniquake it pushes instead is not ported.
  if (world.isCave) { return; }
  let is_teleporting_player = false;
  if (locpos) {
    if (isTeleporteePlayer(teleportee)) {
      is_teleporting_player = true;
      teleportee.sg.GoToState('forcetele');
    } else {
      teleportee.components.health?.SetInvincible(true);
      teleportee.Hide();
    }
  }
  const { x, y, z } = teleportee.position;
  world.sendLightningStrike(new THREE.Vector3(x, y, z));
  if (caster) {
    if (caster.components.staffsanity) { caster.components.staffsanity.doCastingDelta(-SANITY_HUGE); }
    else { caster.components.sanity?.DoDelta(-SANITY_HUGE); }
  }
  world.deltaMoisture(TELESTAFF_MOISTURE);
  if (!locpos) { return; }
  const destination = locpos;
  if (is_teleporting_player && isTeleporteePlayer(teleportee)) {
    teleportee.sg.statemem.teleport_task = teleportee.DoTaskInTime(3, () => teleport_continue(teleportee, destination, world));
  } else {
    teleport_continue(teleportee, destination, world);
  }
}

/**
 * teleport_func: the target, or the caster when cast from the inventory. A `noteleport` target is still targetable
 * but stays put. IsTeleportLinkingPermittedFromPoint always permits (no vault or wagpunk arena is ported), and the
 * minigame, teleportedoverride, hitched and telebase destinations are not ported.
 */
function teleport_func(inst: ItemEntity, target: object | undefined, caster: SpellCastDoer): boolean {
  const world = (inst.equipmentWorld as { teleStaffWorld?: TeleStaffWorld } | undefined)?.teleStaffWorld;
  const casterInst = caster instanceof PrefabInstance ? caster as Teleportee : undefined;
  const teleportee = target instanceof PrefabInstance ? target as Teleportee : casterInst;
  if (!world || !teleportee || inst.isRemoved) { return false; }
  teleport_start(teleportee, inst, casterInst, teleportee.hasTag('noteleport'), world);
  return true;
}

/** staff.lua onfinished: the gem shatters as the staff is removed. */
function onfinished(inst: ItemEntity): boolean {
  PlaySound('dontstarve/common/gem_shatter', inst.components.inventoryitem.GetHeldPosition() ?? inst.position);
  return inst.remove();
}

/** staff.lua purple(): a spellcaster usable on locomotors (other players only with PvP) and, from the inventory, on its holder. */
export function configureTeleStaffEntity(inst: ItemEntity): void {
  // commonfn: the nopunch tag and the shadowlevel component's pristine tag.
  inst.addTag('nopunch'); inst.addTag('shadowlevel');
  inst.fxcolour = TELESTAFF_COLOUR;
  if (inst.components.spellcaster) { return; }
  inst.components.finiteuses.setMaxUses(TELESTAFF_USES);
  inst.components.finiteuses.setOnFinished(() => onfinished(inst));
  const spellcaster = addComponent(inst, 'spellcaster', SpellCaster);
  spellcaster.SetSpellFn((_staff, target, _pos, caster) => teleport_func(inst, target, caster));
  spellcaster.canUseOnTargets = true;
  spellcaster.canUseFromInventory = true;
  spellcaster.canOnlyUseOnLocomotorsPvP = true;
}

/** swap_staffs symbol `swap_purplestaff`, or the skin build's. */
export const teleStaffVisual: EquipmentVisualFactory = item => staffVisual({ ...item, prefab: TELESTAFF_ID });

// staff.lua orange()

export const ORANGESTAFF_ID = 'orangestaff' as const;
/** tuning.lua ORANGESTAFF_USES, SANITY_MED, CANE_DAMAGE (wilson_attack * .5) and CANE_SPEED_MULT. */
export const ORANGESTAFF_USES = 20;
const SANITY_MED = 15;
export const CANE_DAMAGE = WILSON_ATTACK * .5;
export const CANE_SPEED_MULT = 1.25;
export const ORANGESTAFF_COLOUR = [1, 145 / 255, 0] as const;

/** onblink: the caster's sanity and one use of the staff. */
function onblink(staff: ItemEntity, _pos: THREE.Vector3, caster: BlinkCaster): void {
  if (caster.components.staffsanity) { caster.components.staffsanity.doCastingDelta(-SANITY_MED); }
  else { caster.components.sanity?.DoDelta(-SANITY_MED); }
  staff.components.finiteuses.use(1);
}

/**
 * staff.lua orange(), the parts every inst has: a cane's weapon whose attacks never wear its uses
 * (SetIgnoreCombatDurabilityLoss), the fx colour and cast sound. walkspeedmult is its hand definition's.
 */
export function configureOrangeStaffEntity(inst: ItemEntity): void {
  inst.addTag('shadowlevel');
  inst.fxcolour = ORANGESTAFF_COLOUR;
  inst.castsound = LIGHT_STAFF_CAST_SOUND;
  if (inst.components.weapon) { return; }
  inst.components.finiteuses.setMaxUses(ORANGESTAFF_USES);
  inst.components.finiteuses.setOnFinished(() => onfinished(inst));
  // weapon.lua adds the "weapon" tag; without finiteuses the attacks cost no uses.
  addComponent(inst, 'weapon', Weapon).SetDamage(CANE_DAMAGE);
  inst.addTag('weapon');
}

/** inst:AddComponent("blinkstaff"), bound to TheWorld's map and fx once the scene gives the staff its world. */
export function orangeStaffLifecycle(inst: ItemEntity, world: BlinkStaffWorld): HeldEquipFunctions {
  if (!inst.components.blinkstaff) {
    const blinkstaff = addComponent(inst, 'blinkstaff', BlinkStaff<ItemEntity>, world);
    blinkstaff.SetFX('sand_puff_large_front', 'sand_puff_large_back');
    blinkstaff.onblinkfn = onblink;
  }
  return { onequip() {}, onunequip() {} };
}

/** swap_staffs symbol `swap_orangestaff`, or the skin build's. */
export const orangeStaffVisual: EquipmentVisualFactory = item => staffVisual({ ...item, prefab: ORANGESTAFF_ID });

// staff.lua blue_common("blue", 1), registered as icestaff

export const ICESTAFF_ID = 'icestaff' as const;
/** tuning.lua ICESTAFF_USES. */
export const ICESTAFF_USES = 20;
/** staff.lua blue_common's tags; shadowlevel comes from commonfn. */
export const ICESTAFF_TAGS = ['icestaff', 'rangedweapon', 'extinguisher', 'shadowlevel'] as const;

export interface IceStaffWorld {
  /** SpawnPrefab("ice_projectile") at the attacker, thrown at the target. */
  launch(owner: ItemEntity, target: ProjectileTarget, attacker: CombatActor): Projectile;
}

/** What onattack_blue reads from a target. */
export interface IceStaffTarget extends CombatInst {
  readonly components: CombatInst['components'] & {
    burnable?: Pick<Burnable, 'IsBurning' | 'IsSmoldering' | 'Extinguish' | 'SmotherSmolder'>;
    freezable?: { AddColdness(coldness: number): void; SpawnShatterFX(): void };
    sleeper?: { IsAsleep(): boolean; WakeUp(): void };
  };
  readonly isRemoved?: boolean;
  readonly sg?: { hasStateTag(tag: string): boolean };
  PushEvent?(name: string, data: unknown): void;
}

/** onattack_blue(inst, attacker, target, skipsanity). The skin's skin_sound is not ported. */
function onattack_blue(inst: ItemEntity, attacker: FireStaffAttacker | undefined, target: IceStaffTarget, skipsanity = false): void {
  if (!skipsanity && attacker) {
    if (attacker.components.staffsanity) { attacker.components.staffsanity.doCastingDelta(-SANITY_SUPERTINY); }
    else { attacker.components.sanity?.DoDelta(-SANITY_SUPERTINY); }
  }
  if (target.isRemoved) { return; } // target killed or removed in combat damage phase
  const { sleeper, burnable, combat } = target.components;
  if (sleeper?.IsAsleep()) { sleeper.WakeUp(); }
  if (burnable) {
    if (burnable.IsBurning()) { burnable.Extinguish(); }
    else if (burnable.IsSmoldering()) { burnable.SmotherSmolder(); }
  }
  // The attacker is the player inst, a combat entity itself.
  combat?.SuggestTarget(attacker as CombatInst | undefined);
  if (target.sg && !target.sg.hasStateTag('frozen')) { target.PushEvent?.('attacked', { attacker, damage: 0, weapon: inst }); }
  // valid check in case any of the previous callbacks or events removed the target
  const freezable = target.components.freezable;
  if (freezable && !target.isRemoved) {
    freezable.AddColdness(inst.icestaff_coldness ?? 1);
    freezable.SpawnShatterFX();
  }
}

/**
 * staff.lua blue_common's fn, the parts every inst has: projectiledelay and icestaff_coldness. Its weapon (damage 0) is
 * the hand definition's; the range, onattack and projectile need the world and are set by iceStaffLifecycle.
 */
export function configureIceStaffEntity(inst: ItemEntity): void {
  inst.projectiledelay = PROJECTILE_DELAY;
  inst.icestaff_coldness = 1;
}

/** weapon:SetRange(8, 10), SetOnAttack(onattack_blue) and SetProjectile("ice_projectile"), bound to TheWorld's spawn. */
export function iceStaffLifecycle(inst: ItemEntity, world: IceStaffWorld): HeldEquipFunctions {
  const weapon = inst.components.weapon;
  if (weapon && !weapon.CanRangedAttack()) {
    weapon.SetRange(ATTACK_RANGE, HIT_RANGE);
    weapon.SetOnAttack((_, attacker, target) => onattack_blue(inst, attacker as FireStaffAttacker | undefined, target as IceStaffTarget));
    weapon.SetProjectile(ICE_PROJECTILE_ID, (attacker, target) => {
      const projectile = world.launch(inst, target, attacker);
      projectile.DelayVisibility(inst.projectiledelay ?? 0);
      return projectile;
    });
  }
  return { onequip() {}, onunequip() {} };
}

/** swap_staffs symbol `swap_bluestaff`, or the skin build's. */
export const iceStaffVisual: EquipmentVisualFactory = item => staffVisual({ ...item, prefab: ICESTAFF_ID });
