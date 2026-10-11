import * as THREE from 'three';
import { BufferedAction } from './bufferedaction.ts';
import { bindActionCancellation } from './actionEvents.ts';
import type { ActionAnimationController, ActionLocomotor, ActionWorldContext } from './actionContext.ts';
import type { ComponentActionEntity } from './componentactions.ts';
import type { MouseActionCandidate } from './playeractionpicker.ts';
import { PlayerActionPicker } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { TradeItem } from '../../componets/src/trader';

export interface ItemUseSource {
  readonly entity: TradeItem;
  isValid(): boolean;
  /** Delete a consumed item, or detach the same inst for a trader with deleteitemonaccept=false. */
  take(deleteItem: boolean): boolean;
}
export interface ItemUseTarget extends ComponentActionEntity {
  readonly model: THREE.Group;
  getPosition(): THREE.Vector3;
}
type ItemUseAction = 'GIVE' | 'REPAIR';
export const ITEM_USE_REACH = 4;

function available(action: ItemUseAction, target: ItemUseTarget, source: ItemUseSource): boolean {
  if (target.isRemoved || target.hasTag('burnt') || target.hasTag('INLIMBO') || !source.isValid()) return false;
  if (action === 'REPAIR') return !!target.components.repairable?.CanRepair(source.entity);
  return !!target.components.trader?.AbleToAccept(source.entity).ok;
}

/** USEITEM.repairer / tradable: discover actions from components, never from prefab IDs. */
export function getItemUseActions(scene: THREE.Scene, source: ItemUseSource | undefined): MouseActionCandidate[] {
  if (!source) return [];
  const actions: MouseActionCandidate[] = [];
  scene.traverse(model => {
    const target = model.userData.actionEntity as ItemUseTarget | undefined;
    if (!target) return;
    if (target.components.repairable && source.entity.components?.repairer) {
      actions.push({ action: { action: 'REPAIR', target, invobject: source.entity }, button: 'right',
        model, source: 'inventory', available: available('REPAIR', target, source) });
    }
    if (target.components.trader) actions.push({ action: { action: 'GIVE', target, invobject: source.entity },
      button: 'left', model, source: 'inventory', available: available('GIVE', target, source) });
  });
  return actions;
}

/** Common locomotor + buffered item action. SGwilson owns the commit frame and cancellation. */
export class ItemUseActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopEvents: () => void;
  private readonly stopActiveItem: () => void;
  private pending?: { action: ItemUseAction; target: ItemUseTarget; source: ItemUseSource };
  private buffered?: BufferedAction<ItemUseAction>;
  private disposed = false;
  private version = 0;
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly source: () => ItemUseSource | undefined;
  private readonly interrupted: () => boolean;
  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor,
    source: () => ItemUseSource | undefined, interrupted = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.source = source; this.interrupted = interrupted;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(() => getItemUseActions(world.scene, source()));
    this.stopActiveItem = this.picker.registerActiveItemSource(() => source() !== undefined);
    this.stopEvents = bindActionCancellation(world, this, 'itemuse', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.pointerDown, true);
    window.addEventListener('keydown', this.keyDown);
  }
  request(action: ItemUseAction, target: ItemUseTarget, source = this.source()): boolean {
    if (this.disposed || !source || !available(action, target, source)
      || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action });
    this.animation.cancelEmote();
    this.pending = { action, target, source };
    return true;
  }
  update(): void {
    if (this.disposed) return;
    if (this.interrupted()) { this.cancel(); return; }
    if (this.buffered && !this.animation.stategraph.isActionActive(this.buffered)) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending) return;
    const { action, target, source } = pending;
    if (!available(action, target, source)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(target)) {
      const direction = this.world.player.position.clone().sub(position).setY(0).normalize();
      const destination = position.clone().addScaledVector(direction, ITEM_USE_REACH * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    const direction = position.clone().sub(this.world.player.position).setY(0);
    const forward = new THREE.Vector3(); this.world.camera.getWorldDirection(forward); forward.setY(0).normalize();
    const side = direction.dot(new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)));
    const depth = direction.dot(forward);
    this.animation.setFacing(Math.abs(depth) >= Math.abs(side) ? (depth > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(depth) && side < 0);
    const version = this.version;
    const buffered = new BufferedAction(action, () => action === 'REPAIR'
      ? target.components.repairable!.Repair(source.entity, () => source.take(true))
      : target.components.trader!.AcceptGift(source.entity, deleteItem => source.take(deleteItem)),
    () => version === this.version && available(action, target, source) && this.inReach(target),
    { target, invobject: source.entity });
    if (this.animation.stategraph.pushBufferedAction(buffered)) {
      this.buffered = buffered;
      this.pending = undefined;
    }
  }
  private inReach(target: ItemUseTarget): boolean {
    const position = target.getPosition(), player = this.world.player.position;
    return (position.x - player.x) ** 2 + (position.z - player.z) ** 2 <= ITEM_USE_REACH ** 2;
  }
  cancel(): void {
    this.version++;
    if (this.pending || (this.buffered && this.animation.stategraph.isActionActive(this.buffered))) this.locomotor.stop();
    this.pending = undefined;
    if (this.buffered && this.animation.stategraph.isActionActive(this.buffered)) this.animation.stategraph.cancelAction(this.buffered.action);
    this.buffered = undefined;
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.defaultPrevented || event.button > 2 || event.button === 1) return;
    this.picker.pointer.trackPointer(event);
    const actions = this.picker.getMouseActions(), action = event.button === 0 ? actions.left : actions.right;
    if ((action?.action !== 'GIVE' && action?.action !== 'REPAIR') || !action.target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.action, action.target as ItemUseTarget);
  };
  private readonly keyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
  dispose(): void {
    if (this.disposed) return;
    this.cancel(); this.disposed = true;
    this.unregister(); this.stopEvents(); this.stopActiveItem();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, true);
    window.removeEventListener('keydown', this.keyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}
