import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { BufferedActionObject } from './bufferedaction.ts';
import type { ActionTargetView } from './actionTargetView.ts';
import type { SpellTarget } from '../../componets/src/spellcaster.ts';
export type { SpellCastDoer, SpellCastMap, SpellCasterComponent } from '../../componets/src/spellcaster.ts';

/** What a spell reads off the entity it is cast on. */
export type SpellCastTarget = SpellTarget & BufferedActionObject & ActionTargetView & {
  readonly prefab: string;
  readonly position: ReadonlyVector3;
  isValid(): boolean;
};
