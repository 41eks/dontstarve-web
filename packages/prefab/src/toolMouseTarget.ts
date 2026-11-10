import { createEffect, createSignal, watchSignal, type HandEquipment, type ReadonlySignal } from '@dontstarve-web/signals';
import type { Workable } from '../../componets/src/workable';
import { collectEquippedItemActions, equippedActionEntity, type ComponentActionEntity } from '../../stategraphs/src/componentactions';
import type { PrefabInstance } from './prefabInstance';
import { setMouseTargetEnabled } from './mouseTargets';

export interface ToolMouseTargetWorld {
  handEquipment?: ReadonlySignal<HandEquipment | null>;
}

export interface ToolMouseTargetOptions {
  /** Preserve scene interactions such as opening a container or giving an item to a structure. */
  canInteractWithoutTool?: () => boolean;
}

/** Project input policy: tool targets intercept the mouse when the held tool can interact with them. */
export class ToolMouseTarget {
  private readonly inst: PrefabInstance;
  private readonly options: ToolMouseTargetOptions;
  private readonly hand;
  private readonly tagsChanged = createSignal(0);
  private readonly cleanups: (() => void)[] = [];
  private stopWork: () => void = () => {};
  private disposed = false;

  constructor(instance: PrefabInstance, workable: Workable | undefined, handEquipment?: ReadonlySignal<HandEquipment | null>,
    options: ToolMouseTargetOptions = {}) {
    this.inst = instance;
    this.options = options;
    this.hand = watchSignal(handEquipment ?? createSignal<HandEquipment | null>(null), stop => this.cleanups.push(stop));
    const status = watchSignal(instance.status, stop => this.cleanups.push(stop));
    this.cleanups.push(instance.onTagChanged(() => this.tagsChanged.set(this.tagsChanged.peek() + 1)));
    setMouseTargetEnabled(instance.transform.model, false);
    this.setWorkable(workable);
    createEffect(() => { if (status.get() === 'removed') this.dispose(); });
  }

  /** Stumping replaces the workable on some trees; the old bridge owns its old input effect. */
  setWorkable(workable: Workable | undefined): void {
    if (this.disposed) return;
    this.stopWork();
    const workTag = watchSignal(workable?.actionTag ?? createSignal<string | undefined>(undefined), stop => { this.stopWork = stop; });
    createEffect(() => {
      workTag.get();
      this.tagsChanged.get();
      const tool = equippedActionEntity(this.hand.get());
      setMouseTargetEnabled(this.inst.transform.model, this.canInteract(tool));
    });
  }

  private canInteract(tool: ComponentActionEntity | undefined): boolean {
    if (this.inst.isRemoved || this.inst.hasTag('INLIMBO')) return false;
    if (this.options.canInteractWithoutTool?.()) return true;
    if (!tool || tool.isRemoved) return false;
    const actions = collectEquippedItemActions(tool, undefined, this.inst, true);
    if (actions.length > 0) return true;
    // combat.lua CanLightTarget, for the fire staff's ATTACK (RANGEDLIGHT).
    const burnable = this.inst.components.burnable;
    return !!tool.components.weapon && tool.hasTag('rangedlighter') && !!burnable
      && burnable.canlight && !burnable.IsBurning() && !this.inst.hasTag('burnt') && !this.inst.hasTag('stealth');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    setMouseTargetEnabled(this.inst.transform.model, false);
    this.stopWork();
    this.cleanups.splice(0).forEach(stop => stop());
  }
}
