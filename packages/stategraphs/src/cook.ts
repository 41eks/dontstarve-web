import type { Stewer } from '../../componets/src/stewer';

export interface CookActionTarget {
  components: {
    stewer?: Stewer;
    container?: { IsOpenedByOthers(doer: object): boolean };
  };
}

/** actions.lua:ACTIONS.COOK.fn, stewer branch (widget buttons execute directly). */
export function performCookAction(target: CookActionTarget, doer: object): boolean {
  const { stewer, container } = target.components;
  if (!stewer) return false;
  if (stewer.IsCooking()) return true;
  if (container?.IsOpenedByOthers(doer) || !stewer.CanCook()) return false;
  return stewer.StartCooking(doer);
}
