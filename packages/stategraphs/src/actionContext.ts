import type * as THREE from 'three';
import type { WilsonStateGraph } from './SGwilson.ts';
import type { PointerRaycaster } from './pointerRaycaster.ts';
import type { PlayerActionPicker } from './playeractionpicker.ts';
import type { EventEmitter } from '../../signals/src/EventEmitter.ts';
import type { PlayerActionEvents } from './actionEvents.ts';

/** Services supplied by the application and prefab implementations to actions. */
export interface CursorLabel {
  show(text: string, button?: 'left' | 'right'): void;
  hide(): void;
  update(): void;
}

export interface ActionWorldContext {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  ground: THREE.Object3D;
  player: THREE.Object3D;
  mouseActions?: PlayerActionPicker;
  actionEvents?: EventEmitter<PlayerActionEvents>;
  createCursorLabel?: (pointer: PointerRaycaster) => CursorLabel;
  /** Register an action update in the host's pre-physics phase; return its removal callback. */
  registerFrameTask?: (update: (dt: number) => void) => () => void;
}

export interface ActionLocomotor {
  readonly destination: THREE.Vector3 | undefined;
  goToPoint(point: THREE.Vector3): boolean;
  stop(): void;
}

export interface ActionAnimationController {
  readonly stategraph: WilsonStateGraph;
  readonly isReskinning: boolean;
  playReskin(onCast: () => void): boolean;
  cancelReskin(): void;
  readonly isCasting: boolean;
  readonly isNetting: boolean;
  readonly isMining: boolean;
  playMine(onHit: () => void): boolean;
  cancelMine(): void;
  readonly isHammering: boolean;
  playHammer(onHit: () => void): boolean;
  cancelHammer(): void;
  readonly isDigging: boolean;
  playDig(onDig: () => void): boolean;
  cancelDig(): void;
  playShovelDig(onDig: () => boolean): boolean;
  cancelShovelDig(): void;
  readonly isShoveling: boolean;
  readonly isTilling: boolean;
  playTill(onTill: () => boolean): boolean;
  cancelTill(): void;
  cancelEmote(): void;
  playBugNet(onCatch: () => void): boolean;
  playQuickEat(onEat: () => boolean, foodDrink?: boolean): boolean;
  playPlant(onPlant: () => boolean): boolean;
  cancelFoodAction(): void;
  setFacing(facing: 'up' | 'down' | 'side', mirrored?: boolean): void;
}
