import * as THREE from 'three';
import type { PhysicsState } from '../../componets/src/physicsState';
import type { HealthState, HungerState, SanityState, Signal } from '@dontstarve-web/signals';
import { actionEntity } from './actionEntity';
import { prefabInstance } from './prefabInstance';
import { MakeCharacterPhysics, MakeGhostPhysics, WORLD_SCALE } from './standardcomponents';
import { FRAMES } from '../../stategraphs/src/stategraph';
import { isGhostValidAction } from '../../stategraphs/src/actions';
import type { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import type { WilsonAnimationController } from './player';
import type { EquipmentKind, InventoryStore } from '@dontstarve-web/inventory';

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

/** What player_common_extensions.lua OnMakePlayerGhost reaches on the player entity and in the world. */
export interface PlayerGhostOwner {
  readonly model: THREE.Group;
  readonly animation: Pick<WilsonAnimationController, 'makeGhost' | 'makeAlive' | 'stategraph'>;
  /** inst.Physics */
  readonly physics: PhysicsState;
  readonly stats: { readonly health: HealthState; readonly hunger: HungerState; readonly sanity: SanityState };
  /** sanity.ignore = true */
  readonly sanity: { ignore: boolean };
  /** player_classified isghostmode (SetGhostMode): playervision's ghost colour cube, and the ghost's save flag. */
  readonly ghostMode: Signal<boolean>;
  /** SpawnDeathProduct: the skeleton (or corpse) at the death point. */
  spawnDeathProduct(position: THREE.Vector3): void;
  /** SpawnPrefab("die_fx") at the death point. */
  spawnDieFx(position: THREE.Vector3): void;
  /** inst:DoTaskInTime on the game-time scheduler; returns the cancel. */
  schedule(seconds: number, fn: () => void): () => void;
  /** inst:AddComponent("slipperyfeet") */
  addSlipperyFeet(): void;
  /** inst:RemoveComponent("slipperyfeet") */
  removeSlipperyFeet(): void;
  /** inst:Hide() / inst:Show() */
  setHidden(hidden: boolean): void;
  /** inst.Light:Enable(enabled): the ghost's own light. */
  setGhostLight(enabled: boolean): void;
  /** inst.Physics:Teleport(x, y, z) */
  teleport(position: THREE.Vector3): void;
  /** inst.components.playercontroller:Enable(enabled) */
  setControllerEnabled(enabled: boolean): void;
  /** inst:ShowHUD(show) */
  showHUD(show: boolean): void;
  /** inst.components.playeractionpicker: the filter stack the ghost pushes and pops. */
  readonly actionPicker: Pick<PlayerActionPicker, 'PushActionFilter' | 'PopActionFilter'>;
  /** inst.components.inventory:Equip(source) for an amulet; resolves once the worn art is in place, false if it could not be worn. */
  equipRezSource(source: RezSource): Promise<boolean>;
}

/**
 * player_common_extensions.lua OnMakePlayerGhost, ghost branch of the makeplayerghost event: leave a skeleton, play die_fx,
 * switch to the ghost bank, light and stategraph, run CommonPlayerDeath and enter ghost mode. `loading` resumes a saved
 * ghost: no skeleton or die_fx, no appear animation, and the saved stats are kept.
 * Not ported: death announcement, morgue record, user session, the playercorpse branch, and components the player lacks
 * here (burnable, freezable, propagator, grogginess, moisture, sheltered, debuffable, age, temperature, frostybreather).
 */
export function OnMakePlayerGhost(owner: PlayerGhostOwner, data?: { skeleton?: boolean; loading?: boolean }): void {
  const entity = actionEntity(owner.model, owner.model.userData.artCharacter as string);
  if (entity.hasTag('playerghost')) return;
  const position = new THREE.Vector3(owner.model.position.x, 0, owner.model.position.z);
  const loading = data?.loading === true;
  if (data?.skeleton) owner.spawnDeathProduct(position);
  if (!loading) owner.spawnDieFx(position);

  owner.animation.makeGhost(loading);
  prefabInstance(owner.model)!.sprite.setLightOverride(GHOST_LIGHT_OVERRIDE);
  setGhostLight(owner.model, true);

  // CommonPlayerDeath
  const { health, hunger, sanity } = owner.stats;
  health.invincible = true;
  health.canheal = false;
  if (!loading) {
    sanity.set(sanity.maximum / 2);
    hunger.set(hunger.maximum * 2 / 3);
  }
  owner.sanity.ignore = true;
  owner.removeSlipperyFeet();

  MakeGhostPhysics(owner, 1, .5);
  owner.actionPicker.PushActionFilter(GhostActionFilter, GHOST_ACTION_FILTER_PRIORITY);
  entity.addTag('playerghost');
  if (!loading) health.SetCurrentHealth(RESURRECT_HEALTH);
  // The death state disabled the controller; a ghost can move and act.
  owner.setControllerEnabled(true);
  owner.ghostMode.set(true);
  owner.model.dispatchEvent({ type: 'ms_becameghost' } as never);
}

// Light:SetIntensity(.6) SetRadius(.5) SetFalloff(.6) SetColour(180/255, 195/255, 225/255)
const GHOST_LIGHT = { radius: .5 * WORLD_SCALE, intensity: .6, falloff: .6, colour: [180 / 255, 195 / 255, 225 / 255] } as const;

/** inst.Light:Enable(enabled) for the ghost's light. */
export function setGhostLight(model: THREE.Object3D, enabled: boolean): void {
  prefabInstance(model)!.light.set(enabled ? GHOST_LIGHT : null);
}

/** tuning.lua PORTAL_HEALTH_PENALTY */
export const PORTAL_HEALTH_PENALTY = .25;

/** What a resurrector (the multiplayer portal) offers the ghost. */
export interface RezSource {
  /** The resurrector's prefab: OnRespawnFromGhost and DoActualRez branch on `amulet`. */
  readonly prefab?: string;
  isValid(): boolean;
  /** The source's ground position. */
  readonly position: THREE.Vector3;
  hasTag(tag: string): boolean;
  PushEvent(name: string, data?: unknown): void;
}

/** player_common_extensions.lua revert: OnRespawnFromGhost's changes undone when the source has gone. */
function revertRespawn(owner: PlayerGhostOwner): void {
  owner.showHUD(true);
  owner.setControllerEnabled(true);
}

/**
 * player_common_extensions.lua OnRespawnFromGhost (event `respawnfromghost`), for the multiplayer_portal source:
 * lock the controls and HUD, then after 9 frames move to the portal (DoMoveToRezSource) and, 51 frames later through
 * DoRezDelay's .35 second checks, resurrect (DoActualRez). The `amulet` source takes the same path and ends in the
 * amulet_rebirth state. Other resurrectors (stones, gravestones, wx78 backup body, pocketwatch, telltale heart) and the
 * remote variants are not ported and are ignored.
 */
export function OnRespawnFromGhost(owner: PlayerGhostOwner, data?: { source?: RezSource }): void {
  const entity = actionEntity(owner.model, owner.model.userData.artCharacter as string);
  const source = data?.source;
  if (!entity.hasTag('playerghost') || !(source?.prefab === 'amulet' || source?.hasTag('multiplayer_portal'))) return;
  entity.addTag('reviving');
  owner.showHUD(false);
  owner.setControllerEnabled(false);
  owner.animation.stategraph.addStateTag('busy');
  owner.schedule(9 * FRAMES, () => doMoveToRezSource(owner, source, 51 * FRAMES));
}

function doMoveToRezSource(owner: PlayerGhostOwner, source: RezSource, delay: number): void {
  if (!source.isValid()) { revertRespawn(owner); return; }
  owner.setHidden(true);
  owner.setGhostLight(false);
  owner.teleport(source.position);
  doRezDelay(owner, source, delay);
}

function doRezDelay(owner: PlayerGhostOwner, source: RezSource, delay: number): void {
  if (!source.isValid()) {
    // Revert DoMoveToRezSource
    revertRespawn(owner);
    owner.setHidden(false);
    owner.setGhostLight(true);
    owner.animation.stategraph.goToState('haunt');
  } else if (delay <= 0) {
    doActualRez(owner, source);
  } else {
    owner.schedule(Math.min(delay, .35), () => doRezDelay(owner, source, delay - .35));
  }
}

/**
 * DoActualRez with the multiplayer_portal source, then CommonActualRez: die_fx at the portal, the living bank and skin,
 * the portal's PORTAL_HEALTH_PENALTY, `rez_player` on the portal and the SGwilson portal_rez state.
 * Not ported: the player_classified map explorer, age, hunger, temperature and moisture pauses a ghost does not have
 * here, burnable/freezable/grogginess/sheltered/debuffable and the rez announcement.
 */
function doActualRez(owner: PlayerGhostOwner, source: RezSource): void {
  const position = new THREE.Vector3(source.position.x, 0, source.position.z);
  if (source.prefab !== 'amulet') { finishRez(owner, source, position); return; }
  // The amulet is equipped before the state that consumes it, with its worn art already applied.
  void owner.equipRezSource(source).then(equipped => {
    if (equipped) { finishRez(owner, source, position); return; }
    revertRespawn(owner);
    owner.setHidden(false);
    owner.setGhostLight(true);
    owner.animation.stategraph.goToState('haunt');
  }).catch((error: unknown) => console.error('Unable to resurrect from the amulet', error));
}

function finishRez(owner: PlayerGhostOwner, source: RezSource, position: THREE.Vector3): void {
  const entity = actionEntity(owner.model, owner.model.userData.artCharacter as string);
  const amulet = source.prefab === 'amulet';
  owner.spawnDieFx(position);
  owner.setHidden(false);
  owner.teleport(position);
  owner.ghostMode.set(false);
  prefabInstance(owner.model)!.sprite.setLightOverride(0);
  source.PushEvent('activateresurrection', owner.model);
  if (!amulet) {
    owner.stats.health.DeltaPenalty(PORTAL_HEALTH_PENALTY);
    source.PushEvent('rez_player');
  }
  owner.setGhostLight(false);
  MakeCharacterPhysics(owner, 75, .5);
  owner.animation.makeAlive(amulet ? 'amulet_rebirth' : 'portal_rez');

  // CommonActualRez
  owner.actionPicker.PopActionFilter(GhostActionFilter);
  owner.stats.health.canheal = true;
  owner.sanity.ignore = false;
  owner.addSlipperyFeet();
  entity.removeTag('playerghost');
  entity.removeTag('reviving');
  owner.model.dispatchEvent({ type: 'ms_respawnedfromghost' } as never);
}
