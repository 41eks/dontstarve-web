import type { Vector3 } from 'three';
import type { FormationLeader, FormationMember } from './formationleader';

/** formationfollower.lua owns membership and direct-drive target assignment. */
export class FormationFollower<Target, Member extends FormationMember<Target>> {
  formationleader?: FormationLeader<Target, Member>;
  targetpos?: Vector3;
  active = false;
  updating = true;
  onenterformation?: () => void;
  onleaveformation?: () => void;
  private readonly inst: Member;
  constructor(inst: Member) { this.inst = inst; }
  SearchForFormation(leaders: readonly FormationLeader<Target, Member>[]): boolean {
    for (const leader of leaders) if (!leader.IsFormationFull() && leader.NewFormationMember(this.inst)) return true;
    return false;
  }
  LeaveFormation(): void { this.formationleader?.OnLostFormationMember(this.inst); }
  StopUpdating(): void { this.updating = false; }
  StartUpdating(): void { this.updating = true; }
  dispose(): void { this.LeaveFormation(); this.StopUpdating(); }
}
