import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { Signal } from '@dontstarve-web/signals';
/** Prepared logical FX message. The target places and starts it only after committing its skin. */
export interface ReskinFxMessage {
  play(position: ReadonlyVector3, prefabId: string): void;
  /** Discard an unused message; a started FX keeps its own animation lifecycle. */
  dispose(): void;
}

/**
 * The entity's own sprite json: the skin it declares (inst.skinname), which the reskin tool writes as
 * TheSim:ReskinEntity, and the skins its declared skin source can draw (PREFAB_SKINS[inst.prefab]).
 */
export interface SkinnedSprite {
  readonly skinId: Signal<string | undefined>;
  readonly skinNames: readonly string[];
}

/** An entity the reskin tool casts on: its prefab, its position and its own sprite json. */
export interface ReskinTarget {
  readonly prefab: string;
  readonly position: ReadonlyVector3;
  readonly isRemoved: boolean;
  readonly sprite: SkinnedSprite;
}

/**
 * reskin_tool.lua GetNextSkin: the tool's cached skin for the prefab when it differs from the current one, otherwise the
 * skin after the current one; past the last skin it returns to the base (undefined).
 */
export function nextReskin(skins: readonly string[], current?: string,
  cache?: ReadonlyMap<string, string | undefined>, prefab?: string): string | undefined {
  if (cache && prefab) {
    const cached = cache.get(prefab);
    if (cached !== current) return cached;
  }
  return skins[(current === undefined ? -1 : skins.indexOf(current)) + 1];
}

export interface ReskinEffectPresenter {
  /** Declares the FX entity without IO; its display loads the art. */
  prepare(toolSkinId?: string): ReskinFxMessage;
}
