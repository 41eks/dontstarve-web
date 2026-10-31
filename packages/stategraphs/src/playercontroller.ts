import { bindActionCancellation, type PlayerActionKind } from './actionEvents.ts';
import { isHandActionBusy, type ActionLocomotor, type ActionPerformer, type ActionWorldContext } from './actionContext.ts';
import { createBufferedAction, hasActionFn } from './actionfns.ts';
import { ACTIONS, type ActionDescription, type MouseActionId } from './actions.ts';
import type { BufferedAction, BufferedActionDoer, BufferedActionObject } from './bufferedaction.ts';
import { equippedActionEntity, type ComponentActionEntity, type SceneActionDoer } from './componentactions.ts';
import { facePoint } from './facing.ts';
import { watchHandEquipment, type HandEquipmentSignal } from './handEquipment.ts';
import { PlayerActionPicker } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { WilsonAction } from './SGwilson.ts';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { WORLD_SCALE } from '../../prefab/src/tile';

/** An entity the picker resolved as an action target: tags and components plus its ground position and radius. */
type ActionTargetEntity = ComponentActionEntity & {
  getPosition(): import('three').Vector3;
  getPhysicsRadius?(): number;
};

export type PlayerLocomotor = ActionLocomotor & Required<Pick<ActionLocomotor, 'PushAction'>>;

/**
 * playercontroller.lua for the actions whose actions.lua fn is ported (equipped tool work and scene actions): a mouse click takes the picker's action for
 * that button, wraps it in a BufferedAction for the player and DoAction hands it to locomotor:PushAction, which
 * walks to the target and buffers it on the stategraph. The stategraph's ActionHandler chooses the state and its
 * hit frame runs ACTIONS[action].fn. The player has one buffered action: a new one, another click, movement input,
 * Escape or a change of the hand item drops it.
 */
export class PlayerController {
  private readonly world: ActionWorldContext;
  private readonly performer: ActionPerformer;
  private readonly locomotor: PlayerLocomotor;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly isManualMovement: () => boolean;
  private readonly picker: PlayerActionPicker;
  private readonly ownsPicker: boolean;
  private readonly doer: BufferedActionDoer & SceneActionDoer;
  private readonly cleanups: (() => void)[] = [];
  /** The action this controller pushed: walked to by the locomotor, then buffered on the stategraph. */
  private action?: BufferedAction<WilsonAction>;
  private walking = false;
  private disposed = false;

  constructor(
    world: ActionWorldContext,
    performer: ActionPerformer,
    locomotor: PlayerLocomotor,
    handEquipment: HandEquipmentSignal,
    isManualMovement = () => false,
    /** The player inst as act.doer; standalone controllers adapt their player model. */
    doer?: BufferedActionDoer & SceneActionDoer,
  ) {
    this.world = world;
    this.performer = performer;
    this.locomotor = locomotor;
    this.handEquipment = handEquipment;
    this.isManualMovement = isManualMovement;
    this.ownsPicker = !world.mouseActions;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    const player = world.player;
    this.doer = doer ?? {
      get components() { return prefabInstance(player)?.components as (BufferedActionDoer & SceneActionDoer)['components']; },
      hasTag: tag => tag === 'player' || prefabInstance(player)?.hasTag(tag) === true,
      PushEvent: (name, data) => player.dispatchEvent({ type: name, data } as never),
      getPosition: () => player.position,
      sg: { HasStateTag: tag => performer.stategraph.hasStateTag(tag) },
    };
    this.cleanups.push(this.picker.bindPlayer(this.doer, () => this.equippedItem()));
    this.cleanups.push(bindActionCancellation(world, this, 'player', () => this.cancel()));
    // An action keeps the hand item it was picked with; equipping another drops it.
    this.cleanups.push(watchHandEquipment(handEquipment, equipment => {
      const invobject = this.action?.invobject;
      if (invobject && invobject !== equippedActionEntity(equipment)) this.cancel();
    }));
    const removeFrameTask = world.registerFrameTask?.(() => this.update());
    if (removeFrameTask) this.cleanups.push(removeFrameTask);
    // Capture, so a work click cannot also open a container, place a building or walk.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private equippedItem(): ComponentActionEntity | undefined {
    const item = equippedActionEntity(this.handEquipment.peek());
    return item && !item.isRemoved ? item : undefined;
  }

