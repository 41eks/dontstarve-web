import { ActionNode, BT, IfNode, PriorityNode, type BehaviourContext } from './behaviourtree';
import { Brain } from './brain';
import type { Vector3 } from 'three';

/** A ground position, compared with distanceToSquared. */
type Position = Readonly<Pick<Vector3, 'x' | 'y' | 'z' | 'distanceToSquared'>>;

/** An AllPlayers entry as the Bernie brains read it; `bigbernies` / `blockbigbernies` are the fields they set on it. */
export interface BerniePlayer {
  readonly position: Position;
  hasTag(tag: string): boolean;
  readonly components: { readonly sanity?: { GetPercent(): number; IsCrazy(): boolean } };
  /** entity:IsVisible() */
  IsVisible(): boolean;
  bigbernies?: Set<object>;
  /** The pending OnEndBlockBigBernies task's cancel. */
  blockbigbernies?: () => void;
}

/** The bernie_active / bernie_big inst fields the brains read. */
export interface BernieBrainInst extends BehaviourContext {
  readonly position: Position;
  readonly sg: { hasStateTag(tag: string): boolean; goToState(name: 'deactivate'): void };
  readonly components: { readonly timer: { TimerExists(name: string): boolean } };
  /** AllPlayers */
  getPlayers(): readonly BerniePlayer[];
  /** bernie_common.lua isleadercrazy; the hotheaded skill branch is not ported. */
  isleadercrazy(leader: BerniePlayer): boolean;
  /** leader:DoTaskInTime on the game-time scheduler; returns the cancel. */
  doTaskInTime(seconds: number, fn: () => void): () => void;
}

export interface BernieActiveBrainInst extends BernieBrainInst {
  GoBig(leader: BerniePlayer): unknown;
}

export interface BernieBigBrainInst extends BernieBrainInst {
  onLeaderChanged(leader: BerniePlayer): void;
  /** inst:GetTimeAlive() */
  GetTimeAlive(): number;
  should_shrink?: boolean;
}

// berniebrain.lua, in DST units scaled by the caller's world scale.
const LOSE_LEADER_DIST = 30;
const BIG_LEADER_DIST = 8;

/**
 * brains/berniebrain.lua: go big next to a crazy Willow, sit down when no crazy player is in reach. The shadow creature
 * taunt, Follow and Wander are not ported, so an active Bernie stays where it reanimated.
 */
export class BernieBrain extends Brain<BernieActiveBrainInst> {
  private _leader?: BerniePlayer;
  private readonly scale: number;
  constructor(inst: BernieActiveBrainInst, worldScale = 1) { super(inst); this.scale = worldScale; }

  private FindLeader(): BerniePlayer | undefined {
    this._leader = undefined;
    let rangesq = (LOSE_LEADER_DIST * this.scale) ** 2;
    for (const v of this.inst.getPlayers()) {
      if (this.inst.isleadercrazy(v) && v.IsVisible()) {
        const d = v.position.distanceToSquared(this.inst.position);
        if (d < rangesq) { rangesq = d; this._leader = v; }
      }
    }
    return this._leader;
  }

  private ShouldGoBig(): boolean {
    this._leader = undefined;
    for (const v of this.inst.getPlayers()) {
      if (v.hasTag('bernieowner') && v.bigbernies === undefined && v.blockbigbernies === undefined
        && this.inst.isleadercrazy(v) && v.IsVisible() && v.position.distanceToSquared(this.inst.position) < (BIG_LEADER_DIST * this.scale) ** 2) {
        this._leader = v;
        return true;
      }
    }
    return false;
  }

  private DoGoBig(leader: BerniePlayer | undefined): void {
    if (!leader || leader.bigbernies) return;
    leader.blockbigbernies?.();
    // V2C: block other big bernies from triggering, since brain needs time to detect initial leader
    leader.blockbigbernies = this.inst.doTaskInTime(.5, () => { leader.blockbigbernies = undefined; });
    this.inst.GoBig(leader);
  }

