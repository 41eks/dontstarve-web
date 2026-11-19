import { createEffect, createSignal, watchSignal, type HandEquipment, type ReadonlySignal } from '@dontstarve-web/signals';
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
  private readonly cleanups: (() => void)[] = [];
  private disposed = false;

  /** The tool actions follow the target's tags, including the workable's `<ACTION>_workable`, so a new workable needs nothing here. */
  constructor(instance: PrefabInstance, handEquipment?: ReadonlySignal<HandEquipment | null>, options: ToolMouseTargetOptions = {}) {
    this.inst = instance;
    this.options = options;
    this.hand = watchSignal(handEquipment ?? createSignal<HandEquipment | null>(null), stop => this.cleanups.push(stop));
    const status = watchSignal(instance.status, stop => this.cleanups.push(stop));
    const tags = watchSignal(instance.tags, stop => this.cleanups.push(stop));
    setMouseTargetEnabled(instance.transform.model, false);
    createEffect(() => {
      if (this.disposed) return;
      tags.get();
      const tool = equippedActionEntity(this.hand.get());
      setMouseTargetEnabled(this.inst.transform.model, this.canInteract(tool));
    });
    createEffect(() => { if (status.get() === 'removed') this.dispose(); });
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
    this.cleanups.splice(0).forEach(stop => stop());
  }
}
