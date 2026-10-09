import * as THREE from 'three';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import { ACTIONS } from './actions.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import { PlayerActionPicker } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionAnimationController, ActionLocomotor, ActionWorldContext } from './actionContext.ts';
import type { EquipmentEntity } from '../../signals/src/equipment.ts';
import type { SpellCastDoer, SpellCasterComponent } from '../../componets/src/spellcaster.ts';
export type { SpellCastDoer, SpellCastMap, SpellCasterComponent } from '../../componets/src/spellcaster.ts';
type SpellCastAnimation = Pick<ActionAnimationController, 'stategraph' | 'cancelEmote' | 'setFacing'>;

export interface SpellCasterItem extends EquipmentEntity, BufferedActionObject {
  readonly prefab: string;
  getComponent<T extends { dispose(): void }>(name: string): T | undefined;
}
function isSpellCasterItem(item: EquipmentEntity | undefined): item is SpellCasterItem {
  return !!item && 'hasTag' in item && typeof item.hasTag === 'function'
    && 'getComponent' in item && typeof item.getComponent === 'function';
}

/** actions.lua CASTSPELL.fn: the real invobject owns CanCast and CastSpell. */
export function createCastSpellAction(item: SpellCasterItem, doer: SpellCastDoer, position: THREE.Vector3,
  isHeld: () => boolean): BufferedAction<'CASTSPELL'> {
  const point = position.clone();
  const valid = () => !item.isRemoved && isHeld()
    && (item.getComponent<SpellCasterComponent>('spellcaster')?.canCast(doer, undefined, point) ?? false);
  return new BufferedAction('CASTSPELL', () =>
    item.getComponent<SpellCasterComponent>('spellcaster')?.castSpell(undefined, point, doer) ?? false,
  valid, { invobject: item });
}

/** Point spellcasting from componentactions.lua; no prefab IDs or spell implementations. */
export class SpellCastActionController {
  private readonly picker: PlayerActionPicker;
  private readonly stopHover: () => void;
  private readonly stopEquipment: () => void;
  private readonly stopEvents: () => void;
  private pending?: { item: SpellCasterItem; point: THREE.Vector3; action: BufferedAction<'CASTSPELL'>; ready: boolean };
  private active?: BufferedAction<'CASTSPELL'>;
  private version = 0;
  private disposed = false;
  private readonly world: ActionWorldContext;
  private readonly animation: SpellCastAnimation;
  private readonly locomotor: ActionLocomotor;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly doer: SpellCastDoer;
  private readonly isManualMovement: () => boolean;
  private readonly onError: (error: unknown) => void;

  constructor(world: ActionWorldContext, animation: SpellCastAnimation, locomotor: ActionLocomotor,
    handEquipment: HandEquipmentSignal, doer: SpellCastDoer, isManualMovement = () => false,
    onError: (error: unknown) => void = console.error) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.handEquipment = handEquipment; this.doer = doer; this.isManualMovement = isManualMovement; this.onError = onError;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world),
      () => world.player.userData.controllerEnabled !== false);
    this.stopHover = this.picker.register(() => {
      const item = this.equipped(), point = this.picker.pointer.groundPoint();
      return item && point && this.canUsePoint(item, point)
        ? [{ action: { action: 'CASTSPELL', invobject: item }, button: 'right' }] : [];
    });
    this.stopEquipment = bindHandEquipmentUpdate(handEquipment, {
      isEquipped: () => !!this.equipped(), cancel: () => this.cancel(), update: () => this.update(),
      registerFrameTask: world.registerFrameTask,
    });
    this.stopEvents = bindActionCancellation(world, this, 'spell', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private equipped(): SpellCasterItem | undefined {
    const item = this.handEquipment.peek()?.entity;
    return isSpellCasterItem(item) && !item.isRemoved && item.getComponent<SpellCasterComponent>('spellcaster') ? item : undefined;
  }
  private canUsePoint(item: SpellCasterItem, point: THREE.Vector3): boolean {
    return (item.hasTag('castonpoint') || item.hasTag('castonpointwater'))
      && !this.doer.hasTag('steeringboat') && !this.doer.hasTag('rotatingboat')
      && (item.getComponent<SpellCasterComponent>('spellcaster')?.canCast(this.doer, undefined, point) ?? false);
  }
  request(point: THREE.Vector3): boolean {
    const item = this.equipped();
    if (this.disposed || !item || this.animation.stategraph.hasStateTag('busy') || !this.canUsePoint(item, point)) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'CASTSPELL' });
    const version = this.version;
    const action = createCastSpellAction(item, this.doer, point, () => this.equipped() === item);
    const pending = { item, point: point.clone(), action, ready: false };
    this.pending = pending;
    void item.getComponent<SpellCasterComponent>('spellcaster')!.prepareCast().then(() => {
      if (this.disposed || version !== this.version || this.pending !== pending) return;
      if (!action.isValid()) { this.cancel(); return; }
      pending.ready = true;
      this.update();
    }).catch(error => { if (version === this.version) { this.cancel(); this.onError(error); } });
    return true;
  }

  update(): void {
    const pending = this.pending;
    if (!pending) return;
    if (this.isManualMovement() || !pending.action.isValid()) { this.cancel(); return; }
    const distance = this.doer.position.clone().sub(pending.point).setY(0);
    const reach = ACTIONS.CASTSPELL.distance * 3; // Scene units are 3 per source unit.
    if (distance.lengthSq() > reach ** 2) {
      const destination = pending.point.clone().addScaledVector(distance.normalize(), reach * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01)
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      return;
    }
    this.locomotor.stop();
    if (!pending.ready || this.animation.stategraph.hasStateTag('busy')) return;
    const direction = pending.point.clone().sub(this.doer.position).setY(0);
    if (direction.lengthSq() > 0) {
      const forward = this.world.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
      const side = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
      const f = direction.dot(forward), r = direction.dot(side);
      this.animation.setFacing(Math.abs(f) >= Math.abs(r) ? (f > 0 ? 'up' : 'down') : 'side', Math.abs(r) > Math.abs(f) && r < 0);
    }
    this.animation.cancelEmote();
    if (this.animation.stategraph.pushBufferedAction(pending.action)) {
      this.active = pending.action;
      this.pending = undefined;
    }
  }

  cancel(): void {
    this.version++;
    if (this.pending) this.locomotor.stop();
    this.pending = undefined;
    // A stale controller cannot cancel another item's CASTSPELL.
    if (this.active && this.animation.stategraph.isActionActive(this.active))
      this.animation.stategraph.cancelAction('CASTSPELL');
    this.active = undefined;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopEvents(); this.stopEquipment(); this.stopHover(); this.cancel();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.defaultPrevented) return;
    this.picker.pointer.trackPointer(event);
    if (event.button !== 2) { if (event.button === 0) this.cancel(); return; }
    const action = this.picker.getMouseActions().right;
    const point = this.picker.pointer.groundPoint();
    if (action?.action !== 'CASTSPELL' || action.invobject !== this.equipped() || !point) return;
    if (this.request(point)) event.preventDefault();
  };
  private readonly handleKeyDown = (event: KeyboardEvent) => { if (event.code === 'Escape') this.cancel(); };
}
