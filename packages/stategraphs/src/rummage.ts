import { findActionEntity } from '../../prefab/src/actionEntity';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';

export const RUMMAGE_REACH = 4;

/** What actions.lua RUMMAGE reads from the target's container component. */
export interface RummageContainer {
  canbeopened: boolean;
  CanOpen(): boolean;
  IsOpenedBy(doer: object): boolean;
  Open(doer?: object): void;
  Close(doer?: object): void;
}

export interface RummageTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly isRemoved: boolean;
  readonly components: { container?: RummageContainer };
  getPosition(): THREE.Vector3;
}

/** componentactions.lua SCENE.container: an unburnt container that can be opened; the bundle branch is not ported. */
function canRummage(target: RummageTarget): boolean {
  const container = target.components.container;
  return !target.isRemoved && !!target.model.parent && !!container && !target.hasTag('bundle')
    && !target.hasTag('burnt') && container.canbeopened;
}

export function getRummageActions(model: THREE.Object3D | undefined, doer: object): MouseActionCandidate[] {
  if (!model) return [];
  const target = findActionEntity(model) as RummageTarget | undefined;
  if (!target || !canRummage(target)) return [];
  // actions.lua RUMMAGE.strfn: CLOSE while the doer has it open.
  const modifier = target.components.container!.IsOpenedBy(doer) ? 'CLOSE' : undefined;
  return [{ action: { action: 'RUMMAGE', target, ...modifier ? { modifier } : {} }, button: 'left', model }];
}

/** actions.lua RUMMAGE.fn for a scene container: close it if the doer has it open, otherwise open it. */
export function performRummageAction(target: RummageTarget, doer: THREE.Object3D): boolean {
  const container = target.components.container;
  if (target.isRemoved || !container) return false;
  if (container.IsOpenedBy(doer)) {
    container.Close(doer);
    prefabInstance(doer)?.PushEvent('closecontainer', { container: target });
    return true;
  }
  if (!container.CanOpen() || !container.canbeopened) return false;
  prefabInstance(doer)?.PushEvent('opencontainer', { container: target });
  container.Open(doer);
  return true;
}

/** RUMMAGE: walk to the container, SGwilson's doshortaction, then container:Open / Close. */
export class RummageActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopActionEvents: () => void;
  private pending?: RummageTarget;
  private buffered?: BufferedAction<'RUMMAGE'>;
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly isManualMovement: () => boolean;

  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getRummageActions(model, world.player));
    this.stopActionEvents = bindActionCancellation(world, this, 'harvest', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: RummageTarget): boolean {
    if (this.disposed || !canRummage(target) || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'RUMMAGE' });
    this.animation.cancelEmote();
    this.pending = target;
    return true;
  }

  cancel(): void {
    this.version++;
    if (this.pending || (this.buffered && this.animation.stategraph.isActionActive(this.buffered))) this.locomotor.stop();
    this.pending = undefined;
    if (this.buffered && this.animation.stategraph.isActionActive(this.buffered)) this.animation.stategraph.cancelAction('RUMMAGE');
    this.buffered = undefined;
  }

  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.buffered && !this.animation.stategraph.isActionActive(this.buffered)) { this.cancel(); return; }
    const target = this.pending;
    if (!target) return;
    if (!canRummage(target)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(position)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      const destination = position.clone().addScaledVector(this.direction, RUMMAGE_REACH * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(position);
    const version = this.version;
    const buffered = new BufferedAction('RUMMAGE', () => performRummageAction(target, this.world.player),
      () => version === this.version && !target.isRemoved && this.inReach(target.getPosition()), { target });
    if (this.animation.stategraph.pushBufferedAction(buffered)) {
      this.buffered = buffered;
      this.pending = undefined;
    }
  }

  private inReach(position: THREE.Vector3): boolean {
    return this.world.player.position.distanceToSquared(position) <= RUMMAGE_REACH ** 2;
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
    const target = action?.target as RummageTarget | undefined;
    if (action?.action !== 'RUMMAGE' || !target?.components?.container) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(target);
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
