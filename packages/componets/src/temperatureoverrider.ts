/** tuning.lua OVERHEAT_TEMP. */
export const OVERHEAT_TEMP = 70;

/**
 * temperatureoverrider.lua GetTemperatureAtXZ. The overrider registry and fumarolelocaltemperature
 * are not ported yet, so every position resolves to its final fallback, TheWorld.state.temperature.
 */
export function GetTemperatureAtXZ(worldTemperature: () => number, _x: number, _z: number): number {
  return worldTemperature();
}
