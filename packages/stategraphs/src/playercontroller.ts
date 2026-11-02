import { bindActionCancellation, type PlayerActionKind } from './actionEvents.ts';
import { isHandActionBusy, type ActionLocomotor, type ActionWorldContext } from './actionContext.ts';
import { createBufferedAction, hasActionFn } from './actionfns.ts';
import { ACTIONS, type ActionDescription, type MouseActionId } from './actions.ts';
import type { BufferedAction, BufferedActionDoer, BufferedActionObject } from './bufferedaction.ts';
import { equippedActionEntity, type ComponentActionEntity, type SceneActionDoer } from './componentactions.ts';
import type { WilsonStateGraph } from './SGwilson.ts';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { watchHandEquipment, type HandEquipmentSignal } from './handEquipment.ts';
import { PlayerActionPicker } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { WilsonAction } from './SGwilson.ts';
import { FindEntities } from '../../prefab/src/actionEntity';
import { WORLD_SCALE } from '../../prefab/src/tile';
import type { Combat, CombatInst } from '../../componets/src/combat';
import { Vector3 } from 'three';
import type { ItemEntity } from '../../inventory/src/entity';

/** An entity the picker resolved as an action target: tags and components plus its ground position and radius. */
type ActionTargetEntity = ComponentActionEntity & {
  getPosition(): import('three').Vector3;
  getPhysicsRadius?(): number;
  /** PlayerController:GetMapActions' workaround flags, read by pointspecialactionsfn. */
  checkingmapactions?: boolean;
  checkingmapactions_pos?: Vector3;
};

export type PlayerLocomotor = ActionLocomotor & Required<Pick<ActionLocomotor, 'PushAction'>>;

type PlayerDoer = BufferedActionDoer & SceneActionDoer & {
  readonly components?: { combat?: Combat };
  /** player_common.lua MakeCharacterPhysics(inst, 75, .5). */
  getPhysicsRadius?(): number;
  /** PlayerController:GetMapActions' workaround flags, read by pointspecialactionsfn. */
  checkingmapactions?: boolean;
  checkingmapactions_pos?: Vector3;
};

/**
 * playercontroller.lua for the actions whose actions.lua fn is ported (equipped, point and scene actions): a mouse click takes the picker's action for
 * that button, wraps it in a BufferedAction for the player and DoAction hands it to locomotor:PushAction, which
 * walks to the target and buffers it on the stategraph. The stategraph's ActionHandler chooses the state and its
 * hit frame runs ACTIONS[action].fn. The player has one buffered action: a new one, another click, movement input,
 * Escape or a change of the hand item drops it. CONTROL_ATTACK (F) runs DoAttackButton; instant actions such as REEL
 * are done at once.
 */
export class PlayerController {
  private readonly world: ActionWorldContext;
  private readonly stategraph: WilsonStateGraph;
  private readonly locomotor: PlayerLocomotor;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly isManualMovement: () => boolean;
  private readonly picker: PlayerActionPicker;
  private readonly ownsPicker: boolean;
  private readonly doer: PlayerDoer;
  /** CONTROL_ATTACK held: attacks repeat after each one; CONTROL_FORCE_ATTACK (Ctrl) allows non-hostile targets. */
  private attackHeld = false;
  private forceAttack = false;
  private readonly cleanups: (() => void)[] = [];
  /** The action this controller pushed: walked to by the locomotor, then buffered on the stategraph. */
  private action?: BufferedAction<WilsonAction>;
  private walking = false;
  private disposed = false;

  constructor(
    world: ActionWorldContext,
    stategraph: WilsonStateGraph,
    locomotor: PlayerLocomotor,
    handEquipment: HandEquipmentSignal,
    /** The player inst as act.doer: actions reach its tags, events, position, stategraph and components. */
    doer: PlayerDoer,
    isManualMovement = () => false,
  ) {
    this.world = world;
    this.stategraph = stategraph;
    this.locomotor = locomotor;
    this.handEquipment = handEquipment;
    this.isManualMovement = isManualMovement;
    this.ownsPicker = !world.mouseActions;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.doer = doer;
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
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
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
    const pos = description.pos;
    if (!hasActionFn(description.action) || (target ? !target.getPosition : !pos)) return undefined;
    const invobject = description.invobject as (BufferedActionObject & { isRemoved?: boolean }) | undefined;
    const inventory = this.doer.components?.inventory;
    const equipped = invobject !== undefined && invobject === this.equippedItem();
    const heldTarget = target !== undefined && inventory?.CanAccessItem?.(target as ItemEntity) === true;
    // An inventory action keeps the actual inst, including when it moves between accessible slots.
    const validfn = () => (invobject === undefined || (equipped ? invobject === this.equippedItem()
      : inventory?.CanAccessItem?.(invobject as ItemEntity) === true))
      && (!heldTarget || inventory?.CanAccessItem?.(target as ItemEntity) === true);
    return createBufferedAction(description.action as WilsonAction,
      { doer: this.doer, target, invobject, ...(pos ? { pos: { x: pos.x, y: pos.y, z: pos.z } } : {}) }, validfn);
  }

