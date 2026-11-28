"""Source Lua tables consumed by the DST landmark converters."""

from functools import lru_cache
from typing import Annotated, Literal

from pydantic import AfterValidator, BeforeValidator, Field, JsonValue, TypeAdapter
from typing_extensions import NotRequired, TypedDict

from dst_save_schema import Number, Position, TrueFlag, strict_bool, strict_int

NonnegativeNumber = Annotated[Number, Field(ge=0)]
PositiveNumber = Annotated[Number, Field(gt=0)]
UnitNumber = Annotated[Number, Field(ge=0, le=1)]
NonnegativeInt = Annotated[int, Field(ge=0)]
PositiveInt = Annotated[int, Field(ge=1)]
FalseFlag = Annotated[Literal[False], BeforeValidator(strict_bool.validate_python)]
StoryProgress = Annotated[int, Field(ge=1, le=5)]
SpiderStage = Annotated[int, Field(ge=1, le=3)]
SpawnTimerName = Literal['ChildSpawner_SpawnPeriod', 'ChildSpawner_RegenPeriod']


@lru_cache(maxsize=32)
def count_range(maximum: int) -> TypeAdapter[int]:
    return TypeAdapter(Annotated[int, Field(ge=0, le=maximum)])


@lru_cache(maxsize=32)
def number_range(maximum: Number) -> TypeAdapter[Number]:
    return TypeAdapter(Annotated[Number, Field(ge=0, le=maximum)])


class HealthRange(TypedDict):
    current: NonnegativeNumber
    maximum: PositiveNumber


def _ordered_health(health: HealthRange) -> HealthRange:
    if health['current'] > health['maximum']:
        raise ValueError('current health exceeds maximum health')
    return health


HEALTH_RANGE: TypeAdapter[HealthRange] = TypeAdapter(Annotated[HealthRange, AfterValidator(_ordered_health)])


class EmptyTable(TypedDict):
    pass


class SourceHealth(TypedDict):
    health: NonnegativeNumber


class HailBuildup(TypedDict, total=False):
    workleft: Annotated[Number, Field(ge=0, le=2)]
    buildupcurrent: UnitNumber


class Stagehand(TypedDict, total=False):
    workable: EmptyTable
    lunarhailbuildup: HailBuildup


def _nonzero_rotation(rotation: Number) -> Number:
    if rotation == 0:
        raise ValueError('saved rotation must be nonzero')
    return rotation


class SavedRotation(TypedDict):
    rotation: Annotated[Number, Field(ge=-180, le=180), AfterValidator(_nonzero_rotation)]


class WoodChair(TypedDict, total=False):
    burnt: TrueFlag
    savedrotation: SavedRotation


class ResearchLab(TypedDict, total=False):
    burnt: TrueFlag
    workable: EmptyTable


class MoonbaseWork(TypedDict, total=False):
    maxwork: Annotated[Number, Field(ge=6, le=6)]
    workleft: Annotated[Number, Field(ge=0, le=6)]


class MoonbasePickable(TypedDict, total=False):
    picked: TrueFlag
    paused: TrueFlag
    caninteractwith: TrueFlag
    time: Annotated[Number, Field(ge=0, le=1000000)]
    pause_time: Annotated[Number, Field(ge=0, le=1000000)]


class TimerEntry(TypedDict):
    timeleft: NonnegativeNumber
    paused: bool
    initial_time: NonnegativeNumber


def _ordered_times(entry: TimerEntry) -> TimerEntry:
    if entry['timeleft'] > entry['initial_time']:
        raise ValueError('remaining time exceeds initial time')
    return entry


OrderedTimer = Annotated[TimerEntry, AfterValidator(_ordered_times)]
MoonbaseTimerName = Literal['fullmoonstartdelay', 'moonchargepre', 'mooncharge', 'mooncharge2', 'mooncharge3']


class MoonbaseTimer(TypedDict):
    timers: dict[MoonbaseTimerName, OrderedTimer]


class Moonbase(TypedDict, total=False):
    workable: MoonbaseWork
    pickable: MoonbasePickable
    staff: dict[str, JsonValue] | None
    staffname: JsonValue
    staffuse: JsonValue
    timer: MoonbaseTimer | None


class AtriumOvergrowth(TypedDict, total=False):
    storyprogress: StoryProgress


class AtriumRubble(TypedDict):
    animid: Annotated[int, Field(ge=1, le=2)]
    storyprogress: NotRequired[StoryProgress]


