import * as THREE from 'three';
import type { InventoryStore } from '@dontstarve-web/inventory';
import type { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { WilsonAnimationController, PlayerBody } from './player';
import type { WorldContext } from './worldContext';
import type { WorldFx } from './world_fx';
import { CHARACTER_COLLISION_MASK, WORLD_SCALE } from './standardcomponents';
import { COLLISION, type PhysicsState } from '../../componets/src/physicsState';
import { Wortox, type WortoxSave } from './wortox';
import { isGroundTargetBlocked, placementEntities, type PlacementQuery } from './placementEntities';
import { modelHasTag, prefabInstance } from './prefabInstance';
import { wilsonPlayerInstance } from './player';

export interface WortoxPlayerOptions {
  world: WorldContext;
  body: PlayerBody;
  /** The player's inst.Physics, for SGwilson's ToggleOffPhysics / ToggleOnPhysics. */
  physics: PhysicsState;
  animation: WilsonAnimationController;
  /** The player inst as act.doer: wortox.lua puts CanSoulhop, CanBlinkTo and CanBlinkFromWithMap on it. */
  doer: WortoxDoer;
  inventory: InventoryStore;
  scheduler: GameTimeScheduler;
  fx: WorldFx;
  isPassableAtPoint(position: THREE.Vector3): boolean;
  resetMinimapOffset?(): void;
  snapCamera?(): void;
  saved?: WortoxSave;
}

/** What wortox.lua adds to the player inst for its soul hop actions. */
export interface WortoxDoer {
  CanSoulhop?(): boolean;
  CanBlinkTo?(position: THREE.Vector3): boolean;
  CanBlinkFromWithMap?(position: THREE.Vector3): boolean;
  _freesoulhop_counter?: number;
  checkingmapactions?: boolean;
  checkingmapactions_pos?: THREE.Vector3;
}

/** wortox.lua GetPointSpecialActions: BLINK on the right button, at the map's point while checkingmapactions. */
export function GetPointSpecialActions(inst: WortoxDoer, instPosition: THREE.Vector3, pos: THREE.Vector3,
  useitem: unknown, right: boolean): readonly string[] {
  if (!right || useitem !== undefined) return [];
  // PlayerController:GetMapActions sets checkingmapactions while it asks for the map's actions.
  const canblink = inst.checkingmapactions
    ? inst.CanBlinkFromWithMap?.(inst.checkingmapactions_pos ?? instPosition) : inst.CanBlinkTo?.(pos);
  return canblink && inst.CanSoulhop?.() ? ['BLINK'] : [];
}

/** Wortox's prefab services and point actions; the application only supplies world dependencies. */
export class WortoxPlayer {
  readonly state: Wortox;
  private readonly options: WortoxPlayerOptions;
  private readonly blockers: PlacementQuery;
  /** statemem.isphysicstoggle */
  private physicsToggled = false;
  private disposed = false;

  static create(options: WortoxPlayerOptions): WortoxPlayer {
    return new WortoxPlayer(options);
  }

  private constructor(options: WortoxPlayerOptions) {
    this.options = options;
    this.blockers = placementEntities(options.world.scene);
    const { world, body, animation, doer, inventory, scheduler, fx } = options;
    this.state = new Wortox(scheduler, inventory);
    this.state.OnLoad(options.saved);
    const instance = wilsonPlayerInstance(world.player);
    instance.wortox = this.state;
    instance.addTag('soulstealer');
    animation.bindSoulHop({
      tryToPortalHop: () => this.state.TryToPortalHop(inventory.EquipHasTag('heavy')),
      facePoint: position => this.facePoint(position),
      teleport: position => {
        world.player.position.copy(position);
        instance.tileTracker.sync();
        options.physics.Teleport();
        body.velocity.set(0, 0, 0);
      },
      setPhysicsEnabled: enabled => this.setPhysicsEnabled(enabled),
      spawnFx: prefab => fx.spawn(prefab, world.player.position),
      resetMinimapOffset: options.resetMinimapOffset,
      snapCamera: options.snapCamera,
    });
    // wortox.lua: CanSoulhop / CanBlinkTo / CanBlinkFromWithMap on the inst, read by ACTIONS.BLINK and BLINK_MAP.
    const state = this.state;
    Object.assign(doer, {
      // The project skips the Has("wortox_soul") count (README); riding still blocks the hop.
      CanSoulhop: () => !this.disposed && !modelHasTag(world.player, 'riding'),
      CanBlinkTo: (position: THREE.Vector3) => this.canBlinkTo(position),
      CanBlinkFromWithMap: (position: THREE.Vector3) => this.canMapBlinkTo(position),
    });
    Object.defineProperty(doer, '_freesoulhop_counter', { configurable: true, get: () => state.freeHops.peek() });
    // OnSetOwner: playeractionpicker.pointspecialactionsfn = GetPointSpecialActions.
    if (world.mouseActions) {
      world.mouseActions.pointspecialactionsfn = (_doer, pos, useitem, right) =>
        GetPointSpecialActions(doer, world.player.position, pos, useitem, right);
    }
  }

  /** wortox.lua CanBlinkTo: passable terrain and an unblocked ground target. Crossing obstacles is allowed. */
  canBlinkTo(position: THREE.Vector3): boolean {
    if (![position.x, position.y, position.z].every(Number.isFinite) || !this.options.isPassableAtPoint(position)) return false;
    return !isGroundTargetBlocked(this.blockers, position, .5 * WORLD_SCALE);
  }

  /** actions.lua map remap requires land; it does not use the normal ground-target blocker check. */
  private canMapBlinkTo(position: THREE.Vector3): boolean {
    return [position.x, position.y, position.z].every(Number.isFinite) && this.options.isPassableAtPoint(position);
  }

  private facePoint(position: THREE.Vector3): void {
    const { world } = this.options;
    prefabInstance(world.player)?.sprite.facePoint(world.player.position, position);
  }

  private setPhysicsEnabled(enabled: boolean): void {
    if (enabled !== this.physicsToggled) return;
    this.physicsToggled = !enabled;
    // SGwilson ToggleOnPhysics / ToggleOffPhysics.
    if (enabled) this.options.physics.SetCollisionMask(...CHARACTER_COLLISION_MASK);
    else this.options.physics.SetCollisionMask(COLLISION.GROUND);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const { world, doer } = this.options;
    if (world.mouseActions) (world.mouseActions as PlayerActionPicker).pointspecialactionsfn = undefined;
    delete doer.CanSoulhop; delete doer.CanBlinkTo; delete doer.CanBlinkFromWithMap;
    delete (doer as { _freesoulhop_counter?: number })._freesoulhop_counter;
    this.options.animation.bindSoulHop(undefined);
    this.setPhysicsEnabled(true);
    this.state.dispose();
    delete wilsonPlayerInstance(this.options.world.player).wortox;
    wilsonPlayerInstance(this.options.world.player).removeTag('soulstealer');
  }
}