  /** playercontroller.lua GetItemUseAction: try the active item's RMB actions, then its LMB actions. */
  GetItemUseAction(item: ItemEntity, target: ItemEntity): BufferedAction<WilsonAction> | undefined {
    const picked = this.picker.GetUseItemActions(target, item, true)[0]
      ?? this.picker.GetUseItemActions(target, item, false)[0];
    return picked && this.createAction(picked);
  }

  /** BufferedAction:GetActionPoint: the target's position, else the action's pos. */
  private actionPoint(action: BufferedAction<WilsonAction>): Vector3 {
    const target = action.target as Partial<ActionTargetEntity> | undefined;
    if (target?.getPosition) {
      // locomotor.lua Dest(target) follows inventoryitem's owner, while the action retains the target inst.
      const owner = (target as ComponentActionEntity).components?.inventoryitem?.owner as { getPosition?(): Vector3 } | undefined;
      return owner?.getPosition?.() ?? target.getPosition();
    }
    const pos = action.pos!;
    return new Vector3(pos.x, pos.y, pos.z);
  }

  /** PlayerController:DoAction: locomotor:PushAction walks to the target and the inst buffers the action there. */
  DoAction(action: BufferedAction<WilsonAction>): boolean {
    const { stategraph } = this;
    const target = action.target as Partial<ActionTargetEntity> | undefined;
    if (this.disposed || (target ? !target.getPosition : !action.pos) || stategraph.hasStateTag('busy')
      || isHandActionBusy(stategraph) || !action.isValid()) return false;
    const { distance, mindistance, instant, arrive_anywhere } = (ACTIONS[action.action as MouseActionId] ?? {}) as
      { distance?: number; mindistance?: number; instant?: boolean; arrive_anywhere?: boolean };
    // EntityScript:PushBufferedAction for an instant action: face the target and do it now, keeping the
    // buffered action and the state it runs in.
    if (instant) {
      prefabInstance(this.world.player)?.sprite.facePoint(this.world.player.position, this.actionPoint(action));
      return action.do();
    }
    // A repeated attack replaces the last through the stategraph's ATTACK handler; anything else ends it first.
    this.cancel(action.action === 'ATTACK' && this.action?.action === 'ATTACK');
    this.world.actionEvents?.emit('action:begin', { owner: this, action: action.action as PlayerActionKind });
    this.stategraph.cancelEmote();
    this.action = action;
    this.walking = true;
    const combat = this.doer.components?.combat;
    this.locomotor.PushAction({
      target: { getPosition: () => this.actionPoint(action), getPhysicsRadius: () => target?.getPhysicsRadius?.() ?? 0 },
      ...(distance === undefined ? {} : { distance: distance * WORLD_SCALE }),
      ...(mindistance === undefined ? {} : { minDistance: mindistance * WORLD_SCALE }),
      // locomotor OnUpdate for ATTACK: combat:LocomotorCanAttack, inside the attack range of the target's edge.
      ...(action.action === 'ATTACK' && combat && target ? { arrived: () => this.doer.getPosition!()
        .distanceToSquared(target.getPosition!()) <= combat.CalcAttackRangeSq(target as unknown as CombatInst) } : {}),
      // customarrivecheck = ArriveAnywhere.
      ...(arrive_anywhere ? { arrived: () => true } : {}),
      isValid: () => action.isValid(),
    }, () => this.arrive(action), () => {
      if (this.action !== action || !this.walking) return;
      this.walking = false;
      this.action = undefined;
    });
    return true;
  }

  /**
   * PlayerController:OnMapAction for a right click on the map: GetMapActions takes the right-click point special
   * action at the player with checkingmapactions set, RemapMapAction turns it into its _MAP action at the clicked
   * position (ACTIONS_MAP_REMAP), and locomotor:PushAction runs it.
   */
  OnMapAction(position: Vector3): boolean {
    const picker = this.world.mouseActions;
    if (this.disposed || !picker) return false;
    this.doer.checkingmapactions = true;
    this.doer.checkingmapactions_pos = position;
    let rmb: string | undefined;
    try { rmb = picker.GetPointSpecialActions(this.world.player.position, true)[0]; }
    finally { this.doer.checkingmapactions = undefined; this.doer.checkingmapactions_pos = undefined; }
    const mapAction = rmb && `${rmb}_MAP`;
    if (!mapAction || !(mapAction in ACTIONS)) return false;
    const action = this.createAction({ action: mapAction as MouseActionId, pos: position.clone() });
    return !!action && this.DoAction(action);
  }

