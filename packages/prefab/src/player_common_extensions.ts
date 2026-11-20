import * as THREE from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { PrefabInstance } from './prefabInstance';
import { SKELETON_PLAYER_ID, SkeletonInstance } from './skeleton';
import { MakeCharacterPhysics, MakeGhostPhysics, WORLD_SCALE } from './standardcomponents';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { isGhostValidAction } from '../../stategraphs/src/actions';
import { AddSlipperyFeet, cancelEmote, RemoveSlipperyFeet, type PlayerInstance } from './player_common';
import { ItemEntity } from '@dontstarve-web/inventory';

/** player_common_extensions.lua GhostActionFilter: pushed when dying, popped by CommonActualRez. */
const GhostActionFilter = isGhostValidAction;

/** playeractionpicker.lua ACTION_FILTER_PRIORITIES.ghost */
const GHOST_ACTION_FILTER_PRIORITY = 99;

/** tuning.lua GHOST_LIGHT_OVERRIDE / RESURRECT_HEALTH. */
export const GHOST_LIGHT_OVERRIDE = 0.5;
export const RESURRECT_HEALTH = 50;

/** inst:Hide() / inst:Show() with the DynamicShadow. */
function setHidden(inst: PlayerInstance, hidden: boolean): void {
  inst.sprite.setVisible(!hidden);
}

/** inst.Physics:Teleport(x, y, z): the transform moves, the body follows at once and stops. */
function Teleport(inst: PlayerInstance, position: ReadonlyVector3): void {
  inst.setPosition(position.x, inst.position.y, position.z);
  inst.physics.Teleport();
  inst.physicsBody?.velocity.set(0, inst.physicsBody.velocity.y, 0);
}

/** skinner ghost_skin / normal_skin: the prefab's ghost and living builds. */
function GhostBuild(inst: PlayerInstance): string {
  return `dynamic/ghost_${inst.prefab}_build.zip`;
}
export function PlayerBuild(inst: PlayerInstance): string {
  return `dynamic/${inst.prefab}.zip`;
}

/** AnimState:SetBank("ghost") + skinner ghost_skin + SetStateGraph("SGwilsonghost"); `loading` is inst.loading_ghost. */
export function makeGhost(inst: PlayerInstance, loading = false): void {
  if (inst.sg.isGhost) {
    return;
  }
  cancelEmote(inst);
  inst.AnimState.SetBank('ghost');
  inst.AnimState.SetBuild(GhostBuild(inst));
  inst.sg.becomeGhost(loading);
}

/** DoActualRez: the living bank and skin, SetStateGraph("SGwilson") and the source's rebirth state. */
export function makeAlive(inst: PlayerInstance, state: 'portal_rez' | 'amulet_rebirth' = 'portal_rez'): void {
  if (!inst.sg.isGhost) {
    return;
  }
  inst.AnimState.SetBank('wilson');
  inst.AnimState.SetBuild(PlayerBuild(inst));
  inst.sg.becomeAlive(state);
}

/** player_common_extensions.lua SpawnDeathProduct: skeleton_player at the death point, described with the character, name and cause. */
function SpawnDeathProduct(inst: PlayerInstance, position: THREE.Vector3): void {
  const skel = inst.SpawnPrefab?.(SKELETON_PLAYER_ID, position);
  if (skel instanceof SkeletonInstance) {
    skel.SetSkeletonDescription(inst.prefab, inst.transform.model.name, inst.deathcause);
  }
}

/**
 * player_common_extensions.lua OnMakePlayerGhost, ghost branch of the makeplayerghost event: leave a skeleton, play die_fx,
 * switch to the ghost bank, light and stategraph, run CommonPlayerDeath and enter ghost mode. `loading` resumes a saved
 * ghost: no skeleton or die_fx, no appear animation, and the saved stats are kept.
 * Not ported: death announcement, morgue record, user session, the playercorpse branch, and components the player lacks
 * here (burnable, freezable, propagator, grogginess, moisture, sheltered, debuffable, age, temperature, frostybreather).
 */
export function OnMakePlayerGhost(inst: PlayerInstance, data?: { skeleton?: boolean; loading?: boolean }): void {
  if (inst.hasTag('playerghost')) {
    return;
  }
  const position = new THREE.Vector3(inst.position.x, 0, inst.position.z);
  const loading = data?.loading === true;
  if (data?.skeleton) {
    SpawnDeathProduct(inst, position);
  }
  if (!loading) {
    inst.SpawnPrefab?.('die_fx', position);
  }

  makeGhost(inst, loading);
  inst.sprite.setLightOverride(GHOST_LIGHT_OVERRIDE);
  setGhostLight(inst, true);

  // CommonPlayerDeath
  const { health, hunger, sanity } = inst.stats;
  health.SetInvincible(true);
  health.canheal = false;
  if (!loading) {
    sanity.SetPercent(0.5);
    hunger.SetPercent(2 / 3);
  }
  hunger.Pause();
  sanity.ignore = true;
  RemoveSlipperyFeet(inst);

  MakeGhostPhysics(inst, 1, 0.5);
  inst.components.playeractionpicker?.PushActionFilter(GhostActionFilter, GHOST_ACTION_FILTER_PRIORITY);
  inst.addTag('playerghost');
  if (!loading) {
    health.SetCurrentHealth(RESURRECT_HEALTH);
  }
  // The death state disabled the controller; a ghost can move and act.
  inst.controllerEnabled = true;
  inst.ghostMode.set(true);
  inst.PushEvent('ms_becameghost', undefined);
}

