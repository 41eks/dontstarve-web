import { prefabInstance } from '../../prefab/src/prefabInstance';
import * as THREE from 'three';
import { bindActionCancellation } from './actionEvents.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import type { HandEquipmentSignal } from './handEquipment.ts';
import { equippedActionEntity } from './componentactions.ts';
import { PlayerActionPicker, type MouseActionCandidate } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { BufferedActionObject } from './bufferedaction.ts';
import type { Combat, CombatInst, CombatActor } from '../../componets/src/combat';

/** A placed or world inst with combat and health. */
export interface AttackTarget {
  readonly id: string;
  readonly model: THREE.Group;
  readonly inst: CombatInst & { readonly prefab?: string };
  isValid(): boolean;
}

export interface Attacker {
  readonly inst: CombatActor;
  readonly combat: Combat;
}

/**
 * playercontroller.lua DoAttackButton / GetAttackTarget on CONTROL_ATTACK (F), with
 * CONTROL_FORCE_ATTACK (Ctrl) for targets that are not hostile, such as walls.
 * Holding the key repeats the attack after each one finishes.
 */
export class AttackActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private target?: AttackTarget;
  private held = false;
  private forceAttack = false;
  private version = 0;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly stopActionEvents: () => void;
  private readonly stopFrame: () => void;
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly attacker: Attacker;
  private readonly getTargets: () => readonly AttackTarget[];
  private readonly isDirectWalking: () => boolean;
  /** DST distance unit in world units. */
  private readonly unit: number;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    attacker: Attacker,
    getTargets: () => readonly AttackTarget[],
    isDirectWalking = () => false,
    unit = 1,
  ) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.handEquipment = handEquipment; this.attacker = attacker; this.getTargets = getTargets;
    this.isDirectWalking = isDirectWalking; this.unit = unit;
    this.stopActionEvents = bindActionCancellation(world, this, 'attack', () => this.cancel());
    this.stopFrame = world.registerFrameTask?.(() => this.update()) ?? (() => {});
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(model => this.getLightActions(model));
    world.renderer.domElement.addEventListener('pointerdown', this.handleLightPointerDown, true);
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
  }

  get currentTarget(): AttackTarget | undefined { return this.target; }

  /** DoAttackButton: pick a target and buffer ATTACK; the locomotor approaches it first. */
  attackButton(forceAttack = this.forceAttack): boolean {
    const target = this.getAttackTarget(forceAttack);
    if (!target) return false;
    if (this.target !== target) this.world.actionEvents?.emit('action:begin', { owner: this, action: 'ATTACK' });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  /** weapon component action: right-click a burnable with a rangedlighter weapon is ATTACK (RANGEDLIGHT). */
  private getLightActions(model?: THREE.Object3D): MouseActionCandidate[] {
    const inst = model?.userData.actionEntity as AttackTarget['inst'] | undefined;
    if (!model || !inst?.components || !(inst.components as { burnable?: unknown }).burnable) return [];
    const weapon = equippedActionEntity(this.handEquipment.peek());
    if (!weapon?.components.weapon) return [];
    return [{ action: { action: 'ATTACK', modifier: 'RANGEDLIGHT', invobject: weapon, target: this.actionTarget(inst) },
      button: 'right', source: 'equipped', model, available: this.canLight(inst) }];
  }

  private canLight(inst: AttackTarget['inst']): boolean {
    return !inst.isRemoved && !inst.hasTag('stealth') && this.attacker.combat.CanLightTarget(inst);
  }

  private actionTarget(inst: AttackTarget['inst']): BufferedActionObject {
    return { prefab: inst.prefab, hasTag: tag => inst.hasTag(tag) };
  }

  /** Right-click ATTACK on a lightable target: walk into weapon range, then launch the projectile. */
  lightTarget(model: THREE.Object3D): boolean {
    const inst = model.userData.actionEntity as AttackTarget['inst'] | undefined;
    if (!inst || !this.canLight(inst)) return false;
    if (this.target?.inst !== inst) this.world.actionEvents?.emit('action:begin', { owner: this, action: 'ATTACK' });
    this.animation.cancelEmote();
    this.target = { id: String(prefabInstance(model)?.entityId), model: model as THREE.Group, inst,
      isValid: () => !inst.isRemoved && !!model.parent };
    return true;
  }

  /** GetAttackTarget: nearest valid combat target within reach; none while already attacking. */
  getAttackTarget(forceAttack: boolean): AttackTarget | undefined {
    if (this.animation.stategraph.hasStateTag('attack')) return undefined;
    const { combat, inst } = this.attacker;
    const attackrange = combat.GetAttackRange();
    // Autowalking searches 6 extra units; direct (WASD) walking only reaches attack range.
    const rad = this.isDirectWalking() ? attackrange : attackrange + 6 * this.unit;
    const reach = inst.getPhysicsRadius() + rad + .1 * this.unit;
    const position = inst.getPosition();
    let nearest: AttackTarget | undefined, nearestDistance = Infinity;
    for (const target of this.getTargets()) {
      if (!this.isValidTarget(target, forceAttack)) continue;
      const point = target.inst.getPosition();
      const radius = target.inst.getPhysicsRadius();
      const dsq = (point.x - position.x) ** 2 + (point.z - position.z) ** 2;
      if (dsq > (reach + radius) ** 2) continue;
      const distance = Math.max(0, Math.sqrt(dsq) - radius);
      if (distance < nearestDistance) { nearestDistance = distance; nearest = target; }
    }
    return nearest;
  }

  cancel(): void {
    this.version++;
    if (this.target) this.locomotor.stop();
    this.target = undefined;
    this.animation.cancelAttack();
  }

  update(): void {
    if (this.target && this.isDirectWalking()) { this.cancel(); return; }
    // Held attacks chain once the attack state's timeout removes its "attack" tag.
    if (!this.target && this.held) this.attackButton();
    const target = this.target;
    if (!target) return;
    if (!this.isValidTarget(target, true)) { this.cancel(); return; }
    const { combat, inst } = this.attacker;
    if (this.distanceSquared(target) > combat.CalcAttackRangeSq(target.inst)) {
      // Stop inside attack range at the target's ground contact, not its billboard centre.
      const point = target.inst.getPosition();
      const destination = new THREE.Vector3(point.x, 0, point.z);
      const from = inst.getPosition();
      this.direction.set(from.x - destination.x, 0, from.z - destination.z).normalize();
      destination.addScaledVector(this.direction, target.inst.getPhysicsRadius() + combat.GetAttackRange() * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.version;
    const objects = this.actionObjects(target);
    if (this.animation.playAttack(() => version === this.version && this.isValidTarget(target, true)
      && combat.DoAttack(target.inst, this.weapon()), objects.target, objects.invobject)) this.target = undefined;
  }

  dispose(): void {
    this.cancel();
    this.stopActionEvents();
    this.stopFrame();
    this.unregister();
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handleLightPointerDown, true);
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown);
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
  }

  /** ValidateAttackTarget for the ported cases: non-hostile targets need force attack. */
  private isValidTarget(target: AttackTarget, forceAttack: boolean): boolean {
    if (!target.isValid() || target.inst.hasTag('stealth')) return false;
    // Light targets have no combat: validity is the rangedlighter test alone.
    return this.attacker.combat.CanLightTarget(target.inst)
      || this.attacker.combat.CanTarget(target.inst) && (forceAttack || target.inst.hasTag('hostile'));
  }

  private weapon() { return equippedActionEntity(this.handEquipment.peek())?.components.weapon; }

  private actionObjects(target: AttackTarget): { target: BufferedActionObject; invobject?: BufferedActionObject } {
    return {
      target: { prefab: target.inst.prefab, hasTag: tag => target.inst.hasTag(tag) },
      invobject: equippedActionEntity(this.handEquipment.peek()),
    };
  }

  private distanceSquared(target: AttackTarget): number {
    const a = this.attacker.inst.getPosition(), b = target.inst.getPosition();
    return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
  }

  private faceTarget(target: AttackTarget): void {
    const point = target.inst.getPosition();
    this.direction.set(point.x, 0, point.z).sub(this.world.player.position).setY(0);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    const forward = this.direction.dot(this.forward), side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private readonly handleLightPointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented || event.button !== 2) return;
    this.picker.pointer.trackPointer(event);
    const action = this.picker.getMouseActions(event).right;
    const model = this.picker.targetModel;
    if (action?.action !== 'ATTACK' || action.modifier !== 'RANGEDLIGHT' || !model) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.lightTarget(model);
  };

  private readonly handlePointerDown = (event: PointerEvent): void => {
    // A new mouse action replaces the pending attack approach.
    if (!event.defaultPrevented && (event.button === 0 || event.button === 2) && this.target) this.cancel();
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (isTextInput(event)) return;
    this.forceAttack = event.ctrlKey;
    if (event.code === 'Escape') { this.held = false; this.cancel(); return; }
    if (event.code !== 'KeyF') return;
    // Ctrl+F is the browser's find shortcut; the game owns it as force attack.
    if (event.ctrlKey) event.preventDefault();
    if (event.repeat) return;
    this.held = true;
    this.attackButton(event.ctrlKey);
  };

  private readonly handleKeyUp = (event: KeyboardEvent): void => {
    this.forceAttack = event.ctrlKey;
    if (event.code === 'KeyF') this.held = false;
  };

  private readonly handleBlur = (): void => { this.held = false; this.forceAttack = false; };
}

function isTextInput(event: KeyboardEvent): boolean {
  if (typeof HTMLElement === 'undefined') return false;
  return event.composedPath().some(target => target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement || (target instanceof HTMLElement && target.isContentEditable));
}
