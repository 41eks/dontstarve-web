import { Brain } from './brain';
import { BT, PriorityNode } from './behaviourtree';
import { FaceEntity, type FaceEntityInst } from './behaviours/faceentity';
import { Wander } from './behaviours/wander';

/** beefalobrain.lua's passive wild-adult branch; combat, leaders, domestication and salt are unported. */
export class BeefaloBrain extends Brain {
  private readonly beefalo: FaceEntityInst;
  private readonly scale: number;
  constructor(inst: FaceEntityInst, worldScale = 1) {
    super(inst);
    this.beefalo = inst; this.scale = worldScale;
  }

  protected override OnStart(): void {
    const inst = this.beefalo, scale = this.scale;
    this.bt = new BT(inst, new PriorityNode([
      new FaceEntity(inst,
        () => {
          const target = inst.world.getClosestInstWithTag(['player'], inst, 4 * scale);
          return target && !target.hasTag('notarget') && !target.hasTag('playerghost') ? target : undefined;
        },
        (_inst, target) => inst.isValid() && !target.hasTag('notarget') && !target.hasTag('playerghost')
          && inst.isNear(target, 6 * scale)),
      new Wander(inst, () => inst.components.knownlocations?.GetLocation('herd'),
        () => (inst.world.isDay ? 20 : 5) * scale, undefined, undefined, undefined,
        { wander_dist: 12 * scale }),
    ], .25));
  }
}
