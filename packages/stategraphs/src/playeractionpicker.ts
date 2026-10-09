import type * as THREE from 'three';
import { getActionPriority, type ActionDescription } from './actions.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';

export interface MouseActionCandidate {
  action: ActionDescription;
  button: 'left' | 'right';
  /** Missing model means a point action. Disabled models still block picking through them. */
  model?: THREE.Object3D;
  available?: boolean;
}

export interface MouseActions {
  left?: ActionDescription;
  right?: ActionDescription;
}

/** Input's shared target -> PlayerActionPicker's priority-sorted LMB/RMB candidates. */
export class PlayerActionPicker {
  readonly pointer: PointerRaycaster;
  private readonly providers = new Set<() => readonly MouseActionCandidate[]>();
  private readonly isEnabled: () => boolean;

  constructor(pointer: PointerRaycaster, isEnabled = () => true) { this.pointer = pointer; this.isEnabled = isEnabled; }

  register(provider: () => readonly MouseActionCandidate[]): () => void {
    this.providers.add(provider);
    return () => { this.providers.delete(provider); };
  }

  getMouseActions(): MouseActions {
    if (!this.isEnabled()) return {};
    this.pointer.beginFrame();
    try {
      const candidates = [...this.providers].flatMap(provider => provider());
      const models = new Set(candidates.flatMap(candidate => candidate.model ? [candidate.model] : []));
      const hit = this.pointer.raycastPointer([...models]);
      let target = hit?.object ?? null;
      while (target && !models.has(target)) target = target.parent;
      const result: MouseActions = {};
      for (const button of ['left', 'right'] as const) {
        const available = candidates.filter(candidate => candidate.button === button && candidate.available !== false);
        // Equipped/scene actions take precedence over a point action, as in GetLeft/RightClickActions.
        const entityActions = target ? available.filter(candidate => candidate.model === target) : [];
        const actions = entityActions.length ? entityActions : available.filter(candidate => !candidate.model);
        actions.sort((a, b) => getActionPriority(b.action) - getActionPriority(a.action));
        result[button] = actions[0]?.action;
      }
      if (result.left && result.right && result.left.action === result.right.action
        && result.left.invobject === result.right.invobject) result.right = undefined;
      return result;
    } finally { this.pointer.endFrame(); }
  }

  dispose(): void { this.providers.clear(); this.pointer.dispose(); }
}
