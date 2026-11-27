/** Where a saved entity stands: its ground position (y = 0 unless an item lies on something) and its facing. */
export interface SavedTransform {
  position: [number, number, number];
  rotationY: number;
}

/**
 * An entity's identity and its GetPersistData / SetPersistData record: what any save keeps of an entity, whether it
 * stands in the world or is held in a container.
 */
export interface EntityPersistRecord {
  id: string;
  components: EntityPersistData;
}

/**
 * One entry of a save's `world.entities[prefab]`, GetSaveRecord's record: written by import-dst-region.py from a DST
 * snapshot's `ents[prefab]` entry (its x / z and data) and by PrefabEntityManager.exportRecords, and placed back by
 * PrefabEntityManager.restore, SpawnSaveRecord. Models are never serialized.
 */
export interface EntitySaveRecord extends EntityPersistRecord {
  transform: SavedTransform;
  /** EntityScript:GetSaveRecord's record.skinname: the entity's skin, applied before its data loads. */
  skinname?: string;
}

/**
 * GetSaveRecord of an entity another one holds, as container.lua and inventory.lua save each item: the prefab, the
 * skin and GetPersistData, without a position. The ID keeps the inst's identity across saves.
 */
export interface HeldEntityRecord extends EntityPersistRecord {
  prefab: string;
  skinname?: string;
}

/** container.lua / inventory.lua OnSave's data.items: each held item's record by its one-based slot. */
export interface SlotItemsSave {
  items: { [slot: string]: HeldEntityRecord };
}

/** inventory.lua OnSave of a player: items by slot, equip by equip slot, and the cursor's activeitem. */
export interface PlayerInventorySave extends SlotItemsSave {
  equip: { [equipslot: string]: HeldEntityRecord };
  activeitem?: HeldEntityRecord;
}

