export interface FollowerLeader {
  ListenForEvent?(name: string, fn: () => void): () => void;
}

/** follower.lua's non-loyalty membership branch, used by formationleader. */
export class Follower<Target> {
  leader?: Target;
  private stopLeader?: () => void;
  private readonly inst: { PushEvent(name: string, data: unknown): void };
  constructor(inst: Follower<Target>['inst']) { this.inst = inst; }
  SetLeader(leader?: Target): void {
    if (leader === this.leader) return;
    const old = this.leader; this.stopLeader?.(); this.stopLeader = undefined; this.leader = leader;
    this.stopLeader = (leader as FollowerLeader | undefined)?.ListenForEvent?.('onremove', () => this.StopFollowing());
    this.inst.PushEvent('leaderchanged', { new: leader, old });
  }
  StopFollowing(): void { this.SetLeader(); }
  dispose(): void { this.StopFollowing(); }
}
