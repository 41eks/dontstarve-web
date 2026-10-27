import type { AnimState } from '@dontstarve-web/animation/animState';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import type { GroundItemAssets } from './groundItems';

export interface EquipmentVisualOwner extends EquipmentOwner { readonly AnimState: AnimState }
export interface EquipmentVisualItem { readonly id: string; readonly prefab: string; readonly skinId?: string }
export interface EquipmentVisual {
  onequip(owner: EquipmentVisualOwner): void;
  onunequip(): void;
}
/** A prefab's onequip/onunequip art. It names builds on the owner's AnimState; the owner's display loads them. */
export type EquipmentVisualFactory = (item: EquipmentVisualItem) => EquipmentVisual;

/** The skin's build, from the prefab's own skin table; an unknown skin is an error. */
export function skinArchive(prefab: string, skins: Readonly<Record<string, string>>, skinId: string | undefined): string | undefined {
  if (skinId === undefined) return undefined;
  const archive = skins[skinId];
  if (!archive) throw new Error(`Unknown ${prefab} skin: ${skinId}`);
  return archive;
}

/** The shared hand-prefab onequip/onunequip branches; symbols/builds are specified by each prefab. */
export function handEquipmentVisual(
  item: EquipmentVisualItem,
  builds: readonly string[],
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

export interface EquipmentVisualContext {
  readonly owner: EquipmentVisualOwner;
  /** The owner's art source: its display loads the builds equipment names. */
  readonly assets: GroundItemAssets;
  readonly lightParent: import('three').Object3D;
  readonly hats: import('./hats').HatEquipmentAssets;
  readonly sanityPercent?: import('@dontstarve-web/signals').ReadonlySignal<number>;
}

/** Worn art goes on the context's AnimState; its events go to the equip owner, or to the context's owner without one. */
export function wornEquipmentLifecycle(visual: EquipmentVisual, context: Pick<EquipmentVisualContext, 'owner'>) {
  return {
    onequip(owner?: EquipmentOwner) {
      visual.onequip(owner ? { AnimState: context.owner.AnimState, PushEvent: (name, data) => owner.PushEvent(name, data) } : context.owner);
    },
    onunequip() { visual.onunequip(); },
  };
}
