import { Brain } from './brain';
import { BT, PriorityNode, SequenceNode } from './behaviourtree';
import { PanicTrigger } from './braincommon';
import { FaceEntity, type FaceEntityInst } from './behaviours/faceentity';
import { RunAway } from './behaviours/runaway';
import { Wander } from './behaviours/wander';
import type { BrainEntity } from './types';

/** lightninggoatbrain.lua, in DST units. */
const WANDER_DIST_DAY = 20;
const WANDER_DIST_NIGHT = 5;
const RUN_AWAY_DIST = 8;
const STOP_RUN_AWAY_DIST = 12;
const START_FACE_DIST = 10;
const KEEP_FACE_DIST = 14;

const HUNTER_PARAMS = { tags: ['character'], notags: ['notarget'] } as const;

/**
 * lightninggoatbrain.lua. The combat branches (AttackWall while it has a target, ChaseAndAttack) need the goat's combat,
 * which is not ported. No salt lick is ported, so BrainCommon.ShouldSeekSalt is false (`_brainsaltlick` is never set)
 * and AnchorToSaltlick's WhileNode never runs; both are left out.
 */
export class LightningGoatBrain extends Brain {
  private readonly goat: FaceEntityInst;
  private readonly scale: number;
  constructor(inst: FaceEntityInst, worldScale = 1) {
    super(inst);
    this.goat = inst;
    this.scale = worldScale;
  }

  protected override OnStart(): void {
    const inst = this.goat,
      scale = this.scale;
    // GetFaceTargetFn: FindClosestPlayerToInst(inst, START_FACE_DIST, true), alive players only.
    const GetFaceTargetFn = (): BrainEntity | undefined => {
      const target = inst.world.getClosestInstWithTag(['player'], inst, START_FACE_DIST * scale);
      return target && !target.hasTag('notarget') && !target.hasTag('playerghost') ? target : undefined;
    };
    const KeepFaceTargetFn = (_inst: unknown, target: BrainEntity) =>
      !target.hasTag('notarget') && inst.IsNear(target, KEEP_FACE_DIST * scale);
    this.bt = new BT(
      inst,
      new PriorityNode(
        [
          PanicTrigger(inst),
          new SequenceNode([
            new FaceEntity(inst, GetFaceTargetFn, KeepFaceTargetFn, 0.25),
            new RunAway(inst, HUNTER_PARAMS, RUN_AWAY_DIST * scale, STOP_RUN_AWAY_DIST * scale),
          ]),
          new FaceEntity(inst, GetFaceTargetFn, KeepFaceTargetFn),
          new Wander(
            inst,
            () => inst.components.knownlocations?.GetLocation('herd'),
            () => (inst.world.isDay ? WANDER_DIST_DAY : WANDER_DIST_NIGHT) * scale,
            undefined,
            undefined,
            undefined,
            // wander.lua's default wander_dist (12), in this world's units.
            { wander_dist: 12 * scale },
          ),
        ],
        0.25,
      ),
    );
  }

  /** OnInitializationComplete: the goat remembers where it started. */
  protected override OnInitializationComplete(): void {
    this.goat.components.knownlocations?.RememberLocation('spawnpoint', this.goat.getPosition());
  }
}
