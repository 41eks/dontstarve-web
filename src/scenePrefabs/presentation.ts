import { WORLD_TILES, isLandTile } from '@dontstarve-web/prefab/turfMap';
import { staffCastingLightRegistration } from '@dontstarve-web/prefab/staff_castinglight';
import { staffLightRegistration } from '@dontstarve-web/prefab/stafflight';
import { ReskinEffects } from '@dontstarve-web/prefab/reskin_tool';
import { RainEffect } from '@dontstarve-web/prefab/rain';
import { SnowEffect } from '@dontstarve-web/prefab/snow';
import { OceanWaves } from '@dontstarve-web/prefab/ocean_waves';
import { WaveManager, type WaveMap } from '../../packages/componets/src/wavemanager';
import { WORLD_SCALE } from '../../packages/prefab/src/standardcomponents';
import { TILE_SIZE } from '../../packages/prefab/src/tile';
import { PREFAB_DEFINITIONS } from '../prefabDefinitions';
import { registerPrefabFamily, type ScenePrefabTarget } from './registry';
import type { ScenePrefabInputs } from './services';

export function registerReskinEffects(target: ScenePrefabTarget, { scene }: ScenePrefabInputs<'scene'>) {
  const { registry } = target;
  const reskinEffects = new ReskinEffects(scene);
  registry.register(PREFAB_DEFINITIONS.reskinEffects, {
    exportRecords: () => [],
    update: dt => reskinEffects.update(dt),
    renderEntities: () => reskinEffects.renderEntities,
    dispose: () => reskinEffects.dispose(),
  });
  return reskinEffects;
}

export function registerRain(
  target: ScenePrefabTarget,
  { worldState, camera, player, scene }: ScenePrefabInputs<'worldState' | 'camera' | 'player' | 'scene'>,
) {
  const { registry } = target;
  const rain = new RainEffect({
    scene,
    dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
    animationBaseUrl: `${import.meta.env.BASE_URL}dst/data/anim`,
    getFocus: () => player.position,
    camera,
    rate: worldState.weather.rainRate,
  });
  registry.register(PREFAB_DEFINITIONS.rain, {
    exportRecords: () => [],
    update: (dt, quaternion) => rain.update(dt, quaternion),
    renderEntities: () => rain.renderEntities,
    dispose: () => rain.dispose(),
  });
}

export function registerSnow(
  target: ScenePrefabTarget,
  {
    worldState,
    groundDisplay,
    camera,
    player,
    scene,
  }: ScenePrefabInputs<'worldState' | 'groundDisplay' | 'camera' | 'player' | 'scene'>,
) {
  const { registry } = target;
  const snow = new SnowEffect({
    scene,
    dataBaseUrl: `${import.meta.env.BASE_URL}dst/data`,
    getFocus: () => player.position,
    camera,
    rate: worldState.weather.snowRate,
    cover: worldState.weather.snowCover,
    groundOverlay: groundDisplay,
  });
  registry.register(PREFAB_DEFINITIONS.snow, {
    exportRecords: () => [],
    update: (dt, quaternion) => snow.update(dt, quaternion),
    dispose: () => snow.dispose(),
  });
}

export function registerOceanWaves(
  target: ScenePrefabTarget,
  {
    worldState,
    turfMap,
    followCamera,
    player,
    scene,
  }: ScenePrefabInputs<'worldState' | 'turfMap' | 'followCamera' | 'player' | 'scene'>,
) {
  const { registry } = target;
  // The only ocean tile is OCEAN_COASTAL; INVALID (outside the map) is neither land nor water.
  const waveMap: WaveMap = {
    tileSize: TILE_SIZE,
    tileAt: (x, z) => turfMap.getTileAtWorld({ x, z }),
    isLandTile,
    isOceanTile: tile => tile === WORLD_TILES.OCEAN_COASTAL,
  };
  const oceanWaves = new OceanWaves(scene, waveMap, WORLD_SCALE, worldState.tickingarea);
  const waveManager = new WaveManager({
    map: waveMap,
    spawner: oceanWaves,
    scale: WORLD_SCALE,
    tiles: new Map([[WORLD_TILES.OCEAN_COASTAL, 'shore']]),
    cameraDistance: () => followCamera.getDistance() / WORLD_SCALE,
    playerPosition: () => player.position,
  });
  registry.register(PREFAB_DEFINITIONS.oceanWaves, {
    exportRecords: () => [],
    update: (dt, quaternion) => {
      waveManager.OnUpdate(dt);
      oceanWaves.update(dt, quaternion);
    },
    dispose: () => oceanWaves.dispose(),
  });
}

export function registerStaffLights(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  registerPrefabFamily(target, staffLightRegistration, {
    scheduler: worldState.scheduler,
    tickingarea: worldState.tickingarea,
    getWatchWorldContent: worldState.getWatchWorldContent,
  });
}

/** No renderEntities: these prefabs have nothing to draw, only a light their displays list. */
export function registerStaffCastingLights(target: ScenePrefabTarget, { worldState }: ScenePrefabInputs<'worldState'>) {
  registerPrefabFamily(target, staffCastingLightRegistration, {
    scheduler: worldState.scheduler,
    tickingarea: worldState.tickingarea,
  });
}