class MastUpgrade(TypedDict):
    numupgrades: NonnegativeInt
    stage: NotRequired[PositiveInt | None]


class MastMalbatross(TypedDict, total=False):
    rotation: Annotated[Number, Field(ge=-360, le=360)]
    is_sail_raised: bool
    upgradeable: MastUpgrade


class SupportMaterials(TypedDict):
    rocks: Annotated[int, Field(ge=1, le=40)]


class SupportConstruction(TypedDict):
    materials: SupportMaterials


class SupportPillar(TypedDict, total=False):
    reinforced: Annotated[int, Field(ge=1, le=10)]
    constructionsite: SupportConstruction


class OasisFishing(TypedDict):
    fish: Annotated[int, Field(ge=0, lt=15)]


class OasisLake(TypedDict, total=False):
    regrowth: FalseFlag
    fishable: OasisFishing


class ChildSpawner(TypedDict):
    childreninside: NonnegativeInt
    childrenoutside: NotRequired[list[int]]
    spawning: NotRequired[bool]
    regening: NotRequired[bool]
    queued_spawn: NotRequired[bool]
    timetonextspawn: NotRequired[Number]
    timetonextregen: NotRequired[Number]


class HiveChildSpawner(ChildSpawner):
    emergencychildreninside: NotRequired[Annotated[int, Field(ge=0, le=8)]]
    emergencychildrenoutside: NotRequired[list[int]]


class IgnoredSpawnTimerEntry(TypedDict, total=False):
    timeleft: object
    initial_time: object
    paused: object


class HiveSpawnTimers(TypedDict):
    timers: dict[SpawnTimerName, IgnoredSpawnTimerEntry]


class Hive(TypedDict, total=False):
    health: SourceHealth
    childspawner: HiveChildSpawner
    worldsettingstimer: HiveSpawnTimers


class SpiderGrowth(TypedDict):
    stage: SpiderStage
    time: NotRequired[NonnegativeNumber]
    sleeptime: NotRequired[NonnegativeNumber]
    usetimemultiplier: NotRequired[Literal[False, 0] | PositiveNumber | None]


class SpiderChildSpawner(HiveChildSpawner, total=False):
    otherchildreninside: dict[str, NonnegativeInt]
    otheremergencychildreninside: dict[str, NonnegativeInt]
    maxchildren: NonnegativeInt
    maxemergencychildren: NonnegativeInt


class SpiderUpgrade(TypedDict):
    numupgrades: NonnegativeInt
    stage: SpiderStage


class SpiderShaveable(TypedDict):
    prize_count: NonnegativeInt


class SpawnTimerEntry(TypedDict, total=False):
    timeleft: NonnegativeNumber
    initial_time: NonnegativeNumber
    paused: bool


class SpiderSpawnTimers(TypedDict):
    timers: dict[SpawnTimerName, SpawnTimerEntry]


class SpiderDen(TypedDict, total=False):
    growable: SpiderGrowth | None
    health: SourceHealth | None
    childspawner: SpiderChildSpawner | None
    shaveable: SpiderShaveable | None
    upgradeable: SpiderUpgrade | None
    worldsettingstimer: SpiderSpawnTimers | None
    bedazzlement: EmptyTable | None


class AtriumFence(TypedDict, total=False):
    fenceid: Annotated[int, Field(ge=1, le=5)]


class GatePickable(TypedDict, total=False):
    picked: TrueFlag
    paused: TrueFlag
    caninteractwith: TrueFlag


class GateCutscene(TypedDict, total=False):
    running: TrueFlag
    gatefixed: TrueFlag


class GateTimerEntry(TypedDict):
    timeleft: UnitNumber
    paused: NotRequired[bool]
    blocklongupdate: NotRequired[bool]
    initial_time: NotRequired[Annotated[Number, Field(ge=0, le=9600)]]


class GateTimers(TypedDict):
    timers: dict[Literal['destabilizing', 'destabilizedelay', 'cooldown'], GateTimerEntry]


class GateTrackedEntity(TypedDict):
    name: Literal['stalker', 'charlie_hand']
    GUID: NonnegativeInt


class GateTracker(TypedDict):
    entities: list[GateTrackedEntity]


class AtriumGate(TypedDict, total=False):
    vault_key_socketed: TrueFlag
    can_spawn_charlie_hand_keystone: TrueFlag
    launch_key: TrueFlag
    pickable: GatePickable | None
    charliecutscene: GateCutscene | None
    worldsettingstimer: GateTimers | None
    entitytracker: GateTracker | None
    ritual_state: Literal[0]


