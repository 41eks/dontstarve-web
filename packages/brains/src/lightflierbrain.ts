import { Brain } from './brain';
import { BT, PriorityNode, WhileNode, ActionNode, EventNode, ParallelNode, WaitNode } from './behaviourtree';
import { Panic } from './behaviours/panic';
import { PanicTrigger, ElectricFencePanicTrigger } from './braincommon';
import { RunAway } from './behaviours/runaway';
import { Wander } from './behaviours/wander';
import { DoAction } from './behaviours/doaction';
import { CreateBufferedAction } from './bufferedaction';
import type { BrainComponents, BrainEntity, BrainInst } from './types';

/** lightflier_flower.lua as the brain reads it: its childspawner, burnable, pickable and _lightflier_returning_home. */
export interface LightFlierBrainHome extends BrainEntity {
  readonly _lightflier_returning_home?: BrainEntity;
  readonly components: BrainComponents & {
    childspawner: NonNullable<BrainComponents['childspawner']> & { readonly numchildrenoutside: number };
    burnable: { IsBurning(): boolean };
    pickable: { readonly canBePicked: boolean };
  };
}
/** GoHomeAction's test of homeseeker.home: valid, not burning or burnt, and picked. */
export function CanGoHome(home: LightFlierBrainHome): boolean {
  return (
    home.isValid() &&
    !home.components.burnable.IsBurning() &&
    !home.hasTag('burnt') &&
    !home.components.pickable.canBePicked
  );
}
export interface LightFlierBrainInst extends BrainInst {
  readonly home?: LightFlierBrainHome;
  readonly bornAt: number;
  readonly lastAttacked: number;
  readonly inFormation: boolean;
  readonly sg?: { hasStateTag(tag: string): boolean };
  readonly components: BrainComponents & { formationfollower: { active: boolean } };
}

/** The ParallelNode's ActionNode: formation movement on or off, and the walk speed back to TUNING.LIGHTFLIER.WALK_SPEED. */
export function SetFormationActive(inst: LightFlierBrainInst, active: boolean, unit = 1): void {
  inst.components.formationfollower.active = active;
  const locomotor = inst.components.locomotor;
  if (locomotor) {
    locomotor.walkspeed = 3.5 * unit;
    locomotor.directdrive = active;
  }
}

/** FindHome: a lightflier_flower within MAX_WANDER_DIST, not burnt or burning, takes ownership of the fly. */
function FindHome(inst: LightFlierBrainInst, unit: number): void {
  if (inst.home?.isValid()) {
    return;
  }
  inst.world
    .findEntity(inst, 10 * unit, undefined, ['lightflier_home'], ['burnt', 'fire'])
    ?.components.childspawner?.TakeOwnership(inst);
}

/** brains/lightflierbrain.lua: formation direct drive follows panic, avoidance and home actions. */
export class LightFlierBrain extends Brain {
  private readonly fly: LightFlierBrainInst;
  private readonly unit: number;
  constructor(inst: LightFlierBrainInst, unit = 1) {
    super(inst);
    this.fly = inst;
    this.unit = unit;
  }
  protected override OnStart(): void {
    const inst = this.fly,
      unit = this.unit;
    const gohome = () => {
      FindHome(inst, unit);
      const home = inst.home;
      if (
        !home?.isValid() ||
        !CanGoHome(home) ||
        inst.sg?.hasStateTag('busy') ||
        !(
          home._lightflier_returning_home === inst ||
          (inst.getTime() - inst.bornAt > 60 && home.components.childspawner.numchildrenoutside > 1)
        )
      ) {
        return;
      }
      return CreateBufferedAction(inst, home, 'GOHOME', undefined, unit);
    };
    class Root extends PriorityNode {
      override Visit(): void {
        if (this.lasttime === undefined || this.lasttime + 0.25 < this.now) {
          SetFormationActive(inst, false, unit);
        }
        super.Visit();
      }
    }
    this.bt = new BT(
      inst,
      new Root(
        [
          new EventNode(inst, 'panic', new ParallelNode([new Panic(inst), new WaitNode(6)])),
          PanicTrigger(inst),
          ElectricFencePanicTrigger(inst),
          WhileNode(
            () => inst.getTime() - inst.lastAttacked < 4,
            'Recently Attacked',
            new RunAway(inst, 'scarytoprey', 8 * unit, 10 * unit),
          ),
          WhileNode(
            () => !inst.inFormation,
            'No Formation',
            new PriorityNode(
              [
                new RunAway(inst, 'scarytoprey', 3.5 * unit, 5 * unit),
                new DoAction(inst, gohome, 'Go Home', false),
                new Wander(
                  inst,
                  () => inst.home?.getPosition() ?? inst.components.knownlocations?.GetLocation('home'),
                  10 * unit,
                ),
              ],
              0.25,
            ),
          ),
          new ActionNode(() => SetFormationActive(inst, true, unit), 'Follow Formation'),
        ],
        0.25,
      ),
    );
  }
}
