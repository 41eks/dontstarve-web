import type { Signal } from '@dontstarve-web/signals';
import { prefabDisplay } from '@dontstarve-web/display';
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

/** The skin an entity's sprite json declares (inst.skinname); the reskin tool writes it as TheSim:ReskinEntity. */
export interface SkinnedSprite { readonly skinId: Signal<string | undefined> }

type ReskinActionTarget = SpellTarget & ActionTargetView & {
  readonly id: string;
  readonly prefabId: string;
  readonly position: THREE.Vector3;
  readonly skinId?: string;
  readonly skins: readonly string[];
  readonly reskinToolCannotTargetThis?: boolean;
  /** The entity's own sprite json; only an entity with one can be reskinned. */
  readonly sprite?: SkinnedSprite;
  readonly reskinFx?: ReskinFxMessage;
  isValid(): boolean;
};

export type ReskinTarget = ReskinActionTarget & Required<Pick<ReskinActionTarget, 'sprite'>>;

/**
 * reskin_tool.lua GetNextSkin: the tool's cached skin for the prefab when it differs from the current one, otherwise the
 * skin after the current one; past the last skin it returns to the base (undefined).
 */
export function nextReskin(skins: readonly string[], current?: string,
  cache?: ReadonlyMap<string, string | undefined>, prefab?: string): string | undefined {
  if (cache && prefab) {
    const cached = cache.get(prefab);
    if (cached !== current) return cached;
  }
  return skins[(current === undefined ? -1 : skins.indexOf(current)) + 1];
}

export interface ReskinEffectPresenter {
  /** Declares the FX entity without IO; its display loads the art. */
  prepare(toolSkinId?: string): ReskinFxMessage;
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
  private pending?: { target: ReskinActionTarget; fx: ReskinFxMessage; skinId?: string; started: boolean };
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
    let fx: ReskinFxMessage | undefined;
    try {
      // Selection is tag-based; CanCast belongs to actions.lua at the hit frame.
      // Preload render assets only when this target can currently change appearance.
      if (this.canCast(target)) await this.preloadNextSkin(target, equippedActionEntity(tool));
      if (version !== this.version || this.getTool()?.entity !== tool.entity || this.getTool()?.skinId !== tool.skinId || !target.isValid()) return false;
      fx = this.effects.prepare(tool.skinId);
      this.pending = { target, fx, skinId: tool.skinId, started: false };
      fx = undefined;
      return true;
    } catch (error) { if (version === this.version) this.onError(error); return false; }
    finally { fx?.dispose(); if (version === this.version) this.loading = false; }
  }

  /** The spell chooses the skin again at the hit frame; the display loads the one it would choose now, so the cast draws it at once. */
  private async preloadNextSkin(target: ReskinActionTarget, tool: ComponentActionEntity | undefined): Promise<void> {
    if (!target.sprite) return;
    const display = target.display ?? prefabDisplay(actionTargetModel(target));
    await display?.preloadSkin(nextReskin(target.skins, target.skinId, tool?._cached_reskinname, target.prefabId));
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
      const castTarget = Object.assign(Object.create(target) as ReskinActionTarget, { reskinFx: pending.fx });
      equippedActionEntity(this.getTool())?.components.spellcaster?.castSpell(castTarget, target.position, this.doer);
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
