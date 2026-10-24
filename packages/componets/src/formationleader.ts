import { Vector3 } from 'three';
import type { FormationFollower } from './formationfollower';
import type { Follower } from './follower';

export interface FormationMember<Target> {
  isValid(): boolean;
  readonly components: { formationfollower: FormationFollower<Target, any>; follower?: Follower<Target>; health?: { IsDead(): boolean } };
  ListenForEvent(name: string, fn: () => void): () => void;
}
/** formationleader.lua: circular positions and membership lifecycle; prefab supplies target motion. */
export class FormationLeader<Target, Member extends FormationMember<Target>> {
  readonly tags = ['NOCLICK', 'NOBLOCK', 'formationleader', 'formationleader_lightflier'];
  readonly members = new Set<Member>();
  readonly position = new Vector3();
  radius = 4.1;
  rotation = .9;
  maxsize = 3;
  reverse = false;
  age = 0;
  private theta: number;
  private readonly stops = new Map<Member, (() => void)[]>();
  private disposed = false;
  readonly target: Target;
  ondisband?: () => void;
  constructor(target: Target, random = Math.random) { this.target = target; this.theta = random() * Math.PI * 2; }
  IsFormationFull(): boolean { return this.disposed || this.members.size >= this.maxsize; }
  NewFormationMember(member: Member): boolean {
    if (this.IsFormationFull() || !member.isValid() || member.components.health?.IsDead()
      || member.components.follower?.leader || member.components.formationfollower.formationleader) return false;
    this.members.add(member); const follower = member.components.formationfollower;
    follower.formationleader = this; follower.onenterformation?.();
    member.components.follower?.SetLeader(this.target);
    this.stops.set(member, ['death', 'onremove', 'onenterlimbo'].map(event => member.ListenForEvent(event, () => this.OnLostFormationMember(member))));
    return true;
  }
  OnLostFormationMember(member: Member): void {
    if (!this.members.delete(member)) return;
    this.stops.get(member)?.forEach(stop => stop()); this.stops.delete(member);
    const follower = member.components.formationfollower;
    follower.onleaveformation?.(); follower.formationleader = undefined; follower.targetpos = undefined;
    member.components.follower?.StopFollowing();
  }
  update(dt: number): void {
    if (this.disposed) return;
    for (const member of this.members) if (!member.isValid()) this.OnLostFormationMember(member);
    if (!this.members.size) { this.DisbandFormation(); return; }
    this.age += dt; this.theta += dt * this.rotation * (this.reverse ? -1 : 1);
    let index = 0;
    for (const member of this.members) {
      const angle = this.theta + index++ * Math.PI * 2 / this.members.size;
      member.components.formationfollower.targetpos = this.position.clone().add(new Vector3(Math.cos(angle) * this.radius, 0, -Math.sin(angle) * this.radius));
    }
  }
  DisbandFormation(): void {
    if (this.disposed) return; this.disposed = true;
    this.ondisband?.(); for (const member of this.members) this.OnLostFormationMember(member);
  }
  dispose(): void { this.DisbandFormation(); }
}
