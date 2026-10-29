import * as THREE from 'three';
import type { ActionWorldContext, ActionAnimationController, ActionLocomotor } from './actionContext.ts';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';
import { bindActionCancellation } from './actionEvents.ts';
import type { MouseActionCandidate } from './playeractionpicker.ts';
import { PlayerActionPicker } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { Combat } from '../../componets/src/combat';
import { modelHasTag, prefabInstance } from '../../prefab/src/prefabInstance';
import type { SpriteState } from '@dontstarve-web/display';
import { findActionEntity } from '../../prefab/src/actionEntity';

/** The picker inst supplied to prefab onpickedfn callbacks. */
export interface PickActor {
  hasTag(tag: string): boolean;
  PushEvent?(name: string, data?: unknown): void;
  readonly components: {
    sanity?: { DoDelta(delta: number): void };
    combat?: Pick<Combat, 'GetAttacked'>;
    inventory?: { EquipHasTag(tag: string): boolean; GiveItem?(item: ItemEntity, source?: THREE.Vector3): boolean };
  };
}

// actions.lua PickRangeCheck: target:GetPhysicsRadius(0) + 4 + extrarange.
// Ground flowers have radius 0; bushes include their source obstacle radius.
export const PICK_REACH = 4;

/** The actor supplies inventory reception; products belong to the pickable component. */
export interface PickDoer {
  readonly picker?: PickActor;
  readonly loot?: unknown;
  giveItem(itemId: string, count: number, sourcePosition: THREE.Vector3): boolean;
  giveEntity?(entity: ItemEntity, sourcePosition: THREE.Vector3): boolean;
}

export interface PreparedPickDoer extends PickDoer { dispose(): void; }
export type PreparePickDoer = (itemId: string, count: number, entity?: ItemEntity) => Promise<PreparedPickDoer>;

export interface PickableComponent {
  readonly canBePicked: boolean;
  readonly product?: string;
  readonly numToHarvest?: number;
  readonly quickpick?: boolean;
  readonly productEntity?: ItemEntity;
  pick(doer: PickDoer): boolean;
}

interface PickTarget extends BufferedActionObject {
  readonly model: THREE.Object3D;
  readonly component: PickableComponent;
  getPosition(): THREE.Vector3;
  getPhysicsRadius?(): number;
}

function canPick(target: PickTarget): boolean {
  // componentactions.lua SCENE.pickable and actions.lua PICK.validfn.
  return target.hasTag('pickable') && !target.hasTag('fire') && !target.hasTag('intense')
    && target.component.canBePicked;
}

/** Scene PICK actions are discovered from components and tags, independent of prefab IDs. */
export function getPickActions(model: THREE.Object3D | undefined): MouseActionCandidate[] {
  const actions: MouseActionCandidate[] = [];
  if (!model) return actions;
  const entity = findActionEntity(model), instance = prefabInstance(model);
  const component = (entity?.components.pickable ?? instance?.components.pickable ?? model.userData.components?.pickable) as PickableComponent | undefined;
  if (!component) return actions;
  const target: PickTarget = {
    model, component, prefab: entity?.prefab ?? instance?.prefab,
    quickpick: component.quickpick,
    hasTag: tag => entity?.hasTag(tag) ?? modelHasTag(model, tag),
    getPosition: () => entity?.getPosition() ?? instance?.position ?? model.userData.getGroundPosition?.() ?? model.position,
    getPhysicsRadius: () => entity?.getPhysicsRadius?.() ?? instance?.getPhysicsRadius(0) ?? 0,
    PushEvent: (name, data) => { if (entity) entity.PushEvent?.(name, data); else instance?.PushEvent(name, data); },
  };
  actions.push({ action: { action: 'PICK', target }, button: 'left', model, available: canPick(target) });

  return actions;
}

