import * as THREE from 'three';
import { TILE_SIZE } from '../../prefab/src/tile.ts';
import { ACTIONS } from './actions.ts';
import { BufferedAction } from './bufferedaction.ts';
import type { ActionWorldContext, ActionLocomotor } from './actionContext.ts';
import type { WilsonStateGraph } from './SGwilson.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { PlayerActionPicker } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';

export const SOUL_HOP_DISTANCE = ACTIONS.BLINK.distance * TILE_SIZE / 4;

export interface SoulHopActor {
  canSoulHop(): boolean;
  canBlinkTo(position: THREE.Vector3): boolean;
  hasSoulEcho(): boolean;
}

/** wortox.lua GetPointSpecialActions -> buffered BLINK -> SGwilson portal_jumpin_pre. */
export class BlinkActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopEvents: () => void;
  private destination?: THREE.Vector3;
  private action?: BufferedAction<'BLINK'>;
  private disposed = false;

  private readonly world: ActionWorldContext;
  private readonly animation: { stategraph: WilsonStateGraph };
  private readonly locomotor: ActionLocomotor;
  private readonly actor: SoulHopActor;
  private readonly isManualMovement: () => boolean;

  constructor(world: ActionWorldContext, animation: { stategraph: WilsonStateGraph },
    locomotor: ActionLocomotor, actor: SoulHopActor, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.actor = actor; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(target => {
      if (target) return [];
      const point = this.picker.pointer.groundPoint();
      return this.actor.canSoulHop() && point && this.actor.canBlinkTo(point) ? [{
        action: { action: 'BLINK', modifier: this.actor.hasSoulEcho() ? 'FREESOUL' : 'SOUL' }, button: 'right', source: 'special',
      }] : [];
    });
    this.stopEvents = bindActionCancellation(world, this, 'spell', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.onPointerDown, true);
    window.addEventListener('keydown', this.onKeyDown);
  }

  request(position: THREE.Vector3): boolean {
    if (this.disposed || !this.actor.canSoulHop() || !this.actor.canBlinkTo(position)
      || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'BLINK' });
    this.destination = position.clone();
    this.update();
    return true;
  }

  update(): void {
    if (this.disposed) return;
    if (this.action && !this.animation.stategraph.isActionActive(this.action)) this.action = undefined;
    const position = this.destination;
    if (!position) return;
    if (this.isManualMovement() || !this.actor.canSoulHop() || !this.actor.canBlinkTo(position)) { this.cancel(); return; }
    if (this.world.player.position.distanceToSquared(position) > SOUL_HOP_DISTANCE ** 2) {
      if (!this.locomotor.destination && !this.locomotor.goToPoint(position)) this.cancel();
      return;
    }
    this.locomotor.stop();
    const valid = () => this.actor.canSoulHop() && this.actor.canBlinkTo(position)
      && this.world.player.position.distanceToSquared(position) <= SOUL_HOP_DISTANCE ** 2;
    const action = new BufferedAction('BLINK', () => this.animation.stategraph.beginPortalJump(position), valid,
      { pos: position, distance: SOUL_HOP_DISTANCE });
    if (this.animation.stategraph.pushBufferedAction(action)) { this.action = action; this.destination = undefined; }
  }

  cancel(): void {
    if (this.destination) this.locomotor.stop();
    this.destination = undefined;
    // Once BLINK has committed, its nointerrupt jump-out and cleanup belong to the stategraph.
    if (this.action && this.animation.stategraph.stateName === 'portal_jumpin_pre') this.animation.stategraph.cancelAction('BLINK');
    this.action = undefined;
  }

  private readonly onPointerDown = (event: PointerEvent) => {
    if (this.disposed || event.defaultPrevented || event.button !== 2) return;
    if (this.picker.getMouseActions(event).right?.action !== 'BLINK') return;
    const point = this.picker.pointer.groundPoint();
    if (!point) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(point);
  };
  private readonly onKeyDown = (event: KeyboardEvent) => { if (event.code === 'Escape') this.cancel(); };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel(); this.unregister(); this.stopEvents();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown, true);
    window.removeEventListener('keydown', this.onKeyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}
