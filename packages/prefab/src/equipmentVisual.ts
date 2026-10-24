import type { AnimState, SymbolBuild } from '@dontstarve-web/animation/animState';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import type { GroundItemAssets } from './groundItems';

export interface EquipmentVisualOwner extends EquipmentOwner { readonly AnimState: AnimState }
export interface EquipmentVisualItem { readonly id: string; readonly prefab: string; readonly skinId?: string }
export interface EquipmentVisual {
  onequip(owner: EquipmentVisualOwner): void;
  onunequip(): void;
}
export type PrepareEquipmentVisual = (assets: GroundItemAssets, item: EquipmentVisualItem) => Promise<EquipmentVisual>;

/** The shared hand-prefab onequip/onunequip branches; symbols/builds are specified by each prefab. */
export function handEquipmentVisual(
  item: EquipmentVisualItem,
  builds: readonly SymbolBuild[],
  sourceSymbol: string,
  extraSymbols: readonly { symbol: string; source: string }[] = [],
  unequipSkinEvent = true,
): EquipmentVisual {
  let owner: EquipmentVisualOwner | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      if (item.skinId) owner.PushEvent('equipskinneditem', item.skinId);
      for (const { symbol, source } of [{ symbol: 'swap_object', source: sourceSymbol }, ...extraSymbols]) {
        if (item.skinId) owner.AnimState.OverrideItemSkinSymbol(symbol, builds, source, item.id);
        else owner.AnimState.OverrideSymbol(symbol, builds, source);
      }
      owner.AnimState.Show('ARM_carry');
      owner.AnimState.Hide('ARM_normal');
    },
    onunequip() {
      if (!owner) return;
      owner.AnimState.Hide('ARM_carry');
      owner.AnimState.Show('ARM_normal');
      if (item.skinId && unequipSkinEvent) owner.PushEvent('unequipskinneditem', item.skinId);
      for (const { symbol } of extraSymbols) owner.AnimState.ClearOverrideSymbol(symbol);
      owner = undefined;
    },
  };
}

/** Loading belongs to this equip lifetime; stale loads can never write to the next equipper. */
export function equipmentVisualLifecycle(prepare: () => Promise<EquipmentVisual>, owner: EquipmentVisualOwner) {
  let active: EquipmentVisual | undefined;
  let removed = false;
  const ready = prepare().then(visual => {
    if (removed) return;
    active = visual;
    visual.onequip(owner);
  }).catch(error => { if (!removed) throw error; });
  return { ready, onunequip() { removed = true; active?.onunequip(); active = undefined; } };
}

export interface EquipmentVisualContext {
  readonly owner: EquipmentVisualOwner;
  readonly assets: GroundItemAssets;
  readonly lightParent: import('three').Object3D;
  readonly hats: import('./hats').HatEquipmentAssets;
  readonly sanityPercent?: import('@dontstarve-web/signals').ReadonlySignal<number>;
}

export function preparedEquipmentLifecycle(prepare: () => Promise<EquipmentVisual>, context: EquipmentVisualContext) {
  let visual: ReturnType<typeof equipmentVisualLifecycle> | undefined;
  return {
    get ready() { return visual?.ready ?? Promise.resolve(); },
    onequip(owner?: EquipmentOwner) {
      visual = equipmentVisualLifecycle(prepare, owner ? {
        AnimState: context.owner.AnimState, PushEvent: (name, data) => owner.PushEvent(name, data),
      } : context.owner);
    },
    onunequip() { visual?.onunequip(); visual = undefined; },
  };
}