/** GetPersistData's record: each component's and the prefab OnSave's data, under the name it saves as. */
export interface EntityPersistData {
  /**
   * SpawnPrefab of an item from the inventory's runtime stack (a split, a craft, a drop): not a save record. Saves hold
   * the item's component records below instead.
   */
  stack?: import('@dontstarve-web/inventory').InventoryStack;
  /** stackable.lua OnSave: written for a stack of more than one. */
  stackable?: { stack: number };
  /** perishable.lua OnSave: perishremainingtime, and whether perishing is stopped. */
  perishable?: { time: number; paused?: true };
  armor?: import('../../componets/src/armor').ArmorSaveData;
  temperature?: import('../../componets/src/temperature').TemperatureSaveData;
  /** machine.lua OnSave. */
  machine?: { ison: boolean };
  /** heatrock.lua OnSave: the temperature extreme it last reached. */
  highTemp?: number;
  lowTemp?: number;
  /** mole.lua OnSave: seconds since it began needing a home. */
  needs_home_time?: number;
  /** The drawn branch of an item's ground art, which its prefab derives from its own saved fields (anim, glassname, …). */
  groundVariant?: string;
  phonograph?: { remainingSeconds: number };
  torch?: { lit: true };
  flower?: import('./flower').FlowerSaveState;
  ruinsRelic?: import('./ruinsrelic').RuinsRelicSaveState;
  inventoryitemmoisture?: import('./ruinsrelic').RelicMoistureSave;
  pickable?: import('./components/pickable').PickableSaveState;
  witherable?: import('../../componets/src/witherable').WitherableSave;
  growable?: import('../../componets/src/growable').GrowableSave;
  /** mushrooms.lua OnSave: the rain days left before a picked mushroom regrows. */
  mushroom?: { rain: number };
  /** cave_fern.lua OnSave: data.anim, the chosen pose clip. */
  variant?: { anim: string };
  /** rock_avocado_bush.lua on_save: data.burning. */
  burning?: true;
  building?: { burnt?: true };
  /** savedrotation.lua OnSave: Transform:GetRotation in degrees, written when it is not 0. */
  savedrotation?: import('../../componets/src/savedrotation').SavedRotationSaveData;
  stewer?: import('../../componets/src/stewer').StewerSaveData;
  container?: SlotItemsSave;
  /** health.lua OnSave, or a structure's own { current, maximum } record (relics, walls). */
  health?: { current: number; maximum: number } | import('../../componets/src/health').HealthSaveData;
  knownlocations?: { locations: { name: string; x: number; y: number; z: number }[] };
  periodicspawner?: { time: number };
  beard?: import('../../componets/src/beard').BeardSave;
  /** A beefalo save from before its components saved themselves; it loads and is not written. */
  beefalo?: import('./beefalo').LegacyBeefaloSave;
  fence?: import('./fenceSkins').FenceSaveState;
  /** statueglommer.lua OnSave's worked / spawned. */
  statueglommer?: { worked?: true; spawned?: true };
  sculptingtable?: { itemname: string };
  /** birdcage.lua OnSave. */
  CAGE_STATE?: import('./birdcage').CageState;
  bird_type?: string;
  occupiable?: import('./birdcage').OccupiableSave;
  livingtree?: { stump?: true; burnt?: true };
  lunarhailbuildup?: import('../../componets/src/lunarhailbuildup').LunarHailBuildupSaveData;
  workable?: { workleft: number; maxwork?: number };
  /** seastack.lua OnSave: the stack shape (1..5) and the powder-monkey tint. */
  stackid?: number;
  tinted?: boolean;
  /** inventory.lua OnSave of a creature or a machine that holds items. */
  inventory?: SlotItemsSave;
  childspawner?: import('../../componets/src/childspawner').ChildSpawnerSave;
  fueled?: import('../../componets/src/fueled').FueledSave;
  timer?: import('../../componets/src/timer').NamedTimerSave;
  /** beequeenhive.lua's timer component save. */
  beeQueenHiveTimer?: import('../../componets/src/timer').NamedTimerSave;
  fishable?: import('../../componets/src/fishable').FishableSave;
  /** pond.lua's inst.plants: offsets from the pond, in DST units. */
  plants?: { offset: [number, number, number] }[];
  finiteuses?: { uses: number };
  moonbase?: import('./moonbase').MoonbaseSaveState;
  lightningrod?: import('./lightning_rod').LightningRodSaveState;
  lightninggoat?: import('./lightninggoat').LightningGoatSaveState;
  firepit?: import('./firepit').FirePitSaveState;
  evergreen?: import('./evergreens').EvergreenSaveState;
  evergreenTimer?: import('../../componets/src/timer').NamedTimerSave;
  deciduoustree?: import('./deciduousTreeLeaves').DeciduousTreeSave;
  deciduousTimer?: import('../../componets/src/timer').NamedTimerSave;
  moonTree?: import('./moontree').MoonTreeSaveState;
  moonTreeTimer?: import('../../componets/src/timer').NamedTimerSave;
  saplingTimer?: import('../../componets/src/timer').NamedTimerSave;
  /** cave_hole.lua OnSave: data.allowspawn. */
  allowspawn?: boolean;
  /** archive_pillar.lua OnSave: data.broken (a boolean); vault_pillar.lua OnSave: data.broken (1). */
  broken?: boolean | 1;
  /** vault_pillar.lua OnSave: data.capped. */
  capped?: 1 | 2;
  /** vault_pillar.lua OnLoad: world generation's data.random, never saved back. */
  random?: true;
  /** monkeypillar.lua OnSave: data.pillar_id, a number from a world save or the string math.random made. */
  pillar_id?: import('./monkeypillar').MonkeyPillarId;
  /** atrium_fence.lua OnSave: the shape chosen on spawn. */
  fenceid?: number;
  /** atrium_gate.lua OnSave and its components' records. */
  atriumGate?: import('./atrium_gate').AtriumGateSaveState;
  charliecutscene?: import('../../componets/src/atriumGateSignatures').CharlieCutsceneSave;
  worldsettingstimer?: import('../../componets/src/atriumGateSignatures').WorldSettingsTimerSave;
  entitytracker?: import('../../componets/src/atriumGateSignatures').EntityTrackerSave;
  /** statueruins.lua onsave: data.gem. */
  ruinsStatueMage?: import('./ruins_statue_mage').RuinsStatueSaveState;
  /** houndbone.lua onsave: data.bonetype. */
  houndbone?: import('./houndbone').HoundboneSaveState;
  /** dragonfly_spawner's childspawner and worldsettingstimer records. */
  dragonflySpawner?: import('./dragonfly_spawner').DragonflySpawnerSaveState;
  /** dragonfly.lua's component records, nested under one field. */
  dragonfly?: import('./dragonfly').DragonflySaveState;
  /** rocks.lua on_save_moonglass: data.rock_type. */
  rock_type?: import('./rocks').MoonglassRockType;
  /** archive_props.lua OnSave: the statues' data.anim and the rune statues' data.storyprogress. */
  archiveProp?: import('./archive_props').ArchivePropSaveState;
  /** marbleshrub.lua onsave: shapenumber (when not 1) and color. */
  marbleShrub?: import('./marbleshrub').MarbleShrubSaveState;
  /** flower_cave.lua OnSave's light_state and plantname, with the pickable state and the light timer. */
  bulbPlant?: import('./bulb_plant').BulbPlantSaveState;
  /** grotto_pool_big.lua / grotto_pool_small.lua on_save. */
  grottoPool?: import('./grotto_pool').GrottoPoolSaveState;
  /** The grotto props' workable.savestate. */
  grottoGlass?: import('./grotto_pool').GrottoGlassSaveState;
  /** mushtree.lua onsave: stump, burnt, treestate, and the stump's decay timer. */
  mushtree?: import('./mushtree').MushtreeSaveState;
  /** skeleton.lua OnSave / Player_OnSave. */
  skeleton?: import('./skeleton').SkeletonSaveState;
  /** hotspring.lua OnSave. */
  hotspring?: import('./hotspring').HotspringSaveState;
  /** lava_pond.lua OnSave. */
  lavaPond?: import('./lava_pond').LavaPondSaveState;
  /** nightmaregrowth.lua OnSave's crack_rotation. */
  nightmareGrowth?: import('./nightmaregrowth').NightmareGrowthSaveState;
  spawner?: import('./molehill').SpawnerSave;
  caveinBoulder?: import('./cavein_boulder').CaveinBoulderSave;
  /** farm_plow.lua's drilling timer and deploy_item, farm_soil.lua and farm_soil_debris.lua OnSave. */
  farmPlow?: import('./farm_plow').FarmPlowSaveState;
  farmSoil?: import('./farm_plow').FarmSoilSaveState;
  farmDebris?: import('./farm_plow').FarmDebrisSaveState;
  /** lightflier_flower.lua onsave_single, with its pickable, childspawner and timer. */
  lightflierFlower?: import('./lightflier_flower').LightFlierFlowerSave;
  /** watertree_pillar.lua OnSave, with its childspawner and timer records. */
  watertreePillar?: import('./watertree_pillar').WatertreePillarSaveState;
  /** oceantree.lua onsave. */
  oceantree?: import('./oceantree').OceanTreeSaveState;
  /** atrium_overgrowth.lua rune_onsave. */
  atriumOvergrowth?: import('./atrium_overgrowth').AtriumOvergrowthSaveState;
  /** mast.lua onsave of mast_malbatross, and its skin. */
  mastMalbatross?: import('./mast_malbatross').MastMalbatrossSaveState;
  upgradeable?: import('../../componets/src/upgradeable').UpgradeableSave;
  /** support_pillar.lua OnSave, and constructionsite:OnSave. */
  supportPillar?: import('./support_pillar').SupportPillarSaveState;
  /** oasislake.lua OnSave: data.regrowth. */
  oasislake?: import('./oasislake').OasislakeSaveState;
  constructionsite?: import('../../componets/src/constructionsite').ConstructionSiteSave;
  /** oceantree_pillar.lua OnSave. */
  oceantreePillar?: import('./oceantree_pillar').OceanTreePillarSaveState;
  /** oceanvine_deco.lua onsave: data.animnum, the idle_N clip. */
  animnum?: import('./oceanvine_deco').OceanVineDecoAnimNum;
  /** The wormhole's skin. */
  /** chessjunk.lua OnSave. */
  chessJunk?: import('./chessjunk').ChessJunkSaveState;
  /** chesspieces.lua onsave and submersible.lua OnSave. */
  chesspiece?: import('./chesspieces').ChesspieceSaveState;
  submersible?: import('./chesspieces').SubmersibleSaveState;
}

/** A structure's own { current, maximum } health record, as relics, walls, hives and Bernie save it. */
export function structureHealth(data: EntityPersistData): { current: number; maximum: number } | undefined {
  const health = data.health;
  return health && 'current' in health ? health : undefined;
}

/** Empties an OnSave's record in place, for a prefab that writes its whole record itself. */
export function clearPersistData(data: EntityPersistData): void {
  for (const key of Object.keys(data)) {
    Reflect.deleteProperty(data, key);
  }
}

/** Removes the sprite's visual offset and flat-ground raycast rounding residue. */
export function saveGroundPosition(
  position: { x: number; y: number; z: number },
  visualOffset: number,
): [number, number, number] {
  const height = position.y - visualOffset;
  return [position.x, Math.abs(height) < 1e-6 ? 0 : height, position.z];
}

export { newItemEntityId as newEntityId } from '@dontstarve-web/inventory';
