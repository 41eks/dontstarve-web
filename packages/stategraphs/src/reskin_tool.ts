import { PlayerActionPicker } from './playeractionpicker.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { WILSON_ACTION_TIMES } from './SGwilson.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import { collectEquippedActions, equippedActionEntity, type ComponentActionEntity } from './componentactions.ts';
import type { SpellCastDoer, SpellTarget } from '../../componets/src/spellcaster';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
export interface PreparedReskin {
  /** Commit the prepared appearance only if its source entity is still valid. */
  apply(): boolean;
  dispose(): void;
}

export interface ReskinTarget extends SpellTarget {
  readonly id: string;
  readonly prefabId: string;
  readonly model: THREE.Group;
  readonly position: THREE.Vector3;
  readonly skinId?: string;
  readonly skins: readonly string[];
  readonly reskinToolCannotTargetThis?: boolean;
  readonly preparedReskin?: PreparedReskin;
  isValid(): boolean;
  prepareNextSkin(tool?: ComponentActionEntity): Promise<PreparedReskin>;
}

export interface ReskinEffectPresenter {
  prepare(toolSkinId?: string): Promise<void>;
  spawn(target: Pick<ReskinTarget, 'position' | 'prefabId'>, toolSkinId?: string): void;
}

export const RESKIN_CAST_TIME = WILSON_ACTION_TIMES.reskin;
export const RESKIN_REACH = 60; // CASTSPELL range 20, scaled by 3 world units.

