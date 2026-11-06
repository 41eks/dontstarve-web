import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import * as THREE from 'three';
import type { GameTimeScheduler } from '@dontstarve-web/signals';
import { Health } from '../../componets/src/health';
import { Hunger } from '../../componets/src/hunger';
import { Sanity, type SanityMode } from '../../componets/src/sanity';
import { Eater } from '../../componets/src/eater';
import type { PrefabInstance } from './prefabInstance';
import { FindEntities } from './actionEntity';
import { SlipperyFeet } from '../../componets/src/slipperyfeet';
import { SKELETON_PLAYER_ID, type SkeletonInstance } from './skeleton';
import { MakeCharacterPhysics, MakeGhostPhysics, WORLD_SCALE } from './standardcomponents';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { isGhostValidAction } from '../../stategraphs/src/actions';
import type { WilsonPlayerInstance } from './player';
import type { EquipmentKind, InventoryStore, ItemEntity } from '@dontstarve-web/inventory';

// Existing Wilson stat defaults, from tuning.lua. Older saves may omit all stats.
export const WILSON_MAX_HEALTH = 150;
export const WILSON_MAX_HUNGER = 150;
export const WILSON_MAX_SANITY = 200;
export interface PlayerStats {
  readonly health: Health;
  readonly hunger: Hunger;
  readonly sanity: Sanity;
}
export interface PlayerStatsSave { health?: number; hunger?: number; sanity?: number; penalty?: number; sanitySane?: boolean; sanityMode?: SanityMode }

/** player_common.lua: assemble the player's authoritative stats and eater components. */
export function createPlayerStats(inst: PrefabInstance, saved: PlayerStatsSave = {}, scheduler?: GameTimeScheduler): PlayerStats {
  const health = inst.components.health = new Health(WILSON_MAX_HEALTH, inst);
  health.nofadeout = true;
  health.OnLoad({ health: saved.health ?? WILSON_MAX_HEALTH, penalty: saved.penalty ?? 0 });
  const hunger = inst.components.hunger = new Hunger(inst, WILSON_MAX_HUNGER, scheduler);
  hunger.SetRate(75 / 480);
  hunger.SetKillRate(WILSON_MAX_HEALTH / 120);
  hunger.OnLoad({ hunger: saved.hunger ?? 105 });
  const sanity = inst.components.sanity = new Sanity(inst, WILSON_MAX_SANITY);
  sanity.OnLoad({ current: saved.sanity ?? 35, sane: saved.sanitySane, mode: saved.sanityMode });
  const eater = inst.components.eater = new Eater(inst);
  inst.onRemove(() => { eater.dispose(); health.dispose(); hunger.dispose(); sanity.dispose(); });
  return { health, hunger, sanity };
}

/**
 * player_common.lua OnItemRanOut and the SGwilson.lua toolbroke exit:
 * equip another equippable of the same prefab found in the inventory.
 */
export function equipSamePrefab(
  inventory: Pick<InventoryStore, 'GetEquippedItem' | 'FindItem' | 'EquipFromInventory'>,
  prefab: string,
  equipslot?: EquipmentKind,
): boolean {
  if (equipslot !== undefined && inventory.GetEquippedItem(equipslot)) return false;
  const same = inventory.FindItem(item => item.prefab === prefab
    && item.components.equippable !== undefined
    && (equipslot === undefined || item.components.equippable.equipslot === equipslot));
  return same !== null && inventory.EquipFromInventory(same);
}

export function OnItemRanOut(inventory: Parameters<typeof equipSamePrefab>[0], data: unknown): void {
  const { prefab, equipslot } = (data ?? {}) as { prefab?: string; equipslot?: EquipmentKind };
  if (prefab !== undefined && equipslot !== undefined) equipSamePrefab(inventory, prefab, equipslot);
}

/** player_common_extensions.lua GhostActionFilter: pushed when dying, popped by CommonActualRez. */
const GhostActionFilter = isGhostValidAction;

/** playeractionpicker.lua ACTION_FILTER_PRIORITIES.ghost */
const GHOST_ACTION_FILTER_PRIORITY = 99;

/** tuning.lua GHOST_LIGHT_OVERRIDE / RESURRECT_HEALTH. */
export const GHOST_LIGHT_OVERRIDE = .5;
export const RESURRECT_HEALTH = 50;

/** inst:DoTaskInTime on the player's game-time scheduler. */
function DoTaskInTime(inst: WilsonPlayerInstance, seconds: number, fn: () => void): void {
  if (!inst.scheduler) throw new Error('The player inst has no scheduler for DoTaskInTime');
  inst.scheduler.schedule(seconds, fn);
}

/** inst:Hide() / inst:Show() with the DynamicShadow. */
function setHidden(inst: WilsonPlayerInstance, hidden: boolean): void { inst.sprite.setVisible(!hidden); }

