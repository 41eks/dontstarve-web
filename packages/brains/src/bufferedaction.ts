import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { BrainEntity, BrainInst, Vec3 } from './types';

/**
 * actions.lua fn tables for the actions the brains push. GOHOME's spawner/childspawner/hideout
 * branches belong to prefabs that are not ported, so it fails for every target here; the
 * stategraph's land state removes the creature without calling it.
 */
const ACTION_FNS: Readonly<Record<string, (doer: BrainInst, target: BrainEntity | undefined) => boolean | void>> = {
  POLLINATE: (doer, target) => {
    if (doer.components.pollinator && target) return doer.components.pollinator.Pollinate(target) as boolean | void;
    return undefined;
  },
  GOHOME: () => false,
};

/** BufferedAction(doer, target, action, invobject, pos, recipe, distance, forced, rotation, arrivedist). */
export function CreateBufferedAction(doer: BrainInst, target: BrainEntity | undefined, action: 'POLLINATE' | 'GOHOME',
  pos?: Vec3, distance?: number): BufferedAction<string> {
  return new BufferedAction(action, () => ACTION_FNS[action](doer, target),
    () => doer.isValid() && (target === undefined || target.isValid()),
    { target, pos, distance });
}
