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

/** What locomotor:PushAction / GoToEntity reads from a BufferedAction with an entity target. */
export interface LocomotorAction {
  readonly target: { getPosition(): THREE.Vector3; getPhysicsRadius?(): number };
  /** actions.lua Action.distance, already in world units. */
  readonly distance?: number;
  /** actions.lua Action.mindistance, already in world units: GoToEntity arrives no closer than this. */
  readonly minDistance?: number;
  /** actions.lua customarrivecheck / combat:LocomotorCanAttack, in place of the arrive distance. */
  arrived?(): boolean;
  isValid(): boolean;
}

export interface ActionLocomotor {
  readonly destination: THREE.Vector3 | undefined;
  goToPoint(point: THREE.Vector3): boolean;
  stop(): void;
  /** locomotor:PushAction: walk to the action's target, then `arrive` buffers it on the inst; otherwise `fail`. */
  PushAction?(action: LocomotorAction, arrive: () => void, fail: () => void): void;
}

/**
 * The player inst as the action controllers reach it. Like Lua's PlayerController, they push a
 * BufferedAction onto `stategraph` (EntityScript:PushBufferedAction), read it back through
 * `isPerformingAction` and cancel it through `cancelAction`; the stategraph chooses the state.
 */
export interface ActionPerformer {
  readonly stategraph: WilsonStateGraph;
  cancelEmote(): void;
  setFacing(facing: 'up' | 'down' | 'side', mirrored?: boolean): void;
}

/**
 * Browser admission for hand-tool requests (PlayerController has no such rule): a spell cast other
 * than reskin_tool's veryquickcast, or a bug-net swing, keeps the hand until it ends.
 */
export function isHandActionBusy(stategraph: WilsonStateGraph): boolean {
  return stategraph.isPerformingAction('NET')
    || (stategraph.isPerformingAction('CASTSPELL') && !stategraph.isPerformingAction('CASTSPELL', 'reskin_tool'));
}
