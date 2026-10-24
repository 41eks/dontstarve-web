export interface BlowInWindInst {
  /** Transform:SetRotation in degrees; forward is (cos, -sin). */
  setRotation(degrees: number): void;
}
export interface BlowInWindLocomotor { walkspeed: number; WalkForward(direct?: boolean): void; }

const SPEED_VAR_PERIOD = 5;
const SPEED_VAR_PERIOD_VARIANCE = 2;
const DEGREES = Math.PI / 180;
/** simutil.lua Remap. */
const remap = (value: number, from1: number, to1: number, from2: number, to2: number) =>
  (value - from1) / (to1 - from1) * (to2 - from2) + from2;

/**
 * blowinwind.lua. Angles given to Start/ChangeDirection are radians; the unit vector accumulates into
 * `velocity` and the locomotor walks along the rotation it implies. Speeds are in the host's units.
 */
export class BlowInWind {
  maxSpeedMult = 1.5;
  minSpeedMult = .5;
  averageSpeed: number;
  speed = 0;
  windAngle = 0;
  windVector = { x: 0, z: 0 };
  currentAngle = 0;
  velocity = { x: 0, z: 0 };
  velocMult?: number;
  private speedVarTime = 0;
  private speedVarPeriod: number;
  private updating = false;
  private readonly inst: BlowInWindInst;
  private readonly locomotor: BlowInWindLocomotor | undefined;
  private readonly random: () => number;

  constructor(inst: BlowInWindInst, averageSpeed: number, locomotor?: BlowInWindLocomotor, random: () => number = Math.random) {
    this.inst = inst; this.averageSpeed = averageSpeed; this.locomotor = locomotor; this.random = random;
    this.speedVarPeriod = this.randomWithVariance(SPEED_VAR_PERIOD, SPEED_VAR_PERIOD_VARIANCE);
  }
  /** simutil.lua GetRandomWithVariance. */
  private randomWithVariance(base: number, variance: number): number { return base + this.random() * 2 * variance - variance; }

  get isUpdating(): boolean { return this.updating; }
  OnEntitySleep(): void { this.Stop(); }
  OnEntityWake(): void { this.Start(this.windAngle, this.velocMult); }

  Start(ang?: number, vel?: number): void {
    if (ang !== undefined) {
      this.windAngle = ang;
      this.windVector = { x: Math.cos(ang), z: Math.sin(ang) };
      this.currentAngle = ang;
      this.inst.setRotation(this.currentAngle);
    }
    if (vel !== undefined) this.velocMult = vel;
    this.updating = true;
  }
  Stop(): void { this.updating = false; }
  ChangeDirection(ang?: number, _vel?: number): void {
    if (ang !== undefined) {
      this.windAngle = ang;
      this.windVector = { x: Math.cos(ang), z: Math.sin(ang) };
    }
  }
  SetMaxSpeedMult(speed?: number): void { if (speed !== undefined) this.maxSpeedMult = speed; }
  SetMinSpeedMult(speed?: number): void { if (speed !== undefined) this.minSpeedMult = speed; }
  SetAverageSpeed(speed?: number): void { if (speed !== undefined) this.averageSpeed = speed; }
  GetSpeed(): number { return this.speed; }
  GetVelocity(): { x: number; z: number } { return this.velocity; }

  Update(dt: number): void {
    if (!this.updating) return;
    let vx = this.velocity.x + this.windVector.x * dt, vz = this.velocity.z + this.windVector.z * dt;
    let length = Math.hypot(vx, vz);
    if (length > 1) { vx /= length; vz /= length; length = 1; }
    this.velocity = { x: vx, z: vz };
    this.speed = remap(length, 0, 1, 0, this.averageSpeed);
    // Vary the speed once the velocity is a reasonable amount.
    if (length >= .5) {
      this.speedVarTime += dt;
      if (this.speedVarTime > SPEED_VAR_PERIOD) {
        this.speedVarTime = 0;
        this.speedVarPeriod = this.randomWithVariance(SPEED_VAR_PERIOD, SPEED_VAR_PERIOD_VARIANCE);
      }
      const speedvar = Math.sin(2 * Math.PI * (this.speedVarTime / this.speedVarPeriod));
      this.speed *= remap(speedvar, -1, 1, this.minSpeedMult, this.maxSpeedMult);
    }
    if (this.locomotor) {
      this.locomotor.walkspeed = this.speed;
      this.currentAngle = Math.atan2(this.velocity.z, this.velocity.x) / DEGREES;
      this.inst.setRotation(this.currentAngle);
      this.locomotor.WalkForward(true);
    }
  }
  dispose(): void { this.Stop(); }
}
