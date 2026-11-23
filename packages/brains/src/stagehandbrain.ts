import type { StagehandInstance } from '../../prefab/src/stagehand';
import type { PrefabInstance } from '../../prefab/src/prefabInstance';
import { InventoryItem } from '../../componets/src/inventoryitem';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { BT, PriorityNode, WhileNode } from './behaviourtree';
import { FindClosest } from './behaviours/findclosest';
import { StandStill } from './behaviours/standstill';
import { Brain } from './brain';
import { PanicTrigger } from './braincommon';

const SEE_LIGHT_DIST = 50 * WORLD_SCALE;
const SAFE_DISTANCE = 4 * WORLD_SCALE;
const FIRE_TAGS = ['fire'];
const LIGHT_TAGS = ['campfire', 'lighter'];

function SafeLightDist(target: PrefabInstance): number {
  const item = target.components.inventoryitem;
  if (
    target.hasTag('player') ||
    target.hasTag('playerlight') ||
    (item instanceof InventoryItem && item.GetGrandOwner()?.hasTag('player'))
  ) {
    return SAFE_DISTANCE;
  }
  return target.light.json.peek()?.radius ?? SAFE_DISTANCE;
}

/** brains/stagehandbrain.lua. */
export class StagehandBrain extends Brain<StagehandInstance> {
  protected OnStart(): void {
    const { inst } = this;
    this.bt = new BT(
      inst,
      new PriorityNode(
        [
          PanicTrigger(inst),
          WhileNode(
            () => inst.CanStandUp(inst) && inst.phase === 'night',
            'IsNight',
            new FindClosest(
              inst,
              () => inst.TheSim.FindEntities(inst.position, SEE_LIGHT_DIST, FIRE_TAGS, undefined, LIGHT_TAGS),
              SafeLightDist,
              FIRE_TAGS,
              LIGHT_TAGS,
            ),
          ),
          new StandStill(inst),
        ],
        1,
      ),
    );
  }
}
