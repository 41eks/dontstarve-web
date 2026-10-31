import type * as THREE from 'three';
import type { BufferedActionObject } from './bufferedaction.ts';
import type { ActionTargetView } from './actionTargetView.ts';
import type { SpellTarget } from '../../componets/src/spellcaster.ts';
export type { SpellCastDoer, SpellCastMap, SpellCasterComponent } from '../../componets/src/spellcaster.ts';

/** What a spell reads off the entity it is cast on. */
export type SpellCastTarget = SpellTarget & BufferedActionObject & ActionTargetView & {
  readonly prefab: string;
  readonly position: THREE.Vector3;
  isValid(): boolean;
};
