import * as THREE from 'three';
import type { Stewer, StewerHarvester } from '../../componets/src/stewer';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';

export const HARVEST_REACH = 4;

export interface HarvestTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly component: Stewer;
  getPosition(): THREE.Vector3;
}

export interface PreparedHarvestReceiver extends StewerHarvester { dispose(): void; }

function canHarvest(target: HarvestTarget): boolean {
  return !!target.model.parent && target.model.visible
    && target.model.userData.components?.stewer === target.component
    && !target.hasTag('burnt') && target.hasTag('donecooking') && target.component.IsDone();
}

/** componentactions.lua SCENE.stewer: completed pots offer HARVEST on both buttons. */
export function getHarvestActions(model: THREE.Object3D | undefined): MouseActionCandidate[] {
  const actions: MouseActionCandidate[] = [];
  if (!model) return actions;
  const component = model.userData.components?.stewer as Stewer | undefined;
  if (!component) return actions;
  const target: HarvestTarget = {
    model, component, prefab: model.userData.prefab,
    hasTag: tag => model.userData.tags?.includes(tag) ?? false,
    getPosition: () => model.userData.getGroundPosition?.() ?? model.position.clone(),
  };
  for (const button of ['left', 'right'] as const) actions.push({
    action: { action: 'HARVEST', target }, button, model, available: canHarvest(target),
  });

  return actions;
}

/** Shared scene HARVEST input; Stewer owns the product, SGwilson owns commitment. */
export class HarvestActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopActionEvents: () => void;
  private target?: HarvestTarget;
  private receiver?: PreparedHarvestReceiver;
  private action?: BufferedAction<'HARVEST'>;
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly prepareReceiver: (prefab: string, count: number) => Promise<PreparedHarvestReceiver>;
  private readonly isManualMovement: () => boolean;
  private readonly onError: (error: unknown) => void;

  constructor(
    world: ActionWorldContext,
    animation: ActionAnimationController,
    locomotor: ActionLocomotor,
    prepareReceiver: (prefab: string, count: number) => Promise<PreparedHarvestReceiver>,
    isManualMovement = () => false,
    onError: (error: unknown) => void = console.error,
  ) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.prepareReceiver = prepareReceiver; this.isManualMovement = isManualMovement; this.onError = onError;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getHarvestActions(model));
    this.stopActionEvents = bindActionCancellation(world, this, 'harvest', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: HarvestTarget): boolean {
    if (this.disposed || !canHarvest(target) || !target.component.product
      || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'HARVEST' });
    this.animation.cancelEmote();
    this.target = target;
    const version = this.version;
    void this.prepareReceiver(target.component.product, target.component.GetRecipeForProduct()?.stacksize ?? 1)
      .then(receiver => {
        if (this.disposed || version !== this.version) receiver.dispose();
        else this.receiver = receiver;
      }).catch((error: unknown) => {
        if (version === this.version) this.cancel();
        this.onError(error);
      });
    return true;
  }

  cancel(): void {
    this.version++;
    if (this.target || (this.action && this.animation.stategraph.isActionActive(this.action))) this.locomotor.stop();
    this.target = undefined;
    if (this.action && this.animation.stategraph.isActionActive(this.action)) this.animation.stategraph.cancelAction('HARVEST');
    this.action = undefined;
    this.receiver?.dispose(); this.receiver = undefined;
  }

  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.action && !this.animation.stategraph.isActionActive(this.action)) { this.cancel(); return; }
    const target = this.target;
    if (!target) return;
    if (!canHarvest(target)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, position).setY(0).normalize();
      const destination = position.addScaledVector(this.direction, HARVEST_REACH * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    const receiver = this.receiver;
    if (!receiver) return;
    this.faceTarget(position);
    const version = this.version, product = target.component.product;
    const valid = () => version === this.version && canHarvest(target)
      && this.inReach(target) && target.component.product === product;
    const action = new BufferedAction('HARVEST', () => {
      // actions.lua HARVEST.fn delegates the stewer branch to its component.
      const success = target.component.Harvest(receiver);
      receiver.dispose();
      if (this.receiver === receiver) this.receiver = undefined;
      return success;
    }, valid, { target });
    if (this.animation.stategraph.pushBufferedAction(action)) {
      this.action = action;
      this.target = undefined;
    }
  }

  private inReach(target: HarvestTarget): boolean {
    const position = target.getPosition(), player = this.world.player.position;
    return (position.x - player.x) ** 2 + (position.z - player.z) ** 2 <= HARVEST_REACH ** 2;
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
    if (this.disposed || event.defaultPrevented || (event.button !== 0 && event.button !== 2)) return;
    this.picker.pointer.trackPointer(event);
    const actions = this.picker.getMouseActions(event);
    const action = event.button === 0 ? actions.left : actions.right;
    if (action?.action !== 'HARVEST' || !action.target) { this.cancel(); return; }
    // Occupiable targets share the action id and belong to OccupiableActionController.
    if (!(action.target as Partial<HarvestTarget>).component) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.target as HarvestTarget);
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
