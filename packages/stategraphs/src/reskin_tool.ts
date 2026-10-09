import { WILSON_ACTION_TIMES } from './SGwilson.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { watchHandEquipment, type HandEquipmentSignal } from './handEquipment.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
export interface PreparedReskin {
  /** Commit the prepared appearance only if its source entity is still valid. */
  apply(): boolean;
  dispose(): void;
}

export interface ReskinTarget {
  readonly id: string;
  readonly prefabId: string;
  readonly model: THREE.Group;
  readonly position: THREE.Vector3;
  isValid(): boolean;
  prepareNextSkin(): Promise<PreparedReskin>;
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
  private readonly getTargets: () => readonly ReskinTarget[];
  private readonly effects: ReskinEffectPresenter;
  private readonly isManualMovement: () => boolean;
  private readonly onRequest: () => void;
  private readonly onError: (error: unknown) => void;
  private readonly pointer: PointerRaycaster;
  private readonly unregisterHover: () => void;
  private version = 0;
  private pending?: { target: ReskinTarget; prepared: PreparedReskin; skinId?: string; started: boolean };
  private loading = false;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'stop' | 'goToPoint' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    getTargets: () => readonly ReskinTarget[],
    effects: ReskinEffectPresenter,
    isManualMovement = () => false,
    onRequest = () => {},
    onError: (error: unknown) => void = console.error,
  ) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.handEquipment = handEquipment; this.getTargets = getTargets; this.effects = effects;
    this.stopEquipment = watchHandEquipment(handEquipment, (_equipment, previous) => {
      if (previous?.itemId === 'reskin_tool') this.cancel();
    });
    this.isManualMovement = isManualMovement; this.onRequest = onRequest; this.onError = onError;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.unregisterHover = world.mouseActions?.register(() =>
      this.getTargets().filter(target => target.isValid()).map(target => ({
        action: { action: 'CASTSPELL', modifier: 'RESKIN' }, button: 'right', model: target.model, available: !!this.getTool(),
      }))) ?? (() => {});
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  async request(target: ReskinTarget): Promise<boolean> {
    const tool = this.getTool();
    if (!tool || !target.isValid() || this.loading || this.animation.isReskinning) return false;
    this.cancel();
    const version = this.version;
    this.onRequest();
    this.animation.cancelEmote();
    this.loading = true;
    let prepared: PreparedReskin | undefined;
    try {
      // allSettled also releases a prepared target when effect preparation fails.
      const results = await Promise.allSettled([target.prepareNextSkin(), this.effects.prepare(tool.skinId)]);
      if (results[0].status === 'fulfilled') prepared = results[0].value;
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      if (version !== this.version || !this.getTool() || this.getTool()!.skinId !== tool.skinId || !target.isValid()) return false;
      this.pending = { target, prepared: prepared!, skinId: tool.skinId, started: false };
      prepared = undefined;
      return true;
    } catch (error) { if (version === this.version) this.onError(error); return false; }
    finally { prepared?.dispose(); if (version === this.version) this.loading = false; }
  }

  private getTool() {
    const equipment = this.handEquipment.peek();
    return equipment?.itemId === 'reskin_tool' ? equipment : undefined;
  }

  cancel(): void {
    this.version++;
    if (this.pending) this.locomotor.stop();
    this.pending?.prepared.dispose();
    this.pending = undefined;
    this.loading = false;
    this.animation.cancelReskin();
  }

  update(_dt: number): void {
    if (!this.getTool() || this.isManualMovement()) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending) return;
    if (!pending.target.isValid() || this.getTool()!.skinId !== pending.skinId) { this.cancel(); return; }
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
      if (version !== this.version || !target.isValid() || !this.getTool()
        || this.getTool()!.skinId !== pending.skinId || this.distanceSquared(target.position) > RESKIN_REACH ** 2) {
        this.cancel(); return;
      }
      if (pending.prepared.apply()) this.effects.spawn(target, pending.skinId);
      pending.prepared.dispose();
      this.pending = undefined;
    });
    if (!pending.started) this.cancel();
  }

  dispose(): void {
    this.stopEquipment();
    this.cancel();
    this.unregisterHover();
    if (this.pointer !== this.world.mouseActions?.pointer) this.pointer.dispose();
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

  private hitTarget(): ReskinTarget | undefined {
    if (!this.getTool()) return undefined;
    const targets = this.getTargets().filter((target) => target.isValid());
    const hit = this.pointer.raycastPointer(targets.map((target) => target.model));
    return hit && targets.find((target) => {
      let root: THREE.Object3D | null = hit.object;
      while (root) { if (root === target.model) return true; root = root.parent; }
      return false;
    });
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.getTool()) return;
    this.pointer.trackPointer(event);
    const target = this.hitTarget();
    if (!target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    void this.request(target);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}
