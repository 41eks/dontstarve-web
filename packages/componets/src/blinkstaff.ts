import * as THREE from 'three';
import type { LuaFn } from './luaFn';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';

/** TheWorld.Map as blinkstaff.lua and its componentactions entry read it. */
export interface BlinkStaffMap {
  isAboveGroundAtPoint(position: THREE.Vector3, allowWater: boolean): boolean;
  isPassableAtPoint(position: THREE.Vector3): boolean;
  isGroundTargetBlocked(position: THREE.Vector3): boolean;
}

/** TheWorld as the component reaches it: the map and SpawnPrefab for its fx. */
export interface BlinkStaffWorld {
  readonly map: BlinkStaffMap;
  spawnFx(prefab: string, position: THREE.Vector3): void;
}

/** The entity that blinks: Transform, Physics, SoundEmitter and its stategraph's statemem callbacks. */
export interface BlinkCaster {
  readonly position: ReadonlyVector3;
  readonly physics: { Teleport(): void };
  readonly components: {
    readonly health?: { SetInvincible(invincible: boolean): void };
    readonly sanity?: { DoDelta(delta: number): void };
    readonly staffsanity?: { doCastingDelta(delta: number): void };
  };
  readonly SoundEmitter?: { PlaySound(path: string): void };
  readonly sg?: {
    readonly stateName: string;
    readonly statemem: { onstartblinking?: () => void; onstopblinking?: () => void };
  };
  setPosition(x: number, y: number, z: number): void;
  Hide(): void;
  Show(): void;
  DoTaskInTime(time: number, fn: () => void): { Cancel(): void };
}

/** An entity with a transform, physics and tasks, as blinkstaff:Blink(pt, caster) moves. */
export function isBlinkCaster(caster: object): caster is BlinkCaster {
  return 'physics' in caster && 'setPosition' in caster && 'DoTaskInTime' in caster && 'Hide' in caster;
}

export interface BlinkStaffInst { readonly isRemoved: boolean }
/** blinkstaff.lua onblinkfn(inst, pt, caster). */
export type BlinkFn<Inst> = LuaFn<[inst: Inst, position: THREE.Vector3, caster: BlinkCaster]>;

/**
 * components/blinkstaff.lua: Blink hides the caster in its stategraph's quicktele state and Physics:Teleports it a
 * quarter second later, with the fx and sounds at both ends. IsTeleportingPermittedFromPointToPoint always permits:
 * no vault or wagpunk arena is ported. The DynamicShadow follows Hide / Show.
 */
export class BlinkStaff<Inst extends BlinkStaffInst = BlinkStaffInst> {
  onblinkfn?: BlinkFn<Inst>;
  blinktask?: { Cancel(): void };
  frontfx?: string;
  backfx?: string;
  presound = '';
  postsound = '';
  readonly inst: Inst;
  readonly world: BlinkStaffWorld;

  constructor(inst: Inst, world: BlinkStaffWorld) {
    this.inst = inst; this.world = world;
    this.ResetSoundFX();
  }

  SetFX(front?: string, back?: string): void { this.frontfx = front; this.backfx = back; }
  ResetSoundFX(): void {
    this.presound = 'dontstarve/common/staff_blink';
    this.postsound = 'dontstarve/common/staff_blink';
  }
  SetSoundFX(presound: string, postsound: string): void { this.presound = presound; this.postsound = postsound; }

  SpawnEffect(inst: BlinkCaster): void {
    const { x, y, z } = inst.position;
    if (this.backfx !== undefined) { this.world.spawnFx(this.backfx, new THREE.Vector3(x, y - .1, z)); }
    if (this.frontfx !== undefined) { this.world.spawnFx(this.frontfx, new THREE.Vector3(x, y, z)); }
  }

  Blink(pt: THREE.Vector3, caster: BlinkCaster): boolean {
    const { map } = this.world;
    if (this.inst.isRemoved || (caster.sg !== undefined && caster.sg.stateName !== 'quicktele')
      || !map.isPassableAtPoint(pt) || map.isGroundTargetBlocked(pt)) { return false; }
    this.blinktask?.Cancel();
    this.SpawnEffect(caster);
    if (this.presound) { caster.SoundEmitter?.PlaySound(this.presound); }
    if (caster.sg === undefined) {
      caster.Hide();
      caster.components.health?.SetInvincible(true);
    } else { caster.sg.statemem.onstartblinking?.(); }
    // DynamicPosition(pt): the point is kept as given.
    const dpt = pt.clone();
    this.blinktask = caster.DoTaskInTime(.25, () => OnBlinked(caster, this, dpt));
    this.onblinkfn?.(this.inst, pt, caster);
    return true;
  }
}

function OnBlinked(caster: BlinkCaster, self: BlinkStaff, pt: THREE.Vector3): void {
  if (caster.sg === undefined) {
    caster.Show();
    caster.components.health?.SetInvincible(false);
  } else { caster.sg.statemem.onstopblinking?.(); }
  const { map } = self.world;
  if (map.isPassableAtPoint(pt) && !map.isGroundTargetBlocked(pt)) {
    caster.setPosition(pt.x, pt.y, pt.z);
    caster.physics.Teleport();
  }
  self.SpawnEffect(caster);
  if (self.postsound) { caster.SoundEmitter?.PlaySound(self.postsound); }
}