class ObjectSpawner(TypedDict):
    objects: list[int]


class CaveHole(TypedDict, total=False):
    allowspawn: bool | None
    objectspawner: ObjectSpawner | None


TENTACLE_PILLAR_HEALTH = 500 * 1.5


class TentacleHealth(TypedDict):
    health: Annotated[Number, Field(ge=0, le=TENTACLE_PILLAR_HEALTH)]
    penalty: NotRequired[UnitNumber | None]
    maxhealth: NotRequired[object]


class TentacleTeleporter(TypedDict):
    items: Annotated[list[object], Field(max_length=0)]
    target: NotRequired[int | None]
    migration_data: NotRequired[object]


class TentaclePillar(TypedDict, total=False):
    overtaken: TrueFlag | None
    health: TentacleHealth | None
    teleporter: TentacleTeleporter | None


class WatertreeChildSpawner(ChildSpawner):
    emergencychildreninside: NotRequired[Number]


class WatertreeTimerEntry(TypedDict):
    timeleft: Number
    paused: NotRequired[bool]
    initial_time: NotRequired[Number]


class WatertreeTimers(TypedDict):
    timers: dict[Literal['regrow_oceantreenut', 'cocoon_regrow_check'], WatertreeTimerEntry]


class WatertreeSpawnTimers(TypedDict):
    timers: dict[SpawnTimerName, object]


class WatertreePillar(TypedDict):
    num_oceantreenuts: Annotated[int, Field(ge=0, le=2)]
    childspawner: WatertreeChildSpawner
    last_ram_time: NotRequired[NonnegativeNumber]
    cocoons_to_regrow: NotRequired[NonnegativeInt]
    timer: NotRequired[WatertreeTimers]
    worldsettingstimer: NotRequired[WatertreeSpawnTimers]


class OceanvineDeco(TypedDict, total=False):
    animnum: Annotated[int, Field(ge=1, le=6)]


class OceantreePillar(TypedDict, total=False):
    droppedvines: TrueFlag


class ArchivePillar(TypedDict, total=False):
    broken: bool


class VaultPillar(TypedDict, total=False):
    capped: Annotated[int, Field(ge=1, le=2)]
    broken: Annotated[Literal[1], BeforeValidator(strict_int.validate_python)]
    random: TrueFlag


class MonkeyPillar(TypedDict, total=False):
    pillar_id: Annotated[int, Field(ge=1, le=4)] | Literal['1', '2', '3', '4']


class WorldMigrator(TypedDict, total=False):
    id: object
    auto: object
    linkedWorld: object
    receivedPortal: object


class CaveExit(TypedDict):
    worldmigrator: WorldMigrator


class OpenCaveEntrance(CaveExit, total=False):
    childspawner: object
    worldsettingstimer: object


class GrottoPoolBig(TypedDict, total=False):
    children_ids: list[NonnegativeInt]
    children_indexes: list[StoryProgress]


def _paired_children(data: GrottoPoolBig) -> GrottoPoolBig:
    ids, indexes = data.get('children_ids', []), data.get('children_indexes', [])
    if len(ids) != len(indexes) or len(set(indexes)) != len(indexes):
        raise ValueError('child IDs and unique indexes must be paired')
    return data


class GrottoPoolSmall(TypedDict, total=False):
    wf_id: NonnegativeInt


class StaffLightTimers(TypedDict):
    extinguish: OrderedTimer


class StaffLightTimer(TypedDict):
    timers: StaffLightTimers


class StaffLight(TypedDict):
    timer: StaffLightTimer


class PondPlant(TypedDict):
    offset: Position


class Pond(TypedDict, total=False):
    plants: list[PondPlant]
    childspawner: object
    worldsettingstimer: object


class HotspringWorkable(TypedDict):
    maxwork: Annotated[Literal[-1], BeforeValidator(strict_int.validate_python)]
    workleft: Annotated[int, Field(ge=0, le=6)]


class Hotspring(TypedDict, total=False):
    workable: HotspringWorkable | None
    delay_refill: TrueFlag
    glassed: TrueFlag
    isbathbombed: TrueFlag
    empty: TrueFlag


class LavaPondRock(TypedDict):
    rocktype: Literal['', '2', '3', '4', '5', '6', '7']
    offset: Position