/** inst.Physics:Teleport(x, y, z): the transform moves, the body follows at once and stops. */
function Teleport(inst: WilsonPlayerInstance, position: ReadonlyVector3): void {
  inst.setPosition(position.x, inst.position.y, position.z);
  inst.physics.Teleport();
  inst.physicsBody?.velocity.set(0, inst.physicsBody.velocity.y, 0);
}

/** player_common.lua AddComponent("slipperyfeet"): frozen ponds are its slipperyfeettarget entities. */
export function AddSlipperyFeet(inst: WilsonPlayerInstance): void {
  if (inst.slipperyfeet || !inst.scheduler) return;
  const sg = inst.animationController.stategraph;
  inst.slipperyfeet = new SlipperyFeet({
    getPosition: () => inst.transform.model.position,
    getMotorSpeed: () => inst.currentMotorSpeed,
    PushEvent: (name, data) => sg.pushEvent(name, data),
    sg,
  }, {
    scheduler: inst.scheduler,
    findSlipperyEntities: (position, radius) => FindEntities(position, radius, ['slipperyfeettarget']) as never,
  });
}

/** inst:RemoveComponent("slipperyfeet") */
export function RemoveSlipperyFeet(inst: WilsonPlayerInstance): void {
  inst.slipperyfeet?.dispose();
  delete inst.slipperyfeet;
}

/** player_common_extensions.lua SpawnDeathProduct: skeleton_player at the death point, described with the character, name and cause. */
function SpawnDeathProduct(inst: WilsonPlayerInstance, position: THREE.Vector3): void {
  const skel = inst.SpawnPrefab?.(SKELETON_PLAYER_ID, position) as SkeletonInstance | undefined;
  skel?.SetSkeletonDescription(inst.prefab, inst.transform.model.name, inst.deathcause);
}

/**
 * player_common_extensions.lua OnMakePlayerGhost, ghost branch of the makeplayerghost event: leave a skeleton, play die_fx,
 * switch to the ghost bank, light and stategraph, run CommonPlayerDeath and enter ghost mode. `loading` resumes a saved
 * ghost: no skeleton or die_fx, no appear animation, and the saved stats are kept.
 * Not ported: death announcement, morgue record, user session, the playercorpse branch, and components the player lacks
 * here (burnable, freezable, propagator, grogginess, moisture, sheltered, debuffable, age, temperature, frostybreather).
 */
export function OnMakePlayerGhost(inst: WilsonPlayerInstance, data?: { skeleton?: boolean; loading?: boolean }): void {
  if (inst.hasTag('playerghost')) return;
  const position = new THREE.Vector3(inst.position.x, 0, inst.position.z);
  const loading = data?.loading === true;
  if (data?.skeleton) SpawnDeathProduct(inst, position);
  if (!loading) inst.SpawnPrefab?.('die_fx', position);

  inst.animationController.makeGhost(loading);
  inst.sprite.setLightOverride(GHOST_LIGHT_OVERRIDE);
  setGhostLight(inst, true);

  // CommonPlayerDeath
  const { health, hunger, sanity } = inst.stats;
  health.SetInvincible(true);
  health.canheal = false;
  if (!loading) {
    sanity.SetPercent(.5);
    hunger.SetPercent(2 / 3);
  }
  hunger.Pause();
  sanity.ignore = true;
  RemoveSlipperyFeet(inst);

  MakeGhostPhysics(inst, 1, .5);
  inst.components.playeractionpicker?.PushActionFilter(GhostActionFilter, GHOST_ACTION_FILTER_PRIORITY);
  inst.addTag('playerghost');
  if (!loading) health.SetCurrentHealth(RESURRECT_HEALTH);
  // The death state disabled the controller; a ghost can move and act.
  inst.controllerEnabled = true;
  inst.ghostMode.set(true);
  inst.PushEvent('ms_becameghost', undefined);
}

// Light:SetIntensity(.6) SetRadius(.5) SetFalloff(.6) SetColour(180/255, 195/255, 225/255)
const GHOST_LIGHT = { radius: .5 * WORLD_SCALE, intensity: .6, falloff: .6, colour: [180 / 255, 195 / 255, 225 / 255] } as const;

/** inst.Light:Enable(enabled) for the ghost's light. */
function setGhostLight(inst: PrefabInstance, enabled: boolean): void {
  inst.light.set(enabled ? GHOST_LIGHT : null);
}

/** tuning.lua PORTAL_HEALTH_PENALTY */
export const PORTAL_HEALTH_PENALTY = .25;

/** What a resurrector (the multiplayer portal or a haunted amulet) offers the ghost. */
export interface RezSource {
  /** The resurrector's prefab: OnRespawnFromGhost and DoActualRez branch on `amulet`. */
  readonly prefab?: string;
  /** The amulet inst itself, which DoActualRez equips. */
  readonly entity?: ItemEntity;
  isValid(): boolean;
  /** The source's ground position. */
  readonly position: ReadonlyVector3;
  hasTag(tag: string): boolean;
  PushEvent(name: string, data?: unknown): void;
}

