import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';

const step = (module, name, { args = 'target, services', result } = {}) => ({
  from: `./scenePrefabs/${module}`,
  name,
  source: `${result ? `const ${result} = ` : ''}${name}(${args});`,
});

const family = (module, name, args) => ({
  from: `@dontstarve-web/prefab/${module}`,
  name,
  source: `registerPrefabFamily(target, ${name}${args ? `, ${args}` : ''});`,
});

// Construction order. The registry separately controls frame callbacks and disposal order.
const steps = [
  step('buildings', 'registerBuildings', { result: 'buildingPlacement' }),
  step('presentation', 'registerReskinEffects', { result: 'reskinEffects' }),
  step('plants', 'registerFlowers'),
  family('world_fx', 'worldFxRegistration', '{ scheduler: services.worldState.scheduler }'),
  family(
    'staff_projectile',
    'staffProjectileRegistration',
    '{ fx: services.worldFx, componentUpdates: services.worldState.componentUpdates }',
  ),
  step('creatures', 'registerMolehills', { result: 'moleWorld' }),
  step('creatures', 'registerLightFlierFlowers', { args: 'target, services, retain', result: 'lightflierWorld' }),
  // The item factories use these habitats and share BernieWorld with the active forms.
  step('items', 'createBernieWorld', { result: 'bernieWorld' }),
  step('plants', 'prepareFarmMap', { args: 'target, services, retain', result: 'farmMap' }),
  step('items', 'registerItems', {
    args: 'target, services, { moleWorld, lightflierWorld, bernieWorld }, farmMap, reskinEffects',
  }),
  step('presentation', 'registerStaffLights'),
  step('presentation', 'registerStaffCastingLights'),
  step('plants', 'registerBulbPlants'),
  step('terrain', 'registerStalagmites'),
  step('terrain', 'registerRocks'),
  step('terrain', 'registerMoonglassRocks'),
  step('terrain', 'registerCaveHoles'),
  family('pillar', 'pillarRegistration'),
  family('atrium_pillar', 'atriumPillarRegistration'),
  family('archive_pillar', 'archivePillarRegistration'),
  step('terrain', 'registerVaultPillars', { args: 'target' }),
  family('monkeypillar', 'monkeyPillarRegistration', '{ scheduler: services.worldState.scheduler }'),
  step('terrain', 'registerCaveEntrances'),
  step('terrain', 'registerCaveExits'),
  step('terrain', 'registerGrottoPools'),
  step('plants', 'registerMushtrees'),
  step('plants', 'registerMushroomPlants'),
  step('plants', 'registerMarbleShrubs'),
  step('buildings', 'registerArchiveProps'),
  step('buildings', 'registerSkeletons'),
  step('buildings', 'registerHoundbones'),
  step('creatures', 'registerBeeQueenHives'),
  step('creatures', 'registerDragonflies'),
  step('creatures', 'registerDragonflySpawners'),
  step('plants', 'registerMarbleBeanSaplings'),
  step('plants', 'registerRockAvocadoBushes'),
  step('plants', 'registerRockAvocadoSaplings'),
  step('plants', 'registerBerrybushes'),
  step('plants', 'registerMonkeytails'),
  step('plants', 'registerGrasses'),
  step('plants', 'registerSaplings'),
  step('plants', 'registerCaveFerns'),
  step('plants', 'registerLichens'),
  step('plants', 'registerCacti'),
  step('terrain', 'registerLavaPonds'),
  step('plants', 'registerTumbleweeds'),
  step('terrain', 'registerHotsprings'),
  step('terrain', 'registerWormholes'),
  step('terrain', 'registerPortals'),
  step('terrain', 'registerNightmareGrowths'),
  step('creatures', 'registerBeefalos'),
  step('creatures', 'registerLightningGoats'),
  step('creatures', 'registerStagehand'),
  step('plants', 'registerLivingTrees'),
  step('plants', 'registerEvergreens'),
  step('plants', 'registerDeciduousTrees'),
  step('plants', 'registerFarm', { args: 'target, services, farmMap' }),
  step('plants', 'registerMoonTrees'),
  step('buildings', 'registerPigKings'),
  family('bernie', 'bernieRegistration', 'bernieWorld'),
  family('statueglommer', 'statueGlommerRegistration', '{ scheduler: services.worldState.scheduler }'),
  step('terrain', 'registerMoonFissures'),
  step('terrain', 'registerWatertreePillars'),
  step('plants', 'registerOceanTrees'),
  step('terrain', 'registerOceanTreePillars'),
  family(
    'oceanvine',
    'oceanVineRegistration',
    '{ scheduler: services.worldState.scheduler, getWatchWorldContent: services.worldState.getWatchWorldContent }',
  ),
  family(
    'reeds',
    'reedsRegistration',
    '{ scheduler: services.worldState.scheduler, getWatchWorldContent: services.worldState.getWatchWorldContent }',
  ),
  step('terrain', 'registerMastMalbatross'),
  family('support_pillar', 'supportPillarRegistration'),
  family('oasislake', 'oasislakeRegistration', '{ scheduler: services.worldState.scheduler }'),
  family(
    'beehive',
    'beehiveRegistration',
    '{ scheduler: services.worldState.scheduler, getWatchWorldContent: services.worldState.getWatchWorldContent, fx: services.worldFx }',
  ),
  family('shadow_forge', 'shadowForgeRegistration', '{ scheduler: services.worldState.scheduler }'),
  family(
    'spiderden',
    'spiderdenRegistration',
    '{ scheduler: services.worldState.scheduler, getWatchWorldContent: services.worldState.getWatchWorldContent }',
  ),
  family('seastack', 'seastackRegistration', '{ scheduler: services.worldState.scheduler }'),
  family(
    'wasphive',
    'wasphiveRegistration',
    '{ scheduler: services.worldState.scheduler, getWatchWorldContent: services.worldState.getWatchWorldContent }',
  ),
  family('oceanvine_deco', 'oceanVineDecoRegistration'),
  step('buildings', 'registerAtriumGate'),
  family('ruins_statue_mage', 'ruinsStatueRegistration', '{ scheduler: services.worldState.scheduler }'),
  step('buildings', 'registerRuinsRelics'),
  family('atrium_statue', 'atriumStatueRegistration'),
  family('atrium_overgrowth', 'atriumOvergrowthRegistration'),
  family('atrium_rubble', 'atriumRubbleRegistration', '{ scheduler: services.worldState.scheduler }'),
  step('buildings', 'registerChessJunk'),
  step('buildings', 'registerChesspieces'),
  family('archive_centipede', 'archiveCentipedeHuskRegistration', '{ scheduler: services.worldState.scheduler }'),
  step('plants', 'registerMarshPlants'),
  step('terrain', 'registerPonds'),
  step('terrain', 'registerNightmareRocks'),
  step('presentation', 'registerRain'),
  step('presentation', 'registerSnow'),
  step('presentation', 'registerOceanWaves'),
];

