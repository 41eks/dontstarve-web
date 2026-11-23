"""JSON records shared by the DST importer and the TypeScript save loader.

The document follows src/save/types.ts and packages/prefab/src/saveRecord.ts.
Prefab-specific component data is checked by deserializeSave and its prefab catalog.
"""

from typing import Annotated, Literal, TypeVar, cast

from pydantic import (
    BeforeValidator, Field, FiniteFloat, JsonValue, StrictBool, StrictInt, StringConstraints, TypeAdapter, ValidationError,
)
from typing_extensions import NotRequired, TypedDict

Number = int | FiniteFloat
Position = Annotated[list[Number], Field(min_length=3, max_length=3)]
SnapshotId = Annotated[str, StringConstraints(pattern=r'^[0-9]{10}$')]
SessionId = Annotated[str, StringConstraints(pattern=r'^[A-Za-z0-9_-]+$')]
PlayerFilePath = Annotated[
    str, StringConstraints(pattern=r'^(Master|Caves)/save/session/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[0-9]{10}\.json$')
]
WorldPrefab = Literal['forest', 'cave']
Shard = Literal['Master', 'Caves']
Season = Literal['autumn', 'winter', 'spring', 'summer']
ClockPhase = Literal['day', 'dusk', 'night', 'full_moon']
NightmarePhase = Literal['calm', 'warn', 'wild', 'dawn']
Precipitation = Literal['none', 'rain', 'snow']
EquipSlot = Literal['hands', 'body', 'head']
EquipKind = Literal['hand', 'body', 'head']

# Pydantic's literals compare numbers and booleans by value; check the JSON type first.
strict_int = TypeAdapter(StrictInt)
strict_bool = TypeAdapter(StrictBool)
SchemaVersion = Annotated[Literal[1], BeforeValidator(strict_int.validate_python)]
SanityMode = Annotated[Literal[0, 1], BeforeValidator(strict_int.validate_python)]
TrueFlag = Annotated[Literal[True], BeforeValidator(strict_bool.validate_python)]


class SavedTransform(TypedDict):
    position: Position
    rotationY: Number


class EntityPersistRecord(TypedDict):
    id: str
    components: dict[str, JsonValue]
    skinname: NotRequired[str]


class EntitySaveRecord(EntityPersistRecord):
    transform: SavedTransform


class HeldEntityRecord(EntityPersistRecord):
    prefab: str


class SlotItemsSave(TypedDict):
    items: dict[str, HeldEntityRecord]


class PlayerInventorySave(SlotItemsSave):
    equip: dict[EquipSlot, HeldEntityRecord]
    activeitem: NotRequired[HeldEntityRecord]


class BufferedBuild(TypedDict):
    recipeId: str
    skinId: NotRequired[str]


class BuilderSave(TypedDict):
    bufferedBuilds: list[BufferedBuild]


class PlayerStatsSave(TypedDict):
    health: Number
    hunger: Number
    sanity: Number
    penalty: NotRequired[Number]
    sanitySane: NotRequired[bool]
    sanityMode: NotRequired[SanityMode]


class WortoxSave(TypedDict):
    freehops: int
    soulhopcost: int


class SavedPlayer(TypedDict):
    prefab: Literal['wilson']
    shardId: str
    transform: SavedTransform
    inventory: PlayerInventorySave
    builder: BuilderSave
    stats: NotRequired[PlayerStatsSave]
    ghost: NotRequired[TrueFlag]
    wortox: NotRequired[WortoxSave]


class PlayerMigration(TypedDict):
    worldid: str
    portalid: int
    sessionid: str


class SourceMigration(PlayerMigration, total=False):
    dest_x: Number
    dest_y: Number
    dest_z: Number


class SavedPlayerSessionFile(TypedDict):
    player: SavedPlayer
    migration: NotRequired[PlayerMigration | None]


class ClockSave(TypedDict):
    day: int
    phase: ClockPhase
    phaseProgress: Number


class SeasonSave(TypedDict):
    name: Season
    daysRemaining: Number


class WorldTemperatureSave(TypedDict):
    season: Season
    seasontemperature: Number
    phasetemperature: Number
    noisetime: Number
    daylight: NotRequired[bool]


class WeatherSave(TypedDict):
    moisture: Number
    moisturefloor: Number
    moistureceil: Number
    preciptype: Precipitation
    peakprecipitationrate: Number
    snowlevel: NotRequired[Number]


class NightmareLengths(TypedDict):
    calm: int
    warn: int
    wild: int
    dawn: int


class NightmareClockSave(TypedDict):
    lengths: NightmareLengths
    phase: NightmarePhase
    totaltimeinphase: Number
    remainingtimeinphase: Number
    lockedphase: NotRequired[NightmarePhase]


class MoonSave(TypedDict):
    mooomphasecycle: int


class RandomSave(TypedDict):
    algorithm: Literal['xoshiro128ss']
    state: list[int]


