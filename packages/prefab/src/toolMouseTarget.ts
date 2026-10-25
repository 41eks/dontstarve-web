import { createEffect, createSignal, watchSignal, type HandEquipment, type ReadonlySignal } from '@dontstarve-web/signals';
import type { Workable } from '../../componets/src/workable';
import { collectEquippedActions, equippedActionEntity, type ComponentActionEntity } from '../../stategraphs/src/componentactions';
import type { FoundEntity } from './activePrefabs';
import type { PrefabInstance } from './prefabInstance';
import { setMouseTargetEnabled } from './mouseTargets';

export interface ToolMouseTargetWorld {
  handEquipment?: ReadonlySignal<HandEquipment | null>;
}

export interface ToolMouseTargetOptions {
  /** Preserve scene interactions such as opening a container or giving an item to a structure. */
  canInteractWithoutTool?: () => boolean;
  /** The owning manager also exposes this entity to the spell/reskin controllers. */
  spellTarget?: boolean;
}

/** Project input policy: tool targets intercept the mouse when the held tool can interact with them. */
export class ToolMouseTarget {
  private readonly entity: FoundEntity;
  private readonly options: ToolMouseTargetOptions;
  private readonly hand;
  private readonly tagsChanged = createSignal(0);
  private readonly cleanups: (() => void)[] = [];
  private stopWork: () => void = () => {};
  private disposed = false;

  constructor(entity: FoundEntity, instance: Pick<PrefabInstance, 'status' | 'onTagChanged'>,
    workable: Workable | undefined, handEquipment?: ReadonlySignal<HandEquipment | null>, options: ToolMouseTargetOptions = {}) {
    this.entity = entity;
    this.options = options;
    this.hand = watchSignal(handEquipment ?? createSignal<HandEquipment | null>(null), stop => this.cleanups.push(stop));
    const status = watchSignal(instance.status, stop => this.cleanups.push(stop));
    this.cleanups.push(instance.onTagChanged(() => this.tagsChanged.set(this.tagsChanged.peek() + 1)));
    setMouseTargetEnabled(entity.model, false);
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
      setMouseTargetEnabled(this.entity.model, this.canInteract(tool));
    });
  }

  private canInteract(tool: ComponentActionEntity | undefined): boolean {
    if (this.entity.isRemoved || this.entity.hasTag('INLIMBO')) return false;
    if (this.options.canInteractWithoutTool?.()) return true;
    if (!tool || tool.isRemoved) return false;
    const actions = collectEquippedActions(tool, this.entity, true);
    if (actions.some(action => action !== 'CASTSPELL') || (this.options.spellTarget && actions.includes('CASTSPELL'))) return true;
    // combat.lua CanLightTarget, for the fire staff's ATTACK (RANGEDLIGHT).
    const burnable = this.entity.components.burnable;
    return !!tool.components.weapon && tool.hasTag('rangedlighter') && !!burnable
      && burnable.canlight && !burnable.IsBurning() && !this.entity.hasTag('burnt') && !this.entity.hasTag('stealth');
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    setMouseTargetEnabled(this.entity.model, false);
    this.stopWork();
    this.cleanups.splice(0).forEach(stop => stop());
  }
}