const imports = new Map();
for (const { from, name } of steps) {
  const names = imports.get(from) ?? new Set();
  names.add(name);
  imports.set(from, names);
}

const output = fileURLToPath(new URL('../src/scenePrefabs.generated.ts', import.meta.url));
const source = await format(
  [
    '// Generated by scripts/generate-scene-prefabs.mjs.',
    "import { PREFAB_DEFINITIONS } from './prefabDefinitions';",
    "import { registerPrefabFamily, type ScenePrefabTarget } from './scenePrefabs/registry';",
    "import type { ScenePrefabServices } from './scenePrefabs/services';",
    ...Array.from(imports, ([from, names]) => `import { ${[...names].join(', ')} } from '${from}';`),
    '',
    'export function registerScenePrefabs(',
    '  target: ScenePrefabTarget,',
    '  services: ScenePrefabServices,',
    '  retain: (dispose: () => void) => void,',
    ') {',
    ...steps.map(({ source }) => `  ${source}`),
    '  target.registry.assertDefinitions(Object.values(PREFAB_DEFINITIONS));',
    '  return { buildingPlacement, reskinEffects, farmMap };',
    '}',
    '',
  ].join('\n'),
  { ...(await resolveConfig(output)), filepath: output },
);

if (process.argv.includes('--check')) {
  const current = await readFile(output, 'utf8').catch(error => {
    if (error.code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
  if (current !== source) {
    console.error('src/scenePrefabs.generated.ts is out of date. Run pnpm generate:scene-prefabs.');
    process.exitCode = 1;
  }
} else {
  await writeFile(output, source);
}