class LavaPond(TypedDict, total=False):
    rocks: list[LavaPondRock]


class RelicMoisture(TypedDict, total=False):
    moisture: Annotated[Number, Field(ge=0, le=100)]
    wet: TrueFlag


class RelicReplica(TypedDict, total=False):
    workable: EmptyTable | None


class RelicReplicaDecor(RelicReplica, total=False):
    inventoryitemmoisture: RelicMoisture | None


class RelicHealth(TypedDict, total=False):
    health: NonnegativeNumber


class AncientRelic(TypedDict, total=False):
    rubble: TrueFlag
    maxhealth: PositiveNumber | None
    health: RelicHealth


EMPTY: TypeAdapter[EmptyTable] = TypeAdapter(EmptyTable)
STAGEHAND: TypeAdapter[Stagehand] = TypeAdapter(Stagehand)
WOOD_CHAIR: TypeAdapter[WoodChair] = TypeAdapter(WoodChair)
RESEARCH_LAB: TypeAdapter[ResearchLab] = TypeAdapter(ResearchLab)
MOONBASE: TypeAdapter[Moonbase] = TypeAdapter(Moonbase)
ATRIUM_OVERGROWTH: TypeAdapter[AtriumOvergrowth] = TypeAdapter(AtriumOvergrowth)
ATRIUM_RUBBLE: TypeAdapter[AtriumRubble] = TypeAdapter(AtriumRubble)
MAST_MALBATROSS: TypeAdapter[MastMalbatross] = TypeAdapter(MastMalbatross)
SUPPORT_PILLAR: TypeAdapter[SupportPillar] = TypeAdapter(SupportPillar)
OASIS_LAKE: TypeAdapter[OasisLake] = TypeAdapter(OasisLake)
HIVE: TypeAdapter[Hive] = TypeAdapter(Hive)
SPIDER_DEN: TypeAdapter[SpiderDen] = TypeAdapter(SpiderDen)
ATRIUM_FENCE: TypeAdapter[AtriumFence] = TypeAdapter(AtriumFence)
ATRIUM_GATE: TypeAdapter[AtriumGate] = TypeAdapter(AtriumGate)
CAVE_HOLE: TypeAdapter[CaveHole] = TypeAdapter(CaveHole)
TENTACLE_PILLAR: TypeAdapter[TentaclePillar] = TypeAdapter(TentaclePillar)
WATERTREE_PILLAR: TypeAdapter[WatertreePillar] = TypeAdapter(WatertreePillar)
OCEANVINE_DECO: TypeAdapter[OceanvineDeco] = TypeAdapter(OceanvineDeco)
OCEANTREE_PILLAR: TypeAdapter[OceantreePillar] = TypeAdapter(OceantreePillar)
ARCHIVE_PILLAR: TypeAdapter[ArchivePillar] = TypeAdapter(ArchivePillar)
VAULT_PILLAR: TypeAdapter[VaultPillar] = TypeAdapter(VaultPillar)
MONKEY_PILLAR: TypeAdapter[MonkeyPillar] = TypeAdapter(MonkeyPillar)
CAVE_EXIT: TypeAdapter[CaveExit | EmptyTable] = TypeAdapter(CaveExit | EmptyTable)
OPEN_CAVE_ENTRANCE: TypeAdapter[OpenCaveEntrance | EmptyTable] = TypeAdapter(OpenCaveEntrance | EmptyTable)
GROTTO_POOL_BIG: TypeAdapter[GrottoPoolBig] = TypeAdapter(
    Annotated[GrottoPoolBig, AfterValidator(_paired_children)])
GROTTO_POOL_SMALL: TypeAdapter[GrottoPoolSmall] = TypeAdapter(GrottoPoolSmall)
STAFF_LIGHT: TypeAdapter[StaffLight] = TypeAdapter(StaffLight)
POND: TypeAdapter[Pond] = TypeAdapter(Pond)
HOTSPRING: TypeAdapter[Hotspring] = TypeAdapter(Hotspring)
LAVA_POND: TypeAdapter[LavaPond] = TypeAdapter(LavaPond)
RELIC_REPLICA: TypeAdapter[RelicReplica] = TypeAdapter(RelicReplica)
RELIC_REPLICA_DECOR: TypeAdapter[RelicReplicaDecor] = TypeAdapter(RelicReplicaDecor)
ANCIENT_RELIC: TypeAdapter[AncientRelic] = TypeAdapter(AncientRelic)
