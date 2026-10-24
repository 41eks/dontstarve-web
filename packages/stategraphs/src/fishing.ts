import { PlayerActionPicker } from './playeractionpicker.ts';
import { bindActionCancellation } from './actionEvents.ts';
import { bindHandEquipmentUpdate, type HandEquipmentSignal } from './handEquipment.ts';
import * as THREE from 'three';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { ActionWorldContext as WorldContext, ActionAnimationController as WilsonAnimationController, ActionLocomotor as Locomotor } from './actionContext.ts';
import { equippedActionEntity, type ComponentActionEntity } from './componentactions.ts';
import type { Fisherman, FishingRod } from '../../componets/src/fishingrod';

export const FISHING_ITEM_ID = 'fishingrod';
/** locomotor.lua arrive_dist: ARRIVE_STEP + the doer's radius + the target's radius, in DST units. */
const ARRIVE_STEP = .15;
const PLAYER_RADIUS = .5;

export interface FishingTarget {
  readonly entity: ComponentActionEntity & { getPosition(): THREE.Vector3 };
  readonly model: THREE.Group;
  readonly position: THREE.Vector3;
  /** Physics radius in scene units. */
  readonly radius: number;
  isValid(): boolean;
}

/** componentactions.lua `fishingrod`: FISH a fishable target, or REEL the one already being fished. */
export class FishingActionController {
  private readonly pointer: PointerRaycaster;
  private readonly picker: PlayerActionPicker;
  private readonly unregisterHover: () => void;
  private target?: FishingTarget;
  private activeRod?: FishingRod;
  private actionVersion = 0;
  private readonly direction = new THREE.Vector3();
  private readonly forward = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>;
  private readonly handEquipment: HandEquipmentSignal;
  private readonly stopEquipment: () => void;
  private readonly stopActionEvents: () => void;
  private readonly getTargets: (model?: THREE.Object3D) => readonly FishingTarget[];
  private readonly getRod: () => FishingRod | undefined;
  private readonly isManualMovement: () => boolean;
  private readonly fisherman: Fisherman;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'goToPoint' | 'stop' | 'destination'>,
    handEquipment: HandEquipmentSignal,
    getTargets: (model?: THREE.Object3D) => readonly FishingTarget[],
    getRod: () => FishingRod | undefined,
    isManualMovement = () => false,
  ) {
    this.world = world;
    this.animation = animation;
    this.locomotor = locomotor;
    this.handEquipment = handEquipment;
    this.getTargets = getTargets;
    this.getRod = getRod;
    this.isManualMovement = isManualMovement;
    this.fisherman = {
      PushEvent: (name, data) => animation.stategraph.pushEvent(name, data),
      getPosition: () => new THREE.Vector3(world.player.position.x, 0, world.player.position.z),
      isValid: () => true,
      hasStateTag: tag => animation.stategraph.hasStateTag(tag),
    };
    this.stopEquipment = bindHandEquipmentUpdate(handEquipment, {
      isEquipped: equipment => this.isEquipped(equipment),
      cancel: () => this.cancel(),
      update: dt => this.update(dt),
      registerFrameTask: world.registerFrameTask,
    });
    animation.bindFishing({
      waitForFish: () => this.getRod()?.WaitForFish(),
      collect: () => this.getRod()?.Collect(),
      loseRod: () => {
        const rod = this.getRod();
        rod?.Release();
        (this.handEquipment.peek()?.entity as { remove?(): boolean } | undefined)?.remove?.();
      },
    });
    this.stopActionEvents = bindActionCancellation(world, this, 'fishing', () => this.cancel());
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.picker = world.mouseActions ?? new PlayerActionPicker(this.pointer);
    this.unregisterHover = this.picker.register(model => this.hoverCandidates(model)) ?? (() => {});
    // Capture so a fishing click cannot open a container or place a building.
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  private isEquipped(equipment = this.handEquipment.peek()): boolean {
    const entity = equippedActionEntity(equipment);
    return entity?.prefab === FISHING_ITEM_ID && !entity.isRemoved;
  }

  /** The REEL action string: REEL with a hooked fish, HOOK (generic) while one bites, else CANCEL. */
  private reelModifier(rod: FishingRod): string | undefined {
    return rod.HasHookedFish() ? 'REEL' : rod.FishIsBiting() ? undefined : 'CANCEL';
  }

  private isFishingAt(rod: FishingRod | undefined, target: FishingTarget): boolean {
    return rod?.target === target.entity && this.animation.isFishing && this.animation.stategraph.hasStateTag('fishing');
  }

  private hoverCandidates(model?: THREE.Object3D) {
    const rod = this.isEquipped() ? this.getRod() : undefined;
    if (!rod || !model) return [];
    const invobject = equippedActionEntity(this.handEquipment.peek());
    return this.getTargets(model).filter(target => target.isValid() && target.entity.hasTag('fishable')).map(target => {
      const reel = this.isFishingAt(rod, target);
      return {
        action: { action: reel ? 'REEL' : 'FISH', invobject, target: target.entity, modifier: reel ? this.reelModifier(rod) ?? 'GENERIC' : undefined },
        button: 'left' as const, model: target.model, available: !rod.HasCaughtFish(), source: 'equipped' as const,
      };
    });
  }

  request(target: FishingTarget): boolean {
    const rod = this.isEquipped() ? this.getRod() : undefined;
    if (!rod || !target.isValid() || !target.entity.hasTag('fishable') || rod.HasCaughtFish()
      || this.animation.stategraph.hasStateTag('busy') || this.animation.isCasting || this.animation.isNetting) return false;
    // actions.lua REEL (instant): hook a biting fish, reel a hooked one, or stop fishing.
    if (this.isFishingAt(rod, target)) {
      if (rod.IsFishing()) {
        if (rod.HasHookedFish()) rod.Reel();
        else if (rod.FishIsBiting()) rod.Hook();
        else rod.StopFishing();
      }
      return true;
    }
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'FISH' });
    this.animation.cancelEmote();
    this.target = target;
    return true;
  }

  cancel(): void {
    this.actionVersion++;
    if (this.target) this.locomotor.stop();
    this.target = undefined;
    this.activeRod?.StopFishing();
    this.activeRod = undefined;
    this.animation.cancelFishing();
  }

  update(_dt: number): void {
    if (!this.isEquipped()) { this.cancel(); return; }
    const rod = this.getRod();
    if (!rod) { this.cancel(); return; }
    rod.OnUpdate();
    if (!rod.IsFishing()) this.activeRod = undefined;
    if (this.isManualMovement()) { this.cancel(); return; }
    if (!this.target) return;
    const target = this.target;
    if (!target.isValid() || !target.entity.hasTag('fishable')) { this.cancel(); return; }
    const reach = target.radius + (ARRIVE_STEP + PLAYER_RADIUS) * (target.radius / 1.95);
    if (this.world.player.position.distanceToSquared(target.position) > reach ** 2) {
      // Stop at the pond's edge, on the player's side.
      const destination = target.position.clone();
      this.direction.subVectors(this.world.player.position, target.position).normalize();
      destination.addScaledVector(this.direction, reach * .9);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target);
    const version = this.actionVersion;
    if (this.animation.playFish(() => {
      // actions.lua FISH: the rod begins fishing the target once the cast lands.
      if (version !== this.actionVersion || !this.isEquipped() || !target.isValid()) return;
      this.activeRod = rod;
      rod.StartFishing(target.entity as never, this.fisherman);
    })) this.target = undefined;
  }

  dispose(): void {
    this.stopActionEvents();
    this.stopEquipment();
    this.cancel();
    this.animation.bindFishing(undefined);
    this.unregisterHover();
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private faceTarget(target: FishingTarget): void {
    this.direction.subVectors(target.position, this.world.player.position);
    if (this.direction.lengthSq() < 1e-8) return;
    this.world.camera.getWorldDirection(this.forward);
    this.forward.setY(0).normalize();
    this.right.crossVectors(this.forward, this.up).normalize();
    const forward = this.direction.dot(this.forward);
    const side = this.direction.dot(this.right);
    this.animation.setFacing(Math.abs(forward) >= Math.abs(side) ? (forward > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(forward) && side < 0);
  }

  private hitTarget(event?: PointerEvent): FishingTarget | undefined {
    const action = this.picker.getMouseActions(event).left, model = this.picker.targetModel;
    return model && (action?.action === 'FISH' || action?.action === 'REEL')
      ? this.getTargets(model).find(target => target.model === model && target.isValid()) : undefined;
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented || event.button !== 0 || !this.isEquipped()) return;
    this.pointer.trackPointer(event);
    const target = this.hitTarget(event);
    // A click elsewhere walks away, which ends fishing.
    if (!target) { this.cancel(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.request(target);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}