class WorldSystems(TypedDict, total=False):
    clock: ClockSave
    season: SeasonSave
    worldtemperature: WorldTemperatureSave
    weather: WeatherSave
    nightmareclock: NightmareClockSave
    moon: MoonSave
    random: RandomSave


class BridgeDirection(TypedDict):
    x: Number
    z: Number


class RopeBridgeTileSave(TypedDict):
    health: Number
    direction: BridgeDirection
    iconOffset: NotRequired[int]


class TurfTileSave(TypedDict):
    col: int
    row: int
    tileId: int
    underTileId: NotRequired[int]
    ropeBridge: NotRequired[RopeBridgeTileSave]


class TopologyNode(TypedDict):
    x: Number
    z: Number
    type: int
    tags: NotRequired[list[str | int]]


class NodeIdGridSave(TypedDict):
    col: int
    row: int
    width: int
    height: int
    runs: list[int]


class TopologySave(TypedDict):
    nodes: list[TopologyNode]
    nodeIdGrid: NotRequired[NodeIdGridSave]


class MapGeneratorOptions(TypedDict):
    size: Number
    moonTreeCount: int
    moonTreeExclusionRadiusSquared: Number


class MapGenerator(TypedDict):
    id: str
    seed: NotRequired[str]
    options: MapGeneratorOptions


class SavedMap(TypedDict):
    kind: Literal['generated']
    defaultTileId: NotRequired[int]
    tiles: NotRequired[list[TurfTileSave]]
    generator: MapGenerator
    topology: NotRequired[TopologySave]


class SavedWorld(TypedDict):
    shardId: str
    prefab: WorldPrefab
    seed: NotRequired[str]
    elapsedSeconds: Number
    systems: WorldSystems
    map: SavedMap
    entities: dict[str, list[EntitySaveRecord]]


class SaveSession(TypedDict):
    id: str
    createdAt: str
    playerFile: NotRequired[PlayerFilePath]


class SaveSnapshot(TypedDict):
    id: SnapshotId
    parentId: SnapshotId | None
    savedAt: str
    reason: Literal['initial', 'manual', 'autosave']


class SaveHeader(TypedDict):
    format: Literal['three-roaming-save']
    schemaVersion: SchemaVersion
    gameVersion: str
    session: SaveSession
    snapshot: SaveSnapshot
    world: SavedWorld


class LocalPlayers(TypedDict):
    local: SavedPlayer


class SaveDocument(SaveHeader):
    players: LocalPlayers


class EmptyPlayers(TypedDict):
    pass


class WorldSessionFile(SaveHeader):
    players: EmptyPlayers


class SessionSnapshot(TypedDict):
    shard: Shard
    sessionId: SessionId
    snapshotId: SnapshotId
    worldFile: str
    playerFile: PlayerFilePath | None
    migration: PlayerMigration | None


class SessionManifest(TypedDict):
    activeShard: Shard
    snapshots: list[SessionSnapshot]


class ItemSpec(TypedDict):
    maxStack: int
    maxUses: NotRequired[Number]
    useStep: NotRequired[Number]
    maxFuel: NotRequired[Number]
    perishTime: NotRequired[Number]
    equippable: NotRequired[EquipKind]
    canGoInContainer: NotRequired[bool]
    containerSlots: NotRequired[int]


class SaveCatalog(TypedDict):
    items: dict[str, ItemSpec]
    skins: dict[str, str | None]


SAVE_DOCUMENT: TypeAdapter[SaveDocument] = TypeAdapter(SaveDocument)
WORLD_SESSION_FILE: TypeAdapter[WorldSessionFile] = TypeAdapter(WorldSessionFile)
PLAYER_SESSION_FILE: TypeAdapter[SavedPlayerSessionFile] = TypeAdapter(SavedPlayerSessionFile)
SESSION_MANIFEST: TypeAdapter[SessionManifest] = TypeAdapter(SessionManifest)
SESSION_ID: TypeAdapter[str] = TypeAdapter(SessionId)
SNAPSHOT_ID: TypeAdapter[str] = TypeAdapter(SnapshotId)
SOURCE_MIGRATION: TypeAdapter[SourceMigration] = TypeAdapter(SourceMigration)
SAVE_CATALOG: TypeAdapter[SaveCatalog] = TypeAdapter(SaveCatalog)

T = TypeVar('T')


def validate(adapter: TypeAdapter[T], data: object, source: object) -> T:
    """Check a JSON value in place so existing fixture bytes and key order stay stable."""
    try:
        adapter.validate_python(data, strict=True, extra='forbid')
    except ValidationError as error:
        details = '\n'.join(
            f'  {".".join(map(str, issue["loc"]))}: {issue["msg"]}'
            for issue in error.errors(include_input=False, include_url=False)
        )
        raise ValueError(f'{source}: invalid {error.title}\n{details}') from None
    return cast(T, data)
