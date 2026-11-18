/** tuning.lua TUNING.BOAT.MAST.BASIC, which the Mast constructor starts from. */
export const MAST_BASIC = { MAX_VELOCITY: 2.5, SAIL_FORCE: 0.6, RUDDER_TURN_DRAG: 0.23 } as const;
/** tuning.lua TUNING.BOAT.MAST.MALBATROSS. */
export const MAST_MALBATROSS = { MAX_VELOCITY: 4, SAIL_FORCE: 1.3, RUDDER_TURN_DRAG: 0.23 } as const;

export interface MastInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  readonly AnimState: { PlayAnimation(name: string, loop?: boolean): void; PushAnimation(name: string, loop?: boolean): void };
}

/**
 * components/mast.lua, as far as a mast standing off any boat loads and saves it: the sail state, its tags and the
 * clips SailFurled / SailUnfurled play. Not ported: the rudder SetRudder spawns, the DoTaskInTime(0) SetBoat and every
 * boat branch (boatphysics, OnDeath, OnRemoveEntity's sink fx), sail furling (AddSailFurler, RemoveSailFurler,
 * GetCurrentFurlUnits, UnfurlSail, OnUpdate), CalcSailForce / CalcMaxVelocity, SetSailForce, CloseSail,
 * GetFurled0to1 and the SoundEmitter.
 */
export class Mast {
  private readonly inst: MastInst;
  private sailRaised = false;
  inverted = false;
  sail_force: number = MAST_BASIC.SAIL_FORCE;
  has_speed = false;
  max_velocity: number = MAST_BASIC.MAX_VELOCITY;
  rudder_turn_drag: number = MAST_BASIC.RUDDER_TURN_DRAG;
  readonly furlunits_max = 4.5;
  furlunits = this.furlunits_max;
  autounfurlunits = 8;
  /** mast.sink_fx: the prefab OnRemoveEntity spawns on a boat; nothing spawns it here. */
  sink_fx?: string;
  /** mast.is_sail_transitioning: nil until a furler or UnfurlSail starts a transition, which is not ported. */
  is_sail_transitioning?: true;

  constructor(inst: MastInst) {
    this.inst = inst;
    this.is_sail_raised = false;
  }

  /** is_sail_raised, with on_is_sail_raised's sailraised / saillowered tags. */
  get is_sail_raised(): boolean { return this.sailRaised; }
  set is_sail_raised(value: boolean) {
    this.sailRaised = value;
    this.inst.removeTag(value ? 'saillowered' : 'sailraised');
    this.inst.addTag(value ? 'sailraised' : 'saillowered');
  }

  SetReveseDeploy(set: boolean): void {
    this.furlunits = set ? 0 : this.furlunits;
    this.is_sail_raised = set;
    this.inverted = set;
  }

  /** Mast:SailFurled: the sail is raised. Its sail top sound and the furlers it releases are not ported. */
  SailFurled(): void {
    this.furlunits = this.furlunits_max;
    this.is_sail_transitioning = undefined;
    this.inst.removeTag('sail_transitioning');
    if (!this.is_sail_raised) return;
    this.is_sail_raised = false;
    this.inst.AnimState.PlayAnimation('knot_tie', false);
    if (this.inverted) this.inst.AnimState.PushAnimation('open_loop', true);
    else this.inst.AnimState.PushAnimation('closed', false);
  }

  /** Mast:SailUnfurled: the sail is lowered. */
  SailUnfurled(): void {
    this.furlunits = 0;
    this.is_sail_transitioning = undefined;
    this.inst.removeTag('sail_transitioning');
    this.is_sail_raised = true;
    if (this.inverted) this.inst.AnimState.PlayAnimation('closed', false);
    else this.inst.AnimState.PlayAnimation('open_loop', true);
  }
}
