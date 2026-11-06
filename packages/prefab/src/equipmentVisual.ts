import { AnimState, type AnimStateArt } from '@dontstarve-web/animation/animState';
import type { SpriteState } from '@dontstarve-web/display';
import type { FollowerFx } from '@dontstarve-web/display';
import type { EquipmentOwner, EquipmentOwnerView } from '@dontstarve-web/signals';
import type * as THREE from 'three';
import type { GroundItemAssets } from './groundItems';

/**
 * The owner as an equipped inst's onequip/onunequip see it (equippable:Equip opens the view): owner.AnimState is the
 * inst's own slot over the owner's sprite, and `presentation` is what the owner draws equipment with.
 */
export interface EquipmentVisualOwner extends EquipmentOwnerView {
  readonly AnimState: AnimState;
  readonly presentation: EquipmentPresentation;
}

/** A view opened without a presentation (no drawn holder) has no AnimState. */
export function wornOwner(owner: EquipmentOwner): EquipmentVisualOwner | undefined {
  return (owner as Partial<EquipmentVisualOwner>).AnimState ? owner as EquipmentVisualOwner : undefined;
}

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
/** A hand prefab's equip functions for one equip, called from its equippable's onequip/onunequip. */
export interface HeldEquipFunctions {
  onequip(owner?: EquipmentOwner): void;
  onunequip(): void;
  /** Settles consumption before a save or transfer reads the inst. */
  flush?(): void;
}
export interface EquipmentVisualItem { readonly id: string; readonly prefab: string; readonly skinId?: string }
/** What an item's worn art writes: owner.AnimState (its slot) and owner:PushEvent for the skin events. */
export type EquipmentArtOwner = Pick<EquipmentOwner, 'PushEvent'> & { readonly AnimState: AnimState };
export interface EquipmentVisual {
  onequip(owner: EquipmentArtOwner): void;
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
  let owner: EquipmentArtOwner | undefined;
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

/** What the owner draws its equipment with: its sprite and art, the light parent and the symbols fx follow. */
export interface EquipmentPresentation {
  readonly sprite: EquipmentSprite;
  /** The owner's art source: its display loads the builds equipment names. */
  readonly assets: GroundItemAssets;
  /** The holder: lights the equipment spawns are parented to it (AttachLightTo(owner)). */
  readonly lightParent: import('./prefabInstance').PrefabInstance;
  readonly hats: import('./hats').HatEquipmentAssets;
  readonly sanityPercent?: import('@dontstarve-web/signals').ReadonlySignal<number>;
  /** owner's FollowSymbol, for fx that follow swap_object. */
  followSymbol?(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): { node: THREE.Object3D; remove(): void };
  /** Where the owner's equipment sounds play. */
  readonly soundPosition?: import('../../animation/src/transformRoot').ReadonlyVector3;
}

/**
 * owner.OpenEquipmentView: each equipped inst writes its own AnimState slot of the owner's sprite, declared from equip
 * until the view closes (or, retained, until the last hold is released), so unequipping leaves what lies beneath.
 */
export function createEquipmentViews(owner: EquipmentOwner, presentation: EquipmentPresentation): (inst: object) => EquipmentVisualOwner {
  return () => {
    const slot = new EquipmentAnimState(presentation.sprite);
    slot.equip();
    let holds = 0, closed = false;
    const settle = () => { if (closed && holds === 0) slot.unequip(); };
    const view: EquipmentVisualOwner = Object.assign(Object.create(owner) as EquipmentOwner, {
      AnimState: slot.AnimState,
      presentation,
      OpenEquipmentView: undefined,
      Retain() {
        holds++;
        let released = false;
        return () => { if (released) return; released = true; holds--; settle(); };
      },
      close() { if (closed) return; closed = true; settle(); },
    });
    return view;
  };
}
