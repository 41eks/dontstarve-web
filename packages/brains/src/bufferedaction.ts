import { BufferedAction } from '../../stategraphs/src/bufferedaction';
import type { BrainEntity, BrainInst, Vec3 } from './types';

/**
 * actions.lua fn tables for the actions the brains push. GOHOME goes into a home's spawner or childspawner; its hideout
 * branch and the fallback that removes the doer at any other target are not ported, so a butterfly's flower fails it
 * and SGbutterfly's land state removes the butterfly.
 */
const ACTION_FNS: Readonly<Record<string, (doer: BrainInst, target: BrainEntity | undefined) => boolean | void>> = {
  POLLINATE: (doer, target) => {
    if (doer.components.pollinator && target) { return doer.components.pollinator.Pollinate(target) as boolean | void; }
    return undefined;
  },
  GOHOME: (doer, target) => {
    if (doer.force_onwenthome_message) { doer.PushEvent('onwenthome'); }
    const { spawner, childspawner } = target?.components ?? {};
    if (spawner) { return spawner.GoHome(doer); }
    if (childspawner) { return childspawner.GoHome(doer); }
    return false;
  },
};

/** BufferedAction(doer, target, action, invobject, pos, recipe, distance, forced, rotation, arrivedist). */
export function CreateBufferedAction<Target extends BrainEntity>(doer: BrainInst, target: Target | undefined, action: 'POLLINATE' | 'GOHOME',
  pos?: Vec3, distance?: number): BufferedAction<string, Target> {
  return new BufferedAction(action, () => ACTION_FNS[action](doer, target),
    () => doer.isValid() && (target === undefined || target.isValid()),
    { target, pos, distance });
}
