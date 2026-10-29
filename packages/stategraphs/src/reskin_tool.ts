import { PlayerActionPicker } from './playeractionpicker.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { WILSON_ACTION_TIMES } from './SGwilson.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import { collectEquippedActions, equippedActionEntity, type ComponentActionEntity } from './componentactions.ts';
import type { SpellCastDoer, SpellTarget } from '../../componets/src/spellcaster';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import { modelHasTag } from '../../prefab/src/prefabInstance';
import { actionTargetModel, type ActionTargetView } from './actionTargetView';
import { findActionEntity } from '../../prefab/src/actionEntity';
/** Prepared logical FX message. The target places and starts it only after committing its skin. */
export interface ReskinFxMessage {
  play(position: THREE.Vector3, prefabId: string): void;
  /** Discard an unused message; a started FX keeps its own animation lifecycle. */
  dispose(): void;
}

export interface PreparedReskin {
  /** Proposed declaration, so the display can preload it before the timed cast. */
  readonly skinId?: string;
  /** Commit the prepared appearance only if its source entity is still valid. */
  apply(fx?: ReskinFxMessage): boolean;
  dispose(): void;
}

type ReskinActionTarget = SpellTarget & ActionTargetView & {
  readonly id: string;
  readonly prefabId: string;
  readonly position: THREE.Vector3;
  readonly skinId?: string;
  readonly skins: readonly string[];
  readonly reskinToolCannotTargetThis?: boolean;
  readonly preparedReskin?: PreparedReskin;
  readonly reskinFx?: ReskinFxMessage;
  isValid(): boolean;
  prepareNextSkin?(tool?: ComponentActionEntity): Promise<PreparedReskin>;
};

export type ReskinTarget = ReskinActionTarget & Required<Pick<ReskinActionTarget, 'prepareNextSkin'>>;

export interface ReskinEffectPresenter {
  prepare(toolSkinId?: string): Promise<ReskinFxMessage>;
}