  /** locomotor OnUpdate at the destination: FaceMovePoint, then inst:PushBufferedAction. */
  private arrive(action: BufferedAction<WilsonAction>): void {
    if (this.action !== action) return;
    this.walking = false;
    prefabInstance(this.world.player)?.sprite.facePoint(this.world.player.position, this.actionPoint(action));
    if (!this.stategraph.pushBufferedAction(action)) this.action = undefined;
  }

  /** playercontroller.lua GetAttackTarget: the nearest valid combat target in reach, none while already attacking. */
  getAttackTarget(forceAttack: boolean): ActionTargetEntity | undefined {
    const combat = this.doer.components?.combat, position = this.doer.getPosition?.();
    if (!combat || !position || this.stategraph.hasStateTag('attack')) return undefined;
    // Autowalking searches 6 extra units; direct (WASD) walking only reaches attack range.
    const rad = this.isManualMovement() ? combat.GetAttackRange() : combat.GetAttackRange() + 6 * WORLD_SCALE;
    const reach = (this.doer.getPhysicsRadius?.() ?? 0) + rad + .1 * WORLD_SCALE;
    let nearest: ActionTargetEntity | undefined, nearestDistance = Infinity;
    // TheSim:FindEntities around the doer for "_combat" insts, excluding INLIMBO.
    for (const entity of FindEntities(position, reach + 5 * WORLD_SCALE, [], ['INLIMBO'])) {
      const target = entity as unknown as ActionTargetEntity;
      if (!(entity.components as { combat?: unknown }).combat || !this.isValidAttackTarget(target, forceAttack)) continue;
      const radius = target.getPhysicsRadius?.() ?? 0;
      const dsq = target.getPosition().distanceToSquared(position);
      if (dsq > (reach + radius) ** 2) continue;
      const distance = Math.max(0, Math.sqrt(dsq) - radius);
      if (distance < nearestDistance) { nearestDistance = distance; nearest = target; }
    }
    return nearest;
  }

  /** ValidateAttackTarget for the ported cases: a lightable target, or a combat target that is hostile or forced. */
  private isValidAttackTarget(target: ActionTargetEntity, forceAttack: boolean): boolean {
    const combat = this.doer.components?.combat, inst = target as unknown as CombatInst;
    if (!combat || target.isRemoved || target.hasTag('stealth')) return false;
    return combat.CanLightTarget(inst) || (combat.CanTarget(inst) && (forceAttack || target.hasTag('hostile')));
  }

  /** playercontroller.lua DoAttackButton: ATTACK the attack target with the hand item as invobject. */
  DoAttackButton(forceAttack = this.forceAttack): boolean {
    const target = this.getAttackTarget(forceAttack);
    if (!target) return false;
    if (this.action?.action === 'ATTACK' && this.action.target === target && this.walking) return true;
    const invobject = this.equippedItem();
    const action = createBufferedAction('ATTACK' as WilsonAction, { doer: this.doer, target, invobject },
      () => invobject === undefined || invobject === this.equippedItem());
    return this.DoAction(action);
  }

  /** locomotor:Clear and inst:ClearBufferedAction for this controller's action; `keepState` leaves its state running. */
  cancel(keepState = false): void {
    const action = this.action;
    if (!action) return;
    this.action = undefined;
    if (this.walking) { this.walking = false; this.locomotor.stop(); }
    const { stategraph } = this;
    if (!keepState && stategraph.isActionActive(action)) stategraph.cancelAction(action.action);
  }

  update(): void {
    if (this.action && this.isManualMovement()) this.cancel();
    // A held attack key repeats DoAttackButton once the last attack has let go of its target.
    if (this.attackHeld && !this.walking) this.DoAttackButton();
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancel();
    this.disposed = true;
    this.cleanups.splice(0).forEach(stop => stop());
    if (this.ownsPicker) this.picker.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
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
    if (isTextInput(event)) return;
    this.forceAttack = event.ctrlKey;
    if (event.code === 'Escape') { this.attackHeld = false; this.cancel(); return; }
    if (event.code !== 'KeyF') return;
    // Ctrl+F is the browser's find shortcut; the game owns it as force attack.
    if (event.ctrlKey) event.preventDefault();
    if (event.repeat) return;
    this.attackHeld = true;
    this.DoAttackButton(event.ctrlKey);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.forceAttack = event.ctrlKey;
    if (event.code === 'KeyF') this.attackHeld = false;
  };

  private readonly handleBlur = (): void => { this.attackHeld = false; this.forceAttack = false; };
}

function isTextInput(event: KeyboardEvent): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  return event.composedPath().some(target => target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable));
}
