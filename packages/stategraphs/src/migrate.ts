import { findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import type { WorldMigrator, WorldMigratorDoer } from '../../componets/src/worldmigrator';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { modelHasTag, prefabInstance } from '../../prefab/src/prefabInstance';

/** Reach beyond the portal's obstacle physics radius. */
export const MIGRATE_REACH = 4;

export interface MigrateTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly component: WorldMigrator;
  getPosition(): THREE.Vector3;
  getPhysicsRadius(): number;
}

/** The portal is attached and its `migrator` tag (ACTIVE destination) is present. */
function canMigrate(target: MigrateTarget): boolean {
  return !!target.model.parent && target.model.visible
    && (findActionEntity(target.model)?.components.worldmigrator ?? prefabInstance(target.model)?.components.worldmigrator) === target.component && target.hasTag('migrator');
}

/** componentactions.lua SCENE.worldmigrator: a `migrator` offers MIGRATE on the left button. */
export function getMigrateActions(model: THREE.Object3D | undefined): MouseActionCandidate[] {
  const component = (findActionEntity(model)?.components.worldmigrator ?? prefabInstance(model)?.components.worldmigrator) as WorldMigrator | undefined;
  if (!model || !component) return [];
  const instance = prefabInstance(model);
  const target: MigrateTarget = {
    model, component, prefab: findActionEntity(model)?.prefab ?? instance?.prefab,
    hasTag: tag => findActionEntity(model)?.hasTag(tag) ?? modelHasTag(model, tag),
    getPosition: () => model.position,
    getPhysicsRadius: () => instance?.getPhysicsRadius(0) ?? 0,
  };
  return target.hasTag('migrator') ? [{ action: { action: 'MIGRATE', target }, button: 'left', model, available: canMigrate(target) }] : [];
}

/** Click a shard portal: walk to it, then MIGRATE through SGwilson's migrate state; worldmigrator owns the transfer. */
export class MigrateActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopActionEvents: () => void;
  private target?: MigrateTarget;
  private action?: BufferedAction<'MIGRATE'>;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly doer: WorldMigratorDoer;
  private readonly isManualMovement: () => boolean;

  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor,
    doer: WorldMigratorDoer, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.doer = doer; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getMigrateActions(model));
    this.stopActionEvents = bindActionCancellation(world, this, 'migrate', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: MigrateTarget): boolean {
    if (this.disposed || !canMigrate(target) || this.animation.stategraph.hasStateTag('busy')
      || this.animation.stategraph.isSleeping || this.animation.stategraph.isDead) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'MIGRATE' });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  cancel(): void {
    if (this.target || (this.action && this.animation.stategraph.isActionActive(this.action))) this.locomotor.stop();
    this.target = undefined;
    if (this.action && this.animation.stategraph.isActionActive(this.action)) this.animation.stategraph.cancelAction('MIGRATE');
    this.action = undefined;
  }

  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.action && !this.animation.stategraph.isActionActive(this.action)) { this.cancel(); return; }
    const target = this.target;
    if (!target) return;
    if (!canMigrate(target)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      const destination = position.clone().addScaledVector(this.direction, (MIGRATE_REACH + target.getPhysicsRadius()) * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(position);
    // actions.lua MIGRATE.fn: the target's worldmigrator activates for the doer.
    const action = new BufferedAction('MIGRATE', () => target.component.Activate(this.doer),
      () => canMigrate(target) && this.inReach(target), { target });
    if (this.animation.stategraph.pushBufferedAction(action)) {
      this.action = action;
      this.target = undefined;
    }
  }

  private inReach(target: MigrateTarget): boolean {
    const position = target.getPosition(), player = this.world.player.position;
    return position.distanceToSquared(player) <= (MIGRATE_REACH + target.getPhysicsRadius()) ** 2;
  }

  private faceTarget(position: THREE.Vector3): void {
    this.direction.subVectors(position, this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward); this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    const forward = this.direction.dot(this.forward), side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.defaultPrevented || event.button !== 0) return;
    this.picker.pointer.trackPointer(event);
    const action = this.picker.getMouseActions(event).left;
    if (action?.action !== 'MIGRATE' || !action.target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.target as MigrateTarget);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.cancel();
    this.stopActionEvents(); this.unregister();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}
