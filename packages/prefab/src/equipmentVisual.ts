import { AnimState, type AnimStateArt } from '@dontstarve-web/animation/animState';
import type { SpriteState } from '@dontstarve-web/display';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import type { GroundItemAssets } from './groundItems';

/** owner.AnimState and owner:PushEvent as an equipped item's onequip/onunequip use them. */
export interface EquipmentVisualOwner extends EquipmentOwner { readonly AnimState: AnimState }

/** The holder's sprite, on which each equipped item declares its own AnimState slot, and the art its display loads them from. */
export interface EquipmentSprite {
  readonly sprite: Pick<SpriteState, 'declareAnimState'>;
  readonly art: AnimStateArt;
}

let nextSlot = 0;

/**
 * owner.AnimState as one equipped item writes it: an AnimState of its own whose json signal sits in a slot of the holder's
 * sprite, drawn over the holder's own AnimState and the items equipped before it. The holder's display follows the signal;
 * the slot is declared from equip to unequip, so unequipping leaves what lies beneath.
 */
export class EquipmentAnimState {
  readonly AnimState = new AnimState();
  private readonly holder: EquipmentSprite;
  private readonly key = `equipment:${nextSlot++}`;

  constructor(holder: EquipmentSprite) { this.holder = holder; }

  equip(): void { this.holder.sprite.declareAnimState(this.key, this.AnimState.json, this.holder.art); }
  unequip(): void { this.holder.sprite.declareAnimState(this.key, undefined); }
}
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
  /** Where an item's events go when it is equipped without an inventory owner, as a standalone preview is. */
  readonly owner: Pick<EquipmentOwner, 'PushEvent'>;
  readonly sprite: EquipmentSprite;
  /** The owner's art source: its display loads the builds equipment names. */
  readonly assets: GroundItemAssets;
  /** The holder: lights the equipment spawns are parented to it. */
  readonly lightParent: import('./prefabInstance').PrefabInstance;
  readonly hats: import('./hats').HatEquipmentAssets;
  readonly sanityPercent?: import('@dontstarve-web/signals').ReadonlySignal<number>;
}

/** An item's equipped art goes on its own slot of the holder's sprite; its events go to the equip owner, or to the context's owner without one. */
export function wornEquipmentLifecycle(visual: EquipmentVisual, context: Pick<EquipmentVisualContext, 'owner' | 'sprite'>) {
  const slot = new EquipmentAnimState(context.sprite);
  return {
    onequip(owner?: EquipmentOwner) {
      const events = owner ?? context.owner;
      slot.equip();
      visual.onequip({ AnimState: slot.AnimState, PushEvent: (name, data) => events.PushEvent(name, data) });
    },
    onunequip() { visual.onunequip(); slot.unequip(); },
  };
}