// Light:SetIntensity(.6) SetRadius(.5) SetFalloff(.6) SetColour(180/255, 195/255, 225/255)
const GHOST_LIGHT = {
  radius: 0.5 * WORLD_SCALE,
  intensity: 0.6,
  falloff: 0.6,
  colour: [180 / 255, 195 / 255, 225 / 255],
} as const;

/** inst.Light:Enable(enabled) for the ghost's light. */
function setGhostLight(inst: PrefabInstance, enabled: boolean): void {
  inst.light.set(enabled ? GHOST_LIGHT : null);
}

/** tuning.lua PORTAL_HEALTH_PENALTY */
export const PORTAL_HEALTH_PENALTY = 0.25;

/** What a resurrector (the multiplayer portal or a haunted amulet) offers the ghost. */
export interface RezSource {
  /** The resurrector's prefab: OnRespawnFromGhost and DoActualRez branch on `amulet`. */
  readonly prefab?: string;
  isValid(): boolean;
  /** inst:IsInLimbo: a held amulet is no rez source until it is back on the ground. */
  readonly inlimbo?: boolean;
  /** The source's ground position. */
  readonly position: ReadonlyVector3;
  hasTag(tag: string): boolean;
  PushEvent(name: string, data?: unknown): void;
}

/** player_common_extensions.lua revert: OnRespawnFromGhost's changes undone when the source has gone. */
function revertRespawn(inst: PlayerInstance): void {
  inst.ShowHUD(true);
  inst.controllerEnabled = true;
}

/** Revert DoMoveToRezSource as well, back to the haunting ghost. */
function revertMove(inst: PlayerInstance): void {
  revertRespawn(inst);
  setHidden(inst, false);
  setGhostLight(inst, true);
  inst.sg.goToState('haunt');
}

/**
 * player_common_extensions.lua OnRespawnFromGhost (event `respawnfromghost`), for the multiplayer_portal source:
 * lock the controls and HUD, then after 9 frames move to the portal (DoMoveToRezSource) and, 51 frames later through
 * DoRezDelay's .35 second checks, resurrect (DoActualRez). The `amulet` source takes the same path and ends in the
 * amulet_rebirth state. Other resurrectors (stones, gravestones, wx78 backup body, pocketwatch, telltale heart) and the
 * remote variants are not ported and are ignored.
 */
export function OnRespawnFromGhost(inst: PlayerInstance, data?: { source?: RezSource }): void {
  const source = data?.source;
  if (!inst.hasTag('playerghost') || !(source?.prefab === 'amulet' || source?.hasTag('multiplayer_portal'))) {
    return;
  }
  inst.addTag('reviving');
  inst.ShowHUD(false);
  inst.controllerEnabled = false;
  inst.sg.addStateTag('busy');
  inst.DoTaskInTime(9 * FRAMES, () => DoMoveToRezSource(inst, source, 51 * FRAMES));
}

function DoMoveToRezSource(inst: PlayerInstance, source: RezSource, delay: number): void {
  if (!source.isValid() || source.inlimbo) {
    revertRespawn(inst);
    return;
  }
  setHidden(inst, true);
  setGhostLight(inst, false);
  Teleport(inst, source.position);
  DoRezDelay(inst, source, delay);
}

function DoRezDelay(inst: PlayerInstance, source: RezSource, delay: number): void {
  if (!source.isValid() || source.inlimbo) {
    revertMove(inst);
  } else if (delay <= 0) {
    DoActualRez(inst, source);
  } else {
    inst.DoTaskInTime(Math.min(delay, 0.35), () => DoRezDelay(inst, source, delay - 0.35));
  }
}

/**
 * inventory.lua Equip(item) into an occupied slot: the worn item goes back into the inventory (dropped when it cannot),
 * then the source is worn.
 */
function EquipRezSource(inst: PlayerInstance, item: ItemEntity | undefined): boolean {
  const inventory = inst.components.inventory,
    slot = item?.components.equippable?.equipslot;
  if (!inventory || !item || !slot) {
    return false;
  }
  const worn = inventory.Unequip(slot);
  if (worn && !inventory.GiveItem(worn)) {
    inventory.DropItem(worn);
  }
  return inventory.Equip(item);
}

/**
 * DoActualRez, then CommonActualRez: die_fx at the source, the living bank and skin, `activateresurrection` on the
 * source, then the amulet (equipped, amulet_rebirth) or the portal (PORTAL_HEALTH_PENALTY, `rez_player`, portal_rez).
 * Not ported: the player_classified map explorer, age, temperature and moisture pauses a ghost does not have
 * here, burnable/freezable/grogginess/sheltered/debuffable and the rez announcement.
 */
function DoActualRez(inst: PlayerInstance, source: RezSource): void {
  const position = new THREE.Vector3(source.position.x, 0, source.position.z);
  const amulet = source.prefab === 'amulet';
  // The amulet is worn before the state that consumes it; one that cannot be worn leaves the ghost haunting.
  if (amulet && !EquipRezSource(inst, source instanceof ItemEntity ? source : undefined)) {
    revertMove(inst);
    return;
  }
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
  MakeCharacterPhysics(inst, 75, 0.5);
  makeAlive(inst, amulet ? 'amulet_rebirth' : 'portal_rez');

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

declare module '../../componets/src/entityEvents' {
  interface EntityEventData {
    /** SGwilson death / player_common OnLoad: the player becomes a ghost, with a skeleton or while loading a ghost save. */
    makeplayerghost: { readonly skeleton?: boolean; readonly loading?: boolean } | undefined;
    /** hauntable / resurrectors: the ghost comes back to life from `source`. */
    respawnfromghost: { readonly source?: RezSource } | undefined;
  }
}
