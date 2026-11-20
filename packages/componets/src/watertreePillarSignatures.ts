/** Constructor signatures for watertree_pillar.lua's components outside this task's display/save scope. */
/** waterphysics.lua, from MakeWaterObstaclePhysics; its restitution is not set. */
export class WaterPhysics {
  constructor(_inst: object) {}
}
/** distancefade.lua; Setup(15, 25) is not called. */
export class DistanceFade {
  constructor(_inst: object) {}
}
/** canopyshadows.lua; its range is not set. */
export class CanopyShadows {
  constructor(_inst: object) {}
}
/** canopylightrays.lua; its range is not set. */
export class CanopyLightRays {
  constructor(_inst: object) {}
}
/** lightningblocker.lua; SetBlockRange and SetOnLightningStrike are not called. */
export class LightningBlocker {
  constructor(_inst: object) {}
}
export { WorldSettingsTimer } from './atriumGateSignatures';