  protected override OnStart(): void {
    const inst = this.inst;
    const root = new PriorityNode([
      IfNode(() => !inst.sg.hasStateTag('busy') && !inst.components.timer.TimerExists('transform_cd') && this.ShouldGoBig(),
        'Go Big', new ActionNode(() => this.DoGoBig(this._leader))),
      IfNode(() => !inst.sg.hasStateTag('busy') && this.FindLeader() === undefined,
        'No Leader', new ActionNode(() => inst.sg.goToState('deactivate'))),
    ], 1);
    this.bt = new BT(inst, root);
  }
}

// berniebigbrain.lua
const FIND_LEADER_DIST = 22;
const MIN_ACTIVE_TIME = 4;
const FOLLOWER_SANITY_THRESHOLD = .5;

/**
 * brains/berniebigbrain.lua ShouldDeactivate: a big Bernie keeps a crazy Willow within reach as its leader and
 * deactivates without one. Combat (the DEACTIVATE_DELAY after fighting), the taunt, Follow and Wander are not ported.
 */
export class BernieBigBrain extends Brain<BernieBigBrainInst> {
  private _leader?: BerniePlayer;
  private readonly scale: number;
  constructor(inst: BernieBigBrainInst, worldScale = 1) { super(inst); this.scale = worldScale; }

  private SetLeader(leader: BerniePlayer | undefined): void {
    if (this._leader === leader) return;
    if (this._leader?.bigbernies) {
      this._leader.bigbernies.delete(this.inst);
      if (this._leader.bigbernies.size === 0) this._leader.bigbernies = undefined;
    }
    if (leader) {
      (leader.bigbernies ??= new Set()).add(this.inst);
      this.inst.onLeaderChanged(leader);
    }
    this._leader = leader;
  }

  private ShouldDeactivate(): boolean {
    if (this._leader && this.inst.sg.hasStateTag('busy')) return false;
    let closestleader: BerniePlayer | undefined, iscrazy = false;
    let rangesq = (FIND_LEADER_DIST * this.scale) ** 2;
    if (this._leader) {
      if (this._leader.position.distanceToSquared(this.inst.position) < (LOSE_LEADER_DIST * this.scale) ** 2 && this.inst.isleadercrazy(this._leader)) iscrazy = true;
      else this.SetLeader(undefined);
    }
    if (!this._leader) {
      for (const v of this.inst.getPlayers()) {
        if (!v.hasTag('bernieowner') || !(v.bigbernies === undefined || v.bigbernies.has(this.inst)) || !v.IsVisible()) continue;
        const d = v.position.distanceToSquared(this.inst.position);
        if (this.inst.isleadercrazy(v)) {
          if (d < (iscrazy ? rangesq : (FIND_LEADER_DIST * this.scale) ** 2)) { iscrazy = true; rangesq = d; closestleader = v; }
        } else if (!iscrazy && (v.components.sanity?.GetPercent() ?? 1) < FOLLOWER_SANITY_THRESHOLD && d < rangesq) {
          rangesq = d; closestleader = v;
        }
      }
      this.SetLeader(closestleader);
    }
    if (this.inst.should_shrink) {
      this.inst.should_shrink = undefined;
      return true;
    }
    if (iscrazy || this.inst.sg.hasStateTag('busy')) return false;
    return this.inst.GetTimeAlive() >= MIN_ACTIVE_TIME;
  }

  protected override OnStart(): void {
    const inst = this.inst;
    const root = new PriorityNode([
      IfNode(() => this.ShouldDeactivate(), 'No Leader', new ActionNode(() => inst.sg.goToState('deactivate'))),
    ], .2);
    this.bt = new BT(inst, root);
  }

  /** OnStop, and the onremove listener OnStart adds: the leader forgets this Bernie. */
  protected override OnStop(): void { this.SetLeader(undefined); }
}
