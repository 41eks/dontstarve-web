/** The persistent subset used by placement restoration. Models are never serialized. */
export interface PlacementSaveRecord {
  id: string;
  transform: { position: readonly [number, number, number]; rotationY: number };
  components: {
    /** An item inst's own state, as the inventory saves its stacks; the prefab's OnSave adds its own records. */
    stack?: import('@dontstarve-web/inventory').InventoryStack;
    phonograph?: { remainingSeconds: number };
    torch?: { lit: true };
    lantern?: { ison: boolean };
    flower?: import('./flower').FlowerSaveState;
    ruinsRelic?: import('./ruinsrelic').RuinsRelicSaveState;
    inventoryitemmoisture?: import('./ruinsrelic').RelicMoistureSave;
    pickable?: import('./components/pickable').PickableSaveState;
    witherable?: import('../../componets/src/witherable').WitherableSave;
    growable?: import('../../componets/src/growable').GrowableSave;
    plant?: import('./pickablePlant').PickablePlantRecord['components']['plant'];
    mushroom?: import('./pickablePlant').PickablePlantRecord['components']['mushroom'];
    variant?: import('./pickablePlant').PickablePlantRecord['components']['variant'];
    burning?: true;
    building?: { skinId?: string; burnt?: true };
    stewer?: import('../../componets/src/stewer').StewerSaveData;
    container?: { slotCount: number; slots: { slotKey: string; item: import('@dontstarve-web/inventory').InventoryStack }[] };
    health?: { current: number; maximum: number };
    knownlocations?: { locations: { name: string; x: number; y: number; z: number }[] };
    periodicspawner?: { time: number };
    beard?: import('../../componets/src/beard').BeardSave;
    /** A beefalo save from before its components saved themselves; it loads and is not written. */
    beefalo?: import('./beefalo').LegacyBeefaloSave;
    wall?: import('./wallSkins').WallSaveState;
    fence?: import('./fenceSkins').FenceSaveState;
    /** statueglommer.lua OnSave's worked / spawned. */
    statueglommer?: { worked?: true; spawned?: true };
    sculptingtable?: { itemname: string };
    birdcage?: import('./birdcage').BirdcageSaveStateData;
    workable?: { workleft: number; maxwork: number };
    /**
     * Records GetPersistData writes under the component's name. The prefabs that own these components fold them into
     * their own record and delete these before the save is written.
     */
    inventory?: import('@dontstarve-web/inventory').InventoryStack[];
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
    /** molehill.lua's inventory and spawner saves. */
    molehill?: import('./molehill').MolehillSave;
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
    /** The wormhole's skin. */
    wormhole?: import('./wormhole').WormholeSaveState;
    /** chessjunk.lua OnSave. */
    chessJunk?: import('./chessjunk').ChessJunkSaveState;
    /** chesspieces.lua onsave and submersible.lua OnSave. */
    chesspiece?: import('./chesspieces').ChesspieceSaveState;
    submersible?: import('./chesspieces').SubmersibleSaveState;
  };
}

/** Empties an OnSave's record in place, for a prefab that writes its whole record itself. */
export function clearPersistData(data: PlacementSaveRecord['components']): void {
  for (const key of Object.keys(data)) Reflect.deleteProperty(data, key);
}

/** A detached entity snapshot produced by the generic save loop. */
export interface PrefabSaveRecord extends PlacementSaveRecord {
  transform: { position: [number, number, number]; rotationY: number };
}

export interface PlacedEntitySaveRecord {
  prefabId: string;
  record: PlacementSaveRecord;
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