/** CASTSPELL can select any action entity; an entity without a skin operation fails CanCast at impact. */
export function getReskinActionTarget(model: THREE.Object3D): ReskinActionTarget | undefined {
  const entity = findActionEntity(model);
  if (!entity) return undefined;
  return entity.reskinTarget ?? {
    id: model.uuid, prefabId: entity.prefab, model: entity.model as THREE.Group,
    get position() { return entity.getPosition(); },
    skins: [], get isRemoved() { return entity.isRemoved; },
    hasTag: tag => entity.hasTag(tag),
    isValid: () => findActionEntity(model) === entity,
    isVisible: () => model.visible,
  };
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
  private readonly effects: ReskinEffectPresenter;
  private readonly isManualMovement: () => boolean;
  private readonly onError: (error: unknown) => void;
  private readonly pointer: PointerRaycaster;
  private readonly picker: PlayerActionPicker;
  private readonly unregisterHover: () => void;
  private version = 0;
  private pending?: { target: ReskinActionTarget; prepared?: PreparedReskin; fx: ReskinFxMessage; skinId?: string; started: boolean };
  private loading = false;
  private readonly doer: SpellCastDoer;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'stop' | 'goToPoint' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    effects: ReskinEffectPresenter,
    isManualMovement = () => false,
    onError: (error: unknown) => void = console.error,
  ) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.handEquipment = handEquipment; this.effects = effects;
    this.doer = { position: world.player.position, components: {}, hasTag: tag => modelHasTag(world.player, tag) };
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
    this.unregisterHover = this.picker.register(model => {
      const tool = model && equippedActionEntity(this.getTool());
      const target = model && getReskinActionTarget(model);
      // playeractionpicker.lua GetEquippedItemActions: the only place that selects CASTSPELL for a target.
      return !tool || !target?.isValid() ? [] : [{
        action: { action: 'CASTSPELL', modifier: 'RESKIN', invobject: tool },
        button: 'right', model: actionTargetModel(target),
        available: collectEquippedActions(tool, target, true).includes('CASTSPELL'), source: 'equipped',
      }];
    }) ?? (() => {});
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  async request(target: ReskinActionTarget): Promise<boolean> {
    const tool = this.getTool();
    if (!tool || !target.isValid() || this.loading || this.animation.isReskinning) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'CASTSPELL' });
    const version = this.version;
    this.animation.cancelEmote();
    this.loading = true;
    let prepared: PreparedReskin | undefined;
    let fx: ReskinFxMessage | undefined;
    try {
      // allSettled also releases a prepared target when effect preparation fails.
      // Selection is tag-based; CanCast belongs to actions.lua at the hit frame.
      // Prepare render assets only when this target can currently change appearance.
      const results = await Promise.allSettled([
        this.canCast(target) ? this.prepareSkin(target, equippedActionEntity(tool)) : undefined,
        this.effects.prepare(tool.skinId),
      ]);
      if (results[0].status === 'fulfilled') prepared = results[0].value;
      if (results[1].status === 'fulfilled') fx = results[1].value;
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      if (version !== this.version || this.getTool()?.entity !== tool.entity || this.getTool()?.skinId !== tool.skinId || !target.isValid()) return false;
      this.pending = { target, prepared, fx: fx!, skinId: tool.skinId, started: false };
      prepared = undefined;
      fx = undefined;
      return true;
    } catch (error) { if (version === this.version) this.onError(error); return false; }
    finally { prepared?.dispose(); fx?.dispose(); if (version === this.version) this.loading = false; }
  }

  private async prepareSkin(target: ReskinActionTarget, tool: ComponentActionEntity | undefined): Promise<PreparedReskin | undefined> {
    const prepared = await target.prepareNextSkin?.(tool);
    try {
      const display = target.display ?? actionTargetModel(target).userData.display;
      if (prepared && 'skinId' in prepared) await display?.preloadSkin(prepared.skinId);
      return prepared;
    } catch (error) { prepared?.dispose(); throw error; }
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const entity = equippedActionEntity(equipment);
    return !!entity?.components.spellcaster && entity.hasTag('veryquickcast') && entity.hasTag('castontargets');
  }

  private getTool() {
    const equipment = this.handEquipment.peek();
    return this.isEquipped(equipment) ? equipment : undefined;
  }

  /** Asset preparation only; actions.lua CASTSPELL.fn checks CanCast again through castSpell at the hit frame. */
  private canCast(target: ReskinActionTarget): boolean {
    return equippedActionEntity(this.getTool())?.components.spellcaster?.canCast(this.doer, target, target.position) ?? false;
  }

  cancel(): void {
    this.version++;
    if (this.pending) this.locomotor.stop();
    this.pending?.prepared?.dispose();
    this.pending?.fx.dispose();
    this.pending = undefined;
    this.loading = false;
    this.animation.cancelReskin();
  }

  update(_dt: number): void {
    if (!this.getTool() || this.isManualMovement()) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending) return;
    // bufferedaction.lua IsValid: keep the picked action while its target stays valid, without recollecting actions.
    if (!pending.target.isValid() || this.getTool()!.skinId !== pending.skinId) { this.cancel(); return; }
    if (pending.started) {
      if (!this.animation.isReskinning) this.cancel();
      return;
    }
    const { target } = pending;
    if (this.distanceSquared(target.position) > RESKIN_REACH ** 2) {
      const direction = this.world.player.position.clone().sub(target.position).normalize();
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
      if (version !== this.version || !target.isValid() || !this.getTool()
        || this.getTool()!.skinId !== pending.skinId || this.distanceSquared(target.position) > RESKIN_REACH ** 2) {
        this.cancel(); return;
      }
      const castTarget = Object.assign(Object.create(target) as ReskinActionTarget, { preparedReskin: pending.prepared, reskinFx: pending.fx });
      equippedActionEntity(this.getTool())?.components.spellcaster?.castSpell(castTarget, target.position, this.doer);
      pending.prepared?.dispose();
      pending.fx.dispose();
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
    return this.world.player.position.distanceToSquared(point);
  }

  private faceTarget(point: THREE.Vector3): void {
    const direction = point.clone().sub(this.world.player.position);
    const forward = this.world.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const f = direction.dot(forward), r = direction.dot(right);
    this.animation.setFacing(Math.abs(f) >= Math.abs(r) ? (f > 0 ? 'up' : 'down') : 'side',
      Math.abs(r) > Math.abs(f) && r < 0);
  }

  /** playercontroller.lua OnRightClick uses the picked action as is; only resolve its target record. */
  private hitTarget(event?: PointerEvent): ReskinActionTarget | undefined {
    const action = this.picker.getMouseActions(event).right, model = this.picker.targetModel;
    return model && action?.action === 'CASTSPELL' && action.modifier === 'RESKIN' ? getReskinActionTarget(model) : undefined;
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
