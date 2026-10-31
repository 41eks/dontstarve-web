import type * as THREE from 'three';
import type { Signal } from '@dontstarve-web/signals';
import type { SpellTarget } from '../../componets/src/spellcaster';
import type { ActionTargetView } from './actionTargetView.ts';
/** Prepared logical FX message. The target places and starts it only after committing its skin. */
export interface ReskinFxMessage {
  play(position: THREE.Vector3, prefabId: string): void;
  /** Discard an unused message; a started FX keeps its own animation lifecycle. */
  dispose(): void;
}

/** The skin an entity's sprite json declares (inst.skinname); the reskin tool writes it as TheSim:ReskinEntity. */
export interface SkinnedSprite { readonly skinId: Signal<string | undefined> }

type ReskinActionTarget = SpellTarget & ActionTargetView & {
  readonly id: string;
  readonly prefabId: string;
  readonly position: THREE.Vector3;
  readonly skinId?: string;
  readonly skins: readonly string[];
  readonly reskinToolCannotTargetThis?: boolean;
  /** The entity's own sprite json; only an entity with one can be reskinned. */
  readonly sprite?: SkinnedSprite;
  isValid(): boolean;
};

export type ReskinTarget = ReskinActionTarget & Required<Pick<ReskinActionTarget, 'sprite'>>;

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
