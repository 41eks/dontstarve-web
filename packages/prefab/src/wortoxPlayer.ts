import * as THREE from 'three';
import type { InventoryStore } from '@dontstarve-web/inventory';
import { BlinkActionController } from '../../stategraphs/src/blink';
import type { ActionLocomotor } from '../../stategraphs/src/actionContext';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { WilsonAnimationController, PlayerBody } from './player';
import type { WorldContext } from './worldContext';
import type { WorldFx } from './world_fx';
import { PreloadSounds } from './sound';
import { CHARACTER_COLLISION_MASK, WORLD_SCALE } from './standardcomponents';
import { COLLISION, type PhysicsState } from '../../componets/src/physicsState';
import { Wortox, type WortoxSave } from './wortox';
import { isGroundTargetBlocked, placementEntities, type PlacementQuery } from './placementEntities';
import { modelHasTag } from './prefabInstance';

export interface WortoxPlayerOptions {
  world: WorldContext;
  body: PlayerBody;
  /** The player's inst.Physics, for SGwilson's ToggleOffPhysics / ToggleOnPhysics. */
  physics: PhysicsState;
  animation: WilsonAnimationController;
  locomotor: ActionLocomotor;
  inventory: InventoryStore;
  scheduler: GameTimeScheduler;
  fx: WorldFx;
  isPassableAtPoint(position: THREE.Vector3): boolean;
  isManualMovement(): boolean;
  resetMinimapOffset?(): void;
  snapCamera?(): void;
  saved?: WortoxSave;
}

/** Wortox's prefab services and point actions; the application only supplies world dependencies. */
export class WortoxPlayer {
  readonly state: Wortox;
  private readonly options: WortoxPlayerOptions;
  private readonly input: BlinkActionController;
  private readonly blockers: PlacementQuery;
  /** statemem.isphysicstoggle */
  private physicsToggled = false;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  static async create(options: WortoxPlayerOptions): Promise<WortoxPlayer> {
    await Promise.all([
      options.fx.prepare('wortox_portal_jumpin_fx'), options.fx.prepare('wortox_portal_jumpout_fx'),
      PreloadSounds('dontstarve/creatures/together/toad_stool/infection_post', 'dontstarve/characters/wortox/soul/spawn',
        'dontstarve/characters/wortox/soul/hop_out', 'dontstarve/movement/bodyfall_dirt'),
    ]);
    return new WortoxPlayer(options);
  }

  private constructor(options: WortoxPlayerOptions) {
    this.options = options;
    this.blockers = placementEntities(options.world.scene);
    const { world, body, animation, locomotor, inventory, scheduler, fx } = options;
    this.state = new Wortox(scheduler, inventory);
    this.state.OnLoad(options.saved);
    world.player.userData.wortox = this.state;
    world.player.userData.actionEntity?.addTag('soulstealer');
    animation.bindSoulHop({
      tryToPortalHop: () => this.state.TryToPortalHop(inventory.EquipHasTag('heavy')),
      facePoint: position => this.facePoint(position),
      teleport: position => {
        world.player.position.copy(position);
        options.physics.Teleport();
        body.velocity.set(0, 0, 0);
      },
      setPhysicsEnabled: enabled => this.setPhysicsEnabled(enabled),
      spawnFx: prefab => fx.spawn(prefab, world.player.position),
      resetMinimapOffset: options.resetMinimapOffset,
      snapCamera: options.snapCamera,
    });
    this.input = new BlinkActionController(world, animation, locomotor, {
      canSoulHop: () => !this.disposed && !animation.isGhost && !animation.stategraph.isDead
        && world.player.userData.controllerEnabled !== false && !modelHasTag(world.player, 'riding') && !inventory.GetActiveItem(),
      canBlinkTo: position => this.canBlinkTo(position),
      canMapBlinkTo: position => this.canMapBlinkTo(position),
      hasSoulEcho: () => this.state.hasSoulEcho.peek(),
    }, options.isManualMovement);
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

  requestMapHop(position: THREE.Vector3): boolean { return this.input.requestMap(position); }

  private facePoint(position: THREE.Vector3): void {
    const { world, animation } = this.options;
    this.direction.subVectors(position, world.player.position);
    if (this.direction.lengthSq() < 1e-8) return;
    world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    const forward = this.direction.dot(this.forward), side = this.direction.dot(this.right);
    animation.setFacing(Math.abs(forward) >= Math.abs(side) ? forward > 0 ? 'up' : 'down' : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private setPhysicsEnabled(enabled: boolean): void {
    if (enabled !== this.physicsToggled) return;
    this.physicsToggled = !enabled;
    // SGwilson ToggleOnPhysics / ToggleOffPhysics.
    if (enabled) this.options.physics.SetCollisionMask(...CHARACTER_COLLISION_MASK);
    else this.options.physics.SetCollisionMask(COLLISION.GROUND);
  }

  update(): void { this.input.update(); }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.input.dispose();
    this.options.animation.bindSoulHop(undefined);
    this.setPhysicsEnabled(true);
    this.state.dispose();
    delete this.options.world.player.userData.wortox;
    this.options.world.player.userData.actionEntity?.removeTag('soulstealer');
  }
}