/** Common PICK input; SGwilson chooses when the buffered action commits. */
export class PickActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopActionEvents: () => void;
  private target?: PickTarget;
  private action?: BufferedAction<'PICK'>;
  private receiver?: PickDoer & { dispose?: () => void };
  private version = 0;
  private disposed = false;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly playerSprite: Pick<SpriteState, 'setFacing'>;
  private readonly locomotor: ActionLocomotor;
  private readonly doer: PickDoer | PreparePickDoer;
  private readonly isManualMovement: () => boolean;

  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor,
    doer: PickDoer | PreparePickDoer, playerSprite: Pick<SpriteState, 'setFacing'>, isManualMovement = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.doer = doer; this.playerSprite = playerSprite; this.isManualMovement = isManualMovement;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => getPickActions(model));
    this.stopActionEvents = bindActionCancellation(world, this, 'pick', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  request(target: PickTarget): boolean {
    if (this.disposed || !canPick(target) || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'PICK' });
    this.animation.cancelEmote();
    this.target = target;
    const version = this.version;
    if (typeof this.doer === 'function') {
      // pickable.lua permits a nil product (for example clearing an overripe bush).
      if (!target.component.product) { this.receiver = { giveItem: () => false }; return true; }
      const product = target.component.productEntity;
      const preparing = product
        ? this.doer(target.component.product, target.component.numToHarvest ?? 1, product)
        : this.doer(target.component.product, target.component.numToHarvest ?? 1);
      void preparing.then(receiver => {
        if (this.disposed || version !== this.version) receiver.dispose();
        else this.receiver = receiver;
      }).catch((error: unknown) => {
        if (version === this.version) this.cancel();
        console.error('Unable to prepare picked product', error);
      });
    } else this.receiver = this.doer;
    return true;
  }

  cancel(): void {
    this.version++;
    if (this.target || (this.action && this.animation.stategraph.isActionActive(this.action))) this.locomotor.stop();
    this.target = undefined;
    if (this.action && this.animation.stategraph.isActionActive(this.action)) this.animation.stategraph.cancelAction('PICK');
    this.action = undefined;
    this.receiver?.dispose?.(); this.receiver = undefined;
  }

  update(): void {
    if (this.disposed) return;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (this.action && !this.animation.stategraph.isActionActive(this.action)) { this.cancel(); return; }
    const target = this.target;
    if (!target) return;
    if (!canPick(target)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(target)) {
      this.direction.subVectors(this.world.player.position, position).normalize();
      const destination = position.clone().addScaledVector(this.direction, (PICK_REACH + (target.getPhysicsRadius?.() ?? 0)) * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    const receiver = this.receiver;
    if (!receiver) return;
    this.faceTarget(position);
    const version = this.version;
    const action = new BufferedAction('PICK', () => {
      try { return target.component.pick(receiver); }
      finally {
        receiver.dispose?.();
        if (this.receiver === receiver) this.receiver = undefined;
      }
    },
      () => version === this.version && canPick(target) && this.inReach(target), { target });
    if (this.animation.stategraph.pushBufferedAction(action)) {
      this.action = action;
      this.target = undefined;
    }
  }

  private inReach(target: PickTarget): boolean {
    const position = target.getPosition(), player = this.world.player.position;
    return position.distanceToSquared(player) <= (PICK_REACH + (target.getPhysicsRadius?.() ?? 0)) ** 2;
  }

  private faceTarget(position: THREE.Vector3): void {
    this.direction.subVectors(position, this.world.player.position);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward); this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, new THREE.Vector3(0, 1, 0)).normalize();
    const forward = this.direction.dot(this.forward), side = this.direction.dot(this.right);
    this.playerSprite.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 2 : 8) : 5,
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.button !== 0 || event.defaultPrevented) return;
    this.picker.pointer.trackPointer(event);
    const action = this.picker.getMouseActions(event).left;
    if (action?.action !== 'PICK' || !action.target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.target as PickTarget);
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancel();
    this.stopActionEvents(); this.unregister();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}
