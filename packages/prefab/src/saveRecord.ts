/** The persistent subset used by placement restoration. Models are never serialized. */
export interface PlacementSaveRecord {
  id: string;
  transform: { position: readonly [number, number, number]; rotationY: number };
  components: {
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
    stewer?: import('./cook_pot').CookPotSaveState;
    container?: { slotCount: number; slots: { slotKey: string; item: import('@dontstarve-web/inventory').InventoryStack }[] };
    health?: { current: number; maximum: number };
    wall?: import('./wallSkins').WallSaveState;
    fence?: import('./fenceSkins').FenceSaveState;
    sculptingtable?: { itemname: string };
    birdcage?: import('./birdcage').BirdcageSaveStateData;
    workable?: { workleft: number; maxwork: number };
    timer?: import('../../componets/src/timer').NamedTimerSave;
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
  };
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
