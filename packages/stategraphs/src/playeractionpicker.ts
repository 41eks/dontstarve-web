import type * as THREE from 'three';
import { getActionPriority, type ActionDescription } from './actions.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import { isMouseTarget } from './mouseTargets.ts';

export interface MouseActionCandidate {
  action: ActionDescription;
  button: 'left' | 'right';
  /** Missing model means a point action. Disabled models still block picking through them. */
  model?: THREE.Object3D;
  available?: boolean;
  /** Lua tries equipped item actions before gathering scene component actions. */
  source?: 'equipped' | 'scene' | 'inventory' | 'special';
}

/** playeractionpicker.lua actionfilter: the action is kept when this returns true. */
export type ActionFilter = (action: ActionDescription) => boolean;

export interface MouseActions {
  left?: ActionDescription;
  right?: ActionDescription;
}

/** Input's shared target -> PlayerActionPicker's priority-sorted LMB/RMB candidates. */
export class PlayerActionPicker {
  readonly pointer: PointerRaycaster;
  private readonly providers = new Set<(target: THREE.Object3D | undefined) => readonly MouseActionCandidate[]>();
  private readonly isEnabled: () => boolean;
  private readonly activeItemSources = new Set<() => boolean>();
  private readonly eventActions = new WeakMap<PointerEvent, { actions: MouseActions; target?: THREE.Object3D }>();
  private selectedModel?: THREE.Object3D;
  private readonly actionFilters: { fn: ActionFilter; priority: number }[] = [];
  get targetModel(): THREE.Object3D | undefined { return this.selectedModel; }

  constructor(pointer: PointerRaycaster, isEnabled = () => true) { this.pointer = pointer; this.isEnabled = isEnabled; }

  /** Only the highest priority filter is active (the latest pushed among equals), as OnUpdateActionFilterStack picks. */
  PushActionFilter(fn: ActionFilter, priority = 0): void { this.actionFilters.push({ fn, priority }); }
  PopActionFilter(fn: ActionFilter): void {
    const index = this.actionFilters.findLastIndex(filter => filter.fn === fn);
    if (index >= 0) this.actionFilters.splice(index, 1);
  }
  private get actionFilter(): ActionFilter | undefined {
    return this.actionFilters.reduce<{ fn: ActionFilter; priority: number } | undefined>(
      (top, filter) => !top || filter.priority >= top.priority ? filter : top, undefined)?.fn;
  }

  register(provider: (target: THREE.Object3D | undefined) => readonly MouseActionCandidate[]): () => void {
    this.providers.add(provider);
    return () => { this.providers.delete(provider); };
  }
  /** GetLeft/RightClickActions use the active inventory item before scene or equipped actions. */
  registerActiveItemSource(source: () => boolean): () => void {
    this.activeItemSources.add(source);
    return () => { this.activeItemSources.delete(source); };
  }

  getMouseActions(event?: PointerEvent): MouseActions {
    if (event) {
      const cached = this.eventActions.get(event);
      if (cached) { this.selectedModel = cached.target; return cached.actions; }
      this.pointer.trackPointer(event);
    }
    if (!this.isEnabled()) { this.selectedModel = undefined; return {}; }
    this.pointer.beginFrame();
    try {
      const hit = this.pointer.pickMouseTarget();
      let target = hit?.object ?? null;
      while (target && !isMouseTarget(target)) target = target.parent;
      this.selectedModel = target ?? undefined;
      const candidates = [...this.providers].flatMap(provider => provider(target ?? undefined));
      const filter = this.actionFilter;
      const activeItem = [...this.activeItemSources].some(source => source());
      const result: MouseActions = {};
      for (const button of ['left', 'right'] as const) {
        const available = candidates.filter(candidate => candidate.button === button && candidate.available !== false
          && (!filter || filter(candidate.action)) && (!activeItem || candidate.source === 'inventory'));
        // Equipped/scene actions take precedence over a point action, as in GetLeft/RightClickActions.
        const entityActions = target ? available.filter(candidate => candidate.model === target) : [];
        const points = available.filter(candidate => !candidate.model);
        // GetPointSpecialActions is only the fallback after ordinary equipped point actions.
        const ordinaryPoints = points.filter(candidate => candidate.source !== 'special');
        const actions = entityActions.length ? entityActions : ordinaryPoints.length ? ordinaryPoints : points;
        actions.sort((a, b) => Number(b.source === 'equipped') - Number(a.source === 'equipped')
          || getActionPriority(b.action) - getActionPriority(a.action));
        result[button] = actions[0]?.action;
      }
      if (result.left && result.right && result.left.action === result.right.action
        && result.left.invobject === result.right.invobject) result.right = undefined;
      if (event) this.eventActions.set(event, { actions: result, target: this.selectedModel });
      return result;
    } finally { this.pointer.endFrame(); }
  }

  dispose(): void { this.providers.clear(); this.activeItemSources.clear(); this.pointer.dispose(); }
}