/** player_common_extensions.lua revert: OnRespawnFromGhost's changes undone when the source has gone. */
function revertRespawn(inst: WilsonPlayerInstance): void {
  inst.ShowHUD(true);
  inst.controllerEnabled = true;
}

/** Revert DoMoveToRezSource as well, back to the haunting ghost. */
function revertMove(inst: WilsonPlayerInstance): void {
  revertRespawn(inst);
  setHidden(inst, false);
  setGhostLight(inst, true);
  inst.animationController.stategraph.goToState('haunt');
}

/**
 * player_common_extensions.lua OnRespawnFromGhost (event `respawnfromghost`), for the multiplayer_portal source:
 * lock the controls and HUD, then after 9 frames move to the portal (DoMoveToRezSource) and, 51 frames later through
 * DoRezDelay's .35 second checks, resurrect (DoActualRez). The `amulet` source takes the same path and ends in the
 * amulet_rebirth state. Other resurrectors (stones, gravestones, wx78 backup body, pocketwatch, telltale heart) and the
 * remote variants are not ported and are ignored.
 */
export function OnRespawnFromGhost(inst: WilsonPlayerInstance, data?: { source?: RezSource }): void {
  const source = data?.source;
  if (!inst.hasTag('playerghost') || !(source?.prefab === 'amulet' || source?.hasTag('multiplayer_portal'))) return;
  inst.addTag('reviving');
  inst.ShowHUD(false);
  inst.controllerEnabled = false;
  inst.animationController.stategraph.addStateTag('busy');
  DoTaskInTime(inst, 9 * FRAMES, () => DoMoveToRezSource(inst, source, 51 * FRAMES));
}

function DoMoveToRezSource(inst: WilsonPlayerInstance, source: RezSource, delay: number): void {
  if (!source.isValid()) { revertRespawn(inst); return; }
  setHidden(inst, true);
  setGhostLight(inst, false);
  Teleport(inst, source.position);
  DoRezDelay(inst, source, delay);
}

function DoRezDelay(inst: WilsonPlayerInstance, source: RezSource, delay: number): void {
  if (!source.isValid()) revertMove(inst);
  else if (delay <= 0) DoActualRez(inst, source);
  else DoTaskInTime(inst, Math.min(delay, .35), () => DoRezDelay(inst, source, delay - .35));
}

/**
 * inventory.lua Equip(item) into an occupied slot: the worn item goes back into the inventory (dropped when it cannot),
 * then the source is worn.
 */
function EquipRezSource(inst: WilsonPlayerInstance, item: ItemEntity | undefined): boolean {
  const inventory = inst.components.inventory, slot = item?.components.equippable?.equipslot;
  if (!inventory || !item || !slot) return false;
  const worn = inventory.Unequip(slot);
  if (worn && !inventory.GiveItem(worn)) inventory.DropItem(worn);
  return inventory.Equip(item);
}

/**
 * DoActualRez, then CommonActualRez: die_fx at the source, the living bank and skin, `activateresurrection` on the
 * source, then the amulet (equipped, amulet_rebirth) or the portal (PORTAL_HEALTH_PENALTY, `rez_player`, portal_rez).
 * Not ported: the player_classified map explorer, age, temperature and moisture pauses a ghost does not have
 * here, burnable/freezable/grogginess/sheltered/debuffable and the rez announcement.
 */
function DoActualRez(inst: WilsonPlayerInstance, source: RezSource): void {
  const position = new THREE.Vector3(source.position.x, 0, source.position.z);
  const amulet = source.prefab === 'amulet';
  // The amulet is worn before the state that consumes it; one that cannot be worn leaves the ghost haunting.
  if (amulet && !EquipRezSource(inst, source.entity)) { revertMove(inst); return; }
  inst.SpawnPrefab?.('die_fx', position);
  setHidden(inst, false);
  Teleport(inst, position);
  inst.ghostMode.set(false);
  inst.sprite.setLightOverride(0);
  source.PushEvent('activateresurrection', inst.transform.model);
  if (!amulet) {
    inst.stats.health.DeltaPenalty(PORTAL_HEALTH_PENALTY);
    source.PushEvent('rez_player');
  }
  setGhostLight(inst, false);
  MakeCharacterPhysics(inst, 75, .5);
  inst.animationController.makeAlive(amulet ? 'amulet_rebirth' : 'portal_rez');

  // CommonActualRez
  inst.components.playeractionpicker?.PopActionFilter(GhostActionFilter);
  inst.stats.health.canheal = true;
  inst.stats.hunger.Resume();
  inst.stats.sanity.ignore = false;
  AddSlipperyFeet(inst);
  inst.removeTag('playerghost');
  inst.removeTag('reviving');
  inst.PushEvent('ms_respawnedfromghost', undefined);
}
