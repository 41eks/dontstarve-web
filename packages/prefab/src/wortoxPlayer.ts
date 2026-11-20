import * as THREE from 'three';
import type { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import type { PlayerBody } from './player_common';
import type { WorldContext } from './worldContext';
import type { WorldFx } from './world_fx';
import { CHARACTER_COLLISION_MASK, WORLD_SCALE } from './standardcomponents';
import { COLLISION, type PhysicsState } from '../../componets/src/physicsState';
import type { Wortox, WortoxSave } from './wortox';
import { isGroundTargetBlocked, placementEntities, type PlacementQuery } from './placementEntities';
import { prefabInstance } from './prefabInstance';
import { bindSoulHop, playerInst } from './player_common';

export interface WortoxPlayerOptions {
  world: WorldContext;
  body: PlayerBody;
  /** The player's inst.Physics, for SGwilson's ToggleOffPhysics / ToggleOnPhysics. */
  physics: PhysicsState;
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
export function GetPointSpecialActions(
  inst: WortoxDoer,
  instPosition: THREE.Vector3,
  pos: THREE.Vector3,
  useitem: unknown,
  right: boolean,
): readonly string[] {
  if (!right || useitem !== undefined) {
    return [];
  }
  // PlayerController:GetMapActions sets checkingmapactions while it asks for the map's actions.
  const canblink = inst.checkingmapactions
    ? inst.CanBlinkFromWithMap?.(inst.checkingmapactions_pos ?? instPosition)
    : inst.CanBlinkTo?.(pos);
  return canblink && inst.CanSoulhop?.() ? ['BLINK'] : [];
}

/** Wortox's soul hop services and point actions over the world; master_postinit owns the hop counters. */
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
    const { world, body, fx } = options;
    const instance = playerInst(world.player);
    if (!instance.wortox) {
      throw new Error('Expected wortox master_postinit to have run');
    }
    this.state = instance.wortox;
    this.state.OnLoad(options.saved);
    bindSoulHop(instance, {
      tryToPortalHop: () => this.state.TryToPortalHop(instance.components.inventory?.EquipHasTag('heavy')),
      facePoint: position => this.facePoint(position),
      teleport: position => {
        // Transform:SetPosition, so the world's spatial index follows the hop.
        instance.setPosition(position.x, position.y, position.z);
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
    // The project skips the Has("wortox_soul") count (README); riding still blocks the hop.
    instance.CanSoulhop = () => !this.disposed && !instance.hasTag('riding');
    instance.CanBlinkTo = position => this.canBlinkTo(position);
    instance.CanBlinkFromWithMap = position => this.canMapBlinkTo(position);
    // OnSetOwner: playeractionpicker.pointspecialactionsfn = GetPointSpecialActions.
    if (world.mouseActions) {
      world.mouseActions.pointspecialactionsfn = (_doer, pos, useitem, right) =>
        GetPointSpecialActions(instance, instance.getPosition(), pos, useitem, right);
    }
  }

  /** wortox.lua CanBlinkTo: passable terrain and an unblocked ground target. Crossing obstacles is allowed. */
  canBlinkTo(position: THREE.Vector3): boolean {
    if (![position.x, position.y, position.z].every(Number.isFinite) || !this.options.isPassableAtPoint(position)) {
      return false;
    }
    return !isGroundTargetBlocked(this.blockers, position, 0.5 * WORLD_SCALE);
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
    if (enabled !== this.physicsToggled) {
      return;
    }
    this.physicsToggled = !enabled;
    // SGwilson ToggleOnPhysics / ToggleOffPhysics.
    if (enabled) {
      this.options.physics.SetCollisionMask(...CHARACTER_COLLISION_MASK);
    } else {
      this.options.physics.SetCollisionMask(COLLISION.GROUND);
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const { world } = this.options;
    if (world.mouseActions) {
      (world.mouseActions as PlayerActionPicker).pointspecialactionsfn = undefined;
    }
    const instance = playerInst(world.player);
    instance.CanSoulhop = undefined;
    instance.CanBlinkTo = undefined;
    instance.CanBlinkFromWithMap = undefined;
    bindSoulHop(instance, undefined);
    this.setPhysicsEnabled(true);
  }
}