export class ReskinActionController {
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'stop' | 'goToPoint' | 'destination'>;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly stopEquipment: () => void;
  private readonly stopActionEvents: () => void;
  private readonly getTargets: (model?: THREE.Object3D) => readonly ReskinTarget[];
  private readonly effects: ReskinEffectPresenter;
  private readonly isManualMovement: () => boolean;
  private readonly onError: (error: unknown) => void;
  private readonly pointer: PointerRaycaster;
  private readonly picker: PlayerActionPicker;
  private readonly unregisterHover: () => void;
  private version = 0;
  private pending?: { target: ReskinTarget; prepared?: PreparedReskin; skinId?: string; started: boolean };
  private loading = false;
  private readonly doer: SpellCastDoer;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'stop' | 'goToPoint' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    getTargets: (model?: THREE.Object3D) => readonly ReskinTarget[],
    effects: ReskinEffectPresenter,
    isManualMovement = () => false,
    onError: (error: unknown) => void = console.error,
  ) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.handEquipment = handEquipment; this.getTargets = getTargets; this.effects = effects;
    this.doer = { position: world.player.position, components: {}, hasTag: tag => world.player.userData.tags?.includes(tag) ?? false };
    this.stopEquipment = bindHandEquipmentUpdate(handEquipment, {
      isEquipped: equipment => this.isEquipped(equipment),
      cancel: () => this.cancel(),
      update: dt => this.update(dt),
      registerFrameTask: world.registerFrameTask,
    });
    this.isManualMovement = isManualMovement; this.onError = onError;
    this.stopActionEvents = bindActionCancellation(world, this, 'hand', () => this.cancel());
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.picker = world.mouseActions ?? new PlayerActionPicker(this.pointer);
    // Equipped actions are computed only for the selected entity.
    this.unregisterHover = this.picker.register(model => !model || !this.getTool() ? [] :
      this.getTargets(model).filter(target => target.isValid()).map(target => ({
        action: { action: 'CASTSPELL', modifier: 'RESKIN', invobject: equippedActionEntity(this.getTool()) },
        button: 'right', model: target.model,
        available: collectEquippedActions(equippedActionEntity(this.getTool()), target, true).includes('CASTSPELL'), source: 'equipped',
      }))) ?? (() => {});
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  async request(target: ReskinTarget): Promise<boolean> {
    const tool = this.getTool();
    if (!tool || !this.canSelect(target) || this.loading || this.animation.isReskinning) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'CASTSPELL' });
    const version = this.version;
    this.animation.cancelEmote();
    this.loading = true;
    let prepared: PreparedReskin | undefined;
    try {
      // allSettled also releases a prepared target when effect preparation fails.
      // Selection is tag-based; CanCast belongs to actions.lua at the hit frame.
      // Prepare render assets only when this target can currently change appearance.
      const results = await Promise.allSettled([
        this.canCast(target) ? target.prepareNextSkin(equippedActionEntity(tool)) : Promise.resolve(undefined),
        this.effects.prepare(tool.skinId),
      ]);
      if (results[0].status === 'fulfilled') prepared = results[0].value;
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      if (version !== this.version || this.getTool()?.entity !== tool.entity || this.getTool()?.skinId !== tool.skinId || !this.canSelect(target)) return false;
      this.pending = { target, prepared, skinId: tool.skinId, started: false };
      prepared = undefined;
      return true;
    } catch (error) { if (version === this.version) this.onError(error); return false; }
    finally { prepared?.dispose(); if (version === this.version) this.loading = false; }
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const entity = equippedActionEntity(equipment);
    return !!entity?.components.spellcaster && entity.hasTag('veryquickcast') && entity.hasTag('castontargets');
  }

  private getTool() {
    const equipment = this.handEquipment.peek();
    return this.isEquipped(equipment) ? equipment : undefined;
  }

  private canCast(target: ReskinTarget): boolean {
    const tool = equippedActionEntity(this.getTool());
    return target.isValid() && collectEquippedActions(tool, target, true).includes('CASTSPELL')
      && (tool?.components.spellcaster?.canCast(this.doer, target, target.position) ?? false);
  }

  private canSelect(target: ReskinTarget): boolean {
    return target.isValid() && collectEquippedActions(equippedActionEntity(this.getTool()), target, true).includes('CASTSPELL');
  }

  cancel(): void {
    this.version++;
    if (this.pending) this.locomotor.stop();
    this.pending?.prepared?.dispose();
    this.pending = undefined;
    this.loading = false;
    this.animation.cancelReskin();
  }

  update(_dt: number): void {
    if (!this.getTool() || this.isManualMovement()) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending) return;
    if (!this.canSelect(pending.target) || this.getTool()!.skinId !== pending.skinId) { this.cancel(); return; }
    if (pending.started) {
      if (!this.animation.isReskinning) this.cancel();
      return;
    }
    const { target } = pending;
    if (this.distanceSquared(target.position) > RESKIN_REACH ** 2) {
      const direction = this.world.player.position.clone().sub(target.position).setY(0).normalize();
      const destination = target.position.clone().addScaledVector(direction, RESKIN_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target.position);
    const version = this.version;
    pending.started = this.animation.playReskin(() => {
      if (version !== this.version || !this.canSelect(target) || !this.getTool()
        || this.getTool()!.skinId !== pending.skinId || this.distanceSquared(target.position) > RESKIN_REACH ** 2) {
        this.cancel(); return;
      }
      const castTarget = Object.assign(Object.create(target) as ReskinTarget, { preparedReskin: pending.prepared });
      if (equippedActionEntity(this.getTool())?.components.spellcaster?.castSpell(castTarget, target.position, this.doer)) {
        this.effects.spawn(target, pending.skinId);
      }
      pending.prepared?.dispose();
      this.pending = undefined;
    });
    if (!pending.started) this.cancel();
  }

  dispose(): void {
    this.stopActionEvents();
    this.stopEquipment();
    this.cancel();
    this.unregisterHover();
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(point: THREE.Vector3): number {
    return (this.world.player.position.x - point.x) ** 2 + (this.world.player.position.z - point.z) ** 2;
  }

  private faceTarget(point: THREE.Vector3): void {
    const direction = point.clone().sub(this.world.player.position).setY(0);
    const forward = this.world.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const f = direction.dot(forward), r = direction.dot(right);
    this.animation.setFacing(Math.abs(f) >= Math.abs(r) ? (f > 0 ? 'up' : 'down') : 'side',
      Math.abs(r) > Math.abs(f) && r < 0);
  }

  private hitTarget(event?: PointerEvent): ReskinTarget | undefined {
    const action = this.picker.getMouseActions(event).right, model = this.picker.targetModel;
    return model && action?.action === 'CASTSPELL' && action.modifier === 'RESKIN'
      ? this.getTargets(model).find(target => target.model === model && target.isValid()) : undefined;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.getTool()) return;
    this.pointer.trackPointer(event);
    const target = this.hitTarget(event);
    if (!target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    void this.request(target);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}
