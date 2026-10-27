import type { DragonflySaveState } from '@dontstarve-web/prefab/dragonfly';
import { array, fail, integer, number, object, string } from './validation';

/** dragonfly.lua OnSave plus component OnSave fields; keeps absent Lua nil fields absent. */
export function parseDragonflyState(value: unknown, path: string): DragonflySaveState {
  const data = object(value, path, ['playercombat', 'health', 'inventory', 'knownlocations', 'moisture',
    'rampingspawner', 'timer', 'sleeper', 'freezable', 'explosiveresist']);
  if (data.playercombat !== undefined && data.playercombat !== true) fail(`${path}.playercombat`, 'expected true');
  const health = object(data.health, `${path}.health`, ['health', 'penalty', 'maxhealth']);
  const maximum = health.maxhealth === undefined ? 27500 : number(health.maxhealth, `${path}.health.maxhealth`, 1);
  const inventory = object(data.inventory, `${path}.inventory`, ['items', 'equip', 'activeitem']);
  if (!inventory.items || typeof inventory.items !== 'object' || Array.isArray(inventory.items))
    fail(`${path}.inventory.items`, 'expected an object');
  if (!inventory.equip || typeof inventory.equip !== 'object' || Array.isArray(inventory.equip))
    fail(`${path}.inventory.equip`, 'expected an object');
  const items = object(inventory.items, `${path}.inventory.items`, Object.keys(inventory.items));
  const equip = object(inventory.equip, `${path}.inventory.equip`, Object.keys(inventory.equip));
  const moisture = object(data.moisture, `${path}.moisture`, ['moisture']);
  const ramping = object(data.rampingspawner, `${path}.rampingspawner`, ['current_wave', 'wave_num', 'spawning_on', 'spawns']);
  if (typeof ramping.spawning_on !== 'boolean') fail(`${path}.rampingspawner.spawning_on`, 'expected boolean');
  const state: DragonflySaveState = {
    ...(data.playercombat === true ? { playercombat: true } : {}),
    health: { health: number(health.health, `${path}.health.health`, 0, maximum),
      ...(health.penalty === undefined ? {} : { penalty: number(health.penalty, `${path}.health.penalty`, 0, 1) }),
      ...(health.maxhealth === undefined ? {} : { maxhealth: maximum }) },
    inventory: { items: structuredClone(items), equip: structuredClone(equip),
      ...(inventory.activeitem === undefined ? {} : { activeitem: structuredClone(inventory.activeitem) }) },
    moisture: { moisture: number(moisture.moisture, `${path}.moisture.moisture`, 0, 100) },
    rampingspawner: { current_wave: integer(ramping.current_wave, `${path}.rampingspawner.current_wave`, 0),
      wave_num: integer(ramping.wave_num, `${path}.rampingspawner.wave_num`, 0), spawning_on: ramping.spawning_on,
      ...(ramping.spawns === undefined ? {} : { spawns: array(ramping.spawns, `${path}.rampingspawner.spawns`, 100)
        .map((id, i) => integer(id, `${path}.rampingspawner.spawns[${i}]`, 1)) }) },
  };
  if (data.knownlocations !== undefined) {
    const locations = object(data.knownlocations, `${path}.knownlocations`, ['locations']);
    state.knownlocations = { locations: array(locations.locations, `${path}.knownlocations.locations`, 20).map((entry, i) => {
      const p = `${path}.knownlocations.locations[${i}]`, point = object(entry, p, ['name', 'x', 'y', 'z']);
      return { name: string(point.name, `${p}.name`), x: number(point.x, `${p}.x`, -1e6, 1e6),
        y: number(point.y, `${p}.y`, -1e6, 1e6), z: number(point.z, `${p}.z`, -1e6, 1e6) };
    }) };
  }
  if (data.timer !== undefined) {
    const timer = object(data.timer, `${path}.timer`, ['timers']);
    const timers = object(timer.timers, `${path}.timer.timers`, ['groundpound_cd']);
    const cooldown = object(timers.groundpound_cd, `${path}.timer.timers.groundpound_cd`, ['timeleft', 'paused', 'initial_time']);
    if (typeof cooldown.paused !== 'boolean') fail(`${path}.timer.timers.groundpound_cd.paused`, 'expected boolean');
    const initial_time = number(cooldown.initial_time, `${path}.timer.timers.groundpound_cd.initial_time`, 0);
    state.timer = { timers: { groundpound_cd: { timeleft: number(cooldown.timeleft,
      `${path}.timer.timers.groundpound_cd.timeleft`, 0, initial_time), paused: cooldown.paused, initial_time } } };
  }
  for (const key of ['sleeper', 'freezable'] as const) if (data[key] !== undefined) {
    const resist = object(data[key], `${path}.${key}`, ['extraresist']);
    state[key] = { extraresist: number(resist.extraresist, `${path}.${key}.extraresist`, 0) };
  }
  if (data.explosiveresist !== undefined) {
    const resist = object(data.explosiveresist, `${path}.explosiveresist`, ['resistance']);
    state.explosiveresist = { resistance: integer(resist.resistance, `${path}.explosiveresist.resistance`, 1, 100) };
  }
  return state;
}