  /** The buffered action this controller owns, while it is walked to or performed. */
  get bufferedAction(): BufferedAction<WilsonAction> | undefined { return this.action; }

  /** PlayerActionPicker:SortActionList's BufferedAction(doer, target, action, invobject) for a picked action. */
  createAction(description: ActionDescription): BufferedAction<WilsonAction> | undefined {
    const target = description.target as (BufferedActionObject & Partial<ActionTargetEntity>) | undefined;
    if (!hasActionFn(description.action) || !target?.getPosition) return undefined;
    const invobject = description.invobject as (BufferedActionObject & { isRemoved?: boolean }) | undefined;
    // GetEquippedItemActions: the action is the hand item's for as long as it stays in the hand.
    const validfn = () => invobject === undefined || invobject === this.equippedItem();
    return createBufferedAction(description.action as WilsonAction, { doer: this.doer, target, invobject }, validfn);
  }

  /** PlayerController:DoAction: locomotor:PushAction walks to the target and the inst buffers the action there. */
  DoAction(action: BufferedAction<WilsonAction>): boolean {
    const { stategraph } = this.performer;
    const target = action.target as Partial<ActionTargetEntity> | undefined;
    if (this.disposed || !target?.getPosition || stategraph.hasStateTag('busy') || isHandActionBusy(stategraph)
      || !action.isValid()) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: action.action as PlayerActionKind });
    this.performer.cancelEmote();
    this.action = action;
    this.walking = true;
    const { distance, mindistance } = (ACTIONS[action.action as MouseActionId] ?? {}) as { distance?: number; mindistance?: number };
    this.locomotor.PushAction({
      target: { getPosition: () => target.getPosition!(), getPhysicsRadius: () => target.getPhysicsRadius?.() ?? 0 },
      ...(distance === undefined ? {} : { distance: distance * WORLD_SCALE }),
      ...(mindistance === undefined ? {} : { minDistance: mindistance * WORLD_SCALE }),
      isValid: () => action.isValid(),
    }, () => this.arrive(action), () => {
      if (this.action !== action || !this.walking) return;
      this.walking = false;
      this.action = undefined;
    });
    return true;
  }

  /** locomotor OnUpdate at the destination: FaceMovePoint, then inst:PushBufferedAction. */
  private arrive(action: BufferedAction<WilsonAction>): void {
    if (this.action !== action) return;
    this.walking = false;
    const target = action.target as Partial<ActionTargetEntity>;
    facePoint(this.performer, this.world.camera, this.world.player.position, target.getPosition!());
    if (!this.performer.stategraph.pushBufferedAction(action)) this.action = undefined;
  }

  /** locomotor:Clear and inst:ClearBufferedAction for this controller's action. */
  cancel(): void {
    const action = this.action;
    if (!action) return;
    this.action = undefined;
    if (this.walking) { this.walking = false; this.locomotor.stop(); }
    const { stategraph } = this.performer;
    if (stategraph.isActionActive(action)) stategraph.cancelAction(action.action);
  }

  update(): void {
    if (this.action && this.isManualMovement()) this.cancel();
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.cleanups.splice(0).forEach(stop => stop());
    if (this.ownsPicker) this.picker.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented || (event.button !== 0 && event.button !== 2)) return;
    const actions = this.picker.getMouseActions(event);
    const picked = event.button === 0 ? actions.left : actions.right;
    const action = picked && this.createAction(picked);
    // Another click is another action: WALKTO or one buffered elsewhere replaces this one.
    if (!action) { this.cancel(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.DoAction(action);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}
