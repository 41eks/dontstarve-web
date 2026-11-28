#!/usr/bin/env python3
"""Convert validated DST landmark tables to project save components."""
import json
import math
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Protocol, TypeVar, cast

from pydantic import JsonValue, TypeAdapter
from typing_extensions import TypedDict

import dst_region_structure_schema as schema
from dst_save_schema import EntitySaveRecord, HeldEntityRecord, Number, validate

Components = dict[str, JsonValue]
Converter = Callable[[object], Components]
Record = TypeVar('Record', bound=Mapping[str, object])


class SkinContext(TypedDict):
    skin: str | None


class MoonbaseContext(SkinContext):
    item: Callable[[dict[str, JsonValue], str], HeldEntityRecord | None]


class RelicConverter(Protocol):
    def __call__(self, data: object, context: SkinContext | None = None) -> Components: ...


class UnlinkedGrottoChild(TypedDict):
    index: int
    sourceId: int


class UnlinkedGrottoPool(TypedDict):
    children: list[UnlinkedGrottoChild]


class BuildingDefinition(TypedDict):
    skinArchives: dict[str, JsonValue]


ROOT = Path(__file__).resolve().parents[2]
ANIMATED_BUILDINGS: dict[str, BuildingDefinition] = json.loads(
    (ROOT / 'packages/prefab/src/definitions.json').read_text())['animatedBuildings']
RESEARCH_LAB_SKINS = {
    prefab: set(ANIMATED_BUILDINGS[prefab]['skinArchives'])
    for prefab in ('researchlab', 'researchlab2', 'researchlab3', 'researchlab4')
}
WOOD_CHAIR_SKINS = set(ANIMATED_BUILDINGS['wood_chair']['skinArchives'])
STAGEHAND_SKINS = set(ANIMATED_BUILDINGS['stagehand']['skinArchives'])
MAST_MALBATROSS_SKINS = {'mast_malbatross_tesla', 'mast_malbatross_wagstaff'}


def json_fields(record: Mapping[str, object]) -> Components:
    """Copy a validated record whose fields all have JSON types."""
    return cast(Components, dict(record))


def validate_fields(adapter: TypeAdapter[Record], data: object, source: str) -> Components:
    record = validate(adapter, data, source)
    return json_fields(record)


def stagehand_components(data: object, context: SkinContext) -> Components:
    # stagehand.lua has no OnSave. Workable has savestate=false; only lunar hail buildup can persist.
    source = validate(schema.STAGEHAND, data, 'Unsupported stagehand save state')
    if context['skin'] is not None and context['skin'] not in STAGEHAND_SKINS:
        raise ValueError(f"Unsupported stagehand skin: {context['skin']}")
    buildup = source.get('lunarhailbuildup')
    return {'lunarhailbuildup': json_fields(buildup)} if buildup else {}


def wood_chair_components(data: object, context: SkinContext) -> Components:
    # furniture_chairs.lua saves burnt; savedrotation.lua saves a non-zero rotation in degrees.
    source = validate(schema.WOOD_CHAIR, data, 'Unsupported wood_chair save state')
    result: Components = {'building': {'burnt': True} if source.get('burnt') else {}}
    if 'savedrotation' in source:
        result['savedrotation'] = json_fields(source['savedrotation'])
    skin = context['skin']
    if skin is not None and skin not in WOOD_CHAIR_SKINS:
        raise ValueError(f'Unsupported wood_chair skin: {skin}')
    return result


def researchlab_components(prefab: str) -> Callable[[object, SkinContext], Components]:
    # scienceprototyper.lua / magicprototyper.lua save burnt. Workable has savestate=false.
    def convert(data: object, context: SkinContext) -> Components:
        source = validate(schema.RESEARCH_LAB, data, f'Unsupported {prefab} save state')
        skin = context['skin']
        if skin is not None and skin not in RESEARCH_LAB_SKINS[prefab]:
            raise ValueError(f'Unsupported {prefab} skin: {skin}')
        return {'building': {'state': 'idle', **({'burnt': True} if source.get('burnt') else {})}}
    return convert


def pigking_components(data: object) -> Components:
    # pigking.lua has no OnSave; trader and sleep/stategraph state are rebuilt on load.
    validate(schema.EMPTY, data, 'Unsupported pigking save state')
    return {}


def insanityrock_components(data: object) -> Components:
    # nightmarerock.lua has no OnSave; the refresh task derives activation from nearby players.
    validate(schema.EMPTY, data, 'Unsupported insanityrock save state')
    return {}


def wardrobe_components(data: object) -> Components:
    # wardrobe.lua only saves burnt, which the current prefab cannot restore.
    validate(schema.EMPTY, data, 'Unsupported wardrobe save state')
    return {'building': {}}


def moonbase_components(data: object, context: MoonbaseContext) -> Components:
    # moonbase.lua OnSave/OnLoad: workable owns the repair state; pickable gates the held staff.
    source = validate(schema.MOONBASE, data, 'Unsupported moonbase save state')
    if context['skin'] is not None:
        raise ValueError('Unsupported moonbase save state')
    result: Components = {'building': {'state': 'idle'}}
    work = source.get('workable')
    workleft = work.get('workleft', 4) if work else 4
    if work:
        result['workable'] = {'maxwork': 6, 'workleft': workleft}
    state: Components = {}
    held_staff: HeldEntityRecord | None = None
    pickable = source.get('pickable')
    if pickable and pickable.get('caninteractwith') and ('staff' in source or 'staffname' in source):
        staff = source.get('staff')
        if staff is None:
            if 'staffname' not in source:
                raise ValueError('Missing moonbase staff name')
            staff = {'prefab': source['staffname'], 'data': {
                **({'finiteuses': {'uses': source['staffuse']}} if 'staffuse' in source else {})}}
        if staff.get('prefab') not in ('yellowstaff', 'opalstaff') or workleft <= 0:
            raise ValueError('Unsupported moonbase staff')
        held_staff = context['item'](staff, 'staff')
        if held_staff is None or 'stackable' in held_staff['components']:
            raise ValueError('Expected one supported moonbase staff')
        state['staff'] = json_fields(held_staff)
    timer = source.get('timer')
    if timer is not None:
        # timer.lua OnSave; limits from tuning.lua MOONBASE_CHARGE_*.
        limits = {'fullmoonstartdelay': 10, 'moonchargepre': 10, 'mooncharge': 49.9,
                  'mooncharge2': 18.7, 'mooncharge3': 18.7}
        timers = timer['timers']
        for name, entry in timers.items():
            validate(schema.number_range(limits[name]), entry['initial_time'], f'Unsupported moonbase {name} timer')
        charging = {'moonchargepre', 'mooncharge', 'mooncharge2', 'mooncharge3'} & timers.keys()
        if (charging and (held_staff is None or held_staff['prefab'] != 'yellowstaff')) \
                or ('moonchargepre' in timers and 'mooncharge' in timers) \
                or ({'mooncharge2', 'mooncharge3'} & timers.keys() and 'mooncharge' not in timers) \
                or {'mooncharge2', 'mooncharge3'} <= timers.keys():
            raise ValueError('Unsupported moonbase charge state')
        state['timer'] = {'timers': {name: json_fields(entry) for name, entry in timers.items()}}
    if state:
        result['moonbase'] = state
    return result


def atrium_statue_components(data: object) -> Components:
    # atrium_statue.lua MakeStatue("atrium_statue", false) has no OnSave; only the _facing variant saves savedrotation.
    validate(schema.EMPTY, data, 'Unsupported atrium_statue save state')
    return {}


def atrium_overgrowth_components(data: object) -> Components:
    # atrium_overgrowth.lua rune_onsave: storyprogress is written once an inspection assigned it.
    source = validate(schema.ATRIUM_OVERGROWTH, data, 'Unsupported atrium_overgrowth save state')
    return {'atriumOvergrowth': json_fields(source)} if source else {}


def atrium_rubble_components(data: object) -> Components:
    # atrium_rubble.lua always saves animid and saves storyprogress once getstatus or OnLoad assigned it.
    source = validate(schema.ATRIUM_RUBBLE, data, 'Unsupported atrium_rubble save state')
    state: Components = {'animid': source['animid']}
    if 'storyprogress' in source:
        state['storyprogress'] = source['storyprogress']
    return {'atriumRubble': state}


def mast_malbatross_components(data: object, context: SkinContext) -> Components:
    # mast.lua onsave off any boat: rotation and is_sail_raised, plus upgradeable:OnSave's numupgrades / stage.
    # Burnt and the lamp / lightning rod upgrade fields belong to unported branches.
    source = validate(schema.MAST_MALBATROSS, data, 'Unsupported mast_malbatross save state')
    state: Components = {}
    if 'rotation' in source:
        state['rotation'] = source['rotation']
    if 'is_sail_raised' in source:
        state['is_sail_raised'] = source['is_sail_raised']
    skin = context['skin']
    if skin is not None and skin not in MAST_MALBATROSS_SKINS:
        raise ValueError(f'Unsupported mast_malbatross skin: {skin}')
    result: Components = {'mastMalbatross': state}
    if 'upgradeable' in source:
        upgradeable = source['upgradeable']
        stage = upgradeable.get('stage')
        result['upgradeable'] = {'numupgrades': upgradeable['numupgrades'],
                                 **({'stage': stage} if stage is not None else {})}
    return result


def support_pillar_components(data: object) -> Components:
    # support_pillar.lua saves reinforced and constructionsite materials. Regen belongs to the dreadstone pillar.
    source = validate(schema.SUPPORT_PILLAR, data, 'Unsupported support_pillar save state')
    result: Components = {}
    if 'reinforced' in source:
        result['supportPillar'] = {'reinforced': source['reinforced']}
    if 'constructionsite' in source:
        result['constructionsite'] = {'materials': json_fields(source['constructionsite']['materials'])}
    return result


def oasislake_components(data: object) -> Components:
    # oasislake.lua only saves the regrowth flag as false. fishable:OnSave writes fish below OASISLAKE_MAX_FISH.
    source = validate(schema.OASIS_LAKE, data, 'Unsupported oasislake save state')
    result: Components = {}
    if 'regrowth' in source:
        result['oasislake'] = {'regrowth': source['regrowth']}
    if 'fishable' in source:
        result['fishable'] = json_fields(source['fishable'])
    return result


def hive_components(prefab: str, max_children: int, max_health: Number) -> Converter:
    # beehive.lua / wasphive.lua save health, childspawner and worldsettingstimer. The bees outside and the
    # spawn/regen tasks are unported. The project regenerates the children instead of restoring those GUIDs.
    def convert(data: object) -> Components:
        source = validate(schema.HIVE, data, f'Unsupported {prefab} save state')
        result: Components = {}
        if 'health' in source:
            state = {'current': source['health']['health'], 'maximum': max_health}
            result['health'] = validate_fields(schema.HEALTH_RANGE, state, f'Unsupported {prefab} health')
        if 'childspawner' in source:
            result['childspawner'] = childspawner_state(source['childspawner'], prefab, max_children, 8)
        return result
    return convert


def childspawner_state(
    child: schema.HiveChildSpawner, prefab: str, max_children: int, max_emergency: int,
) -> Components:
    children = validate(schema.count_range(max_children), child['childreninside'], f'{prefab}.childspawner.childreninside')
    result: Components = {'childreninside': children, 'childrenoutside': []}
    if 'emergencychildreninside' in child:
        result['emergencychildreninside'] = validate(
            schema.count_range(max_emergency), child['emergencychildreninside'],
            f'{prefab}.childspawner.emergencychildreninside')
    return result


def spiderden_components(data: object) -> Components:
    # spiderden.lua saves all stages under spiderden. The stage is in growable and supplies the health and
    # childspawner limits. Outside spiders, their spawn/regen tasks and the queen stage are unported.
    source = validate(schema.SPIDER_DEN, data, 'Unsupported spiderden save state')
    growth_stages = (3, 6, 9)
    emergency_warriors = (0, 4, 8)
    stage_health = (250, 500, 1000)
    spring_combat_mod = 1.33
    result: Components = {}
    growth = source.get('growable')
    if growth is not None:
        converted: Components = {'stage': growth['stage']}
        multiplier = growth.get('usetimemultiplier')
        if 'time' in growth:
            # growable.lua divides saved growth time by the stage multiplier; the project keeps actual seconds.
            converted['time'] = round(growth['time'] * multiplier, 3) if multiplier else growth['time']
        if 'sleeptime' in growth:
            converted['sleeptime'] = growth['sleeptime']
        result['growable'] = converted

    health = source.get('health')
    if health is not None:
        if growth is None:
            raise ValueError('Missing spiderden growable stage for health')
        state = {'current': health['health'], 'maximum': stage_health[growth['stage'] - 1]}
        result['health'] = validate_fields(schema.HEALTH_RANGE, state, 'Unsupported spiderden health')

    child = source.get('childspawner')
    if child is not None:
        stage_index = growth['stage'] - 1 if growth else 0
        max_children = math.floor(growth_stages[stage_index] * spring_combat_mod)
        result['childspawner'] = childspawner_state(child, 'spiderden', max_children, emergency_warriors[stage_index])

    upgrade = source.get('upgradeable')
    if upgrade is not None:
        result['upgradeable'] = {'numupgrades': upgrade['numupgrades'], 'stage': upgrade['stage']}
    return result


def atrium_fence_components(data: object) -> Components:
    # atrium_fence.lua OnSave writes the shape from math.random(NUM_SHAPES).
    return validate_fields(schema.ATRIUM_FENCE, data, 'Unsupported atrium_fence save state')


def atrium_gate_components(data: object) -> Components:
    # atrium_gate.lua OnSave plus the component records used by OnLoadPostPass.
    source = validate(schema.ATRIUM_GATE, data, 'Unsupported atrium_gate save state')
    result: Components = {}
    own: Components = {
        key: True for key in ('vault_key_socketed', 'can_spawn_charlie_hand_keystone', 'launch_key') if key in source
    }
    if own:
        result['atriumGate'] = own
    pickable = source.get('pickable')
    if pickable is not None:
        result['pickable'] = json_fields(pickable)
    cutscene = source.get('charliecutscene')
    if cutscene is not None:
        result['charliecutscene'] = json_fields(cutscene)
    timer = source.get('worldsettingstimer')
    if timer is not None:
        result['worldsettingstimer'] = {'timers': {
            name: {**json_fields(entry), 'paused': entry.get('paused', False)} for name, entry in timer['timers'].items()}}
    tracker = source.get('entitytracker')
    if tracker is not None:
        result['entitytracker'] = {'entities': [json_fields(entity) for entity in tracker['entities']]}
    return result


def cave_hole_components(data: object) -> Components:
    # cave_hole.lua saves allowspawn. The project has no owner for objectspawner.lua's object GUIDs.
    source = validate(schema.CAVE_HOLE, data, 'Unsupported cave_hole save state')
    allowspawn = source.get('allowspawn')
    return {'allowspawn': allowspawn} if allowspawn is not None else {}


def pillar_ruins_components(data: object) -> Components:
    # pillar.lua has no OnSave and adds no component that saves anything.
    validate(schema.EMPTY, data, 'Unsupported pillar_ruins save state')
    return {}


def tentacle_pillar_components(data: object) -> Components:
    # tentacle_pillar.lua saves overtaken, health and linked teleporters. The project writes maximum health and
    # drops teleporter links because it does not restore them.
    source = validate(schema.TENTACLE_PILLAR, data, 'Unsupported tentacle_pillar save state')
    result: Components = {}
    if source.get('overtaken'):
        result['overtaken'] = True
    health = source.get('health')
    if health is not None:
        state: Components = {'health': health['health'], 'maxhealth': schema.TENTACLE_PILLAR_HEALTH}
        penalty = health.get('penalty')
        if penalty is not None:
            state['penalty'] = penalty
        result['health'] = state
    return result


def stateless_pillar_components(prefab: str) -> Converter:
    # pillar.lua and atrium_pillar.lua have no OnSave and add no component that saves anything.
    def convert(data: object) -> Components:
        validate(schema.EMPTY, data, f'Unsupported {prefab} save state')
        return {}
    return convert


def moon_fissure_components(data: object) -> Components:
    # moon_fissure.lua has no OnSave; its workable leaves savestate false and sanityaura / repairable save nothing.
    validate(schema.EMPTY, data, 'Unsupported moon_fissure save state')
    return {}


def watertree_pillar_components(data: object) -> Components:
    # watertree_pillar.lua saves nuts, cocoon regrowth and childspawner state. The project drops the outside
    # grassgator GUIDs and their spawn/regen tasks.
    source = validate(schema.WATERTREE_PILLAR, data, 'Unsupported watertree_pillar save state')
    state: Components = {'num_oceantreenuts': source['num_oceantreenuts']}
    if 'last_ram_time' in source:
        state['last_ram_time'] = source['last_ram_time']
    if 'cocoons_to_regrow' in source:
        state['cocoons_to_regrow'] = source['cocoons_to_regrow']
    children = validate(schema.count_range(1), source['childspawner']['childreninside'],
                        'watertree_pillar.childspawner.childreninside')
    state['childspawner'] = {'childreninside': children, 'childrenoutside': []}
    if 'timer' in source:
        saved: Components = {
            name: {'timeleft': entry['timeleft'], 'paused': entry.get('paused', False),
                   'initial_time': entry.get('initial_time', entry['timeleft'])}
            for name, entry in source['timer']['timers'].items()
        }
        if saved:
            state['timer'] = {'timers': saved}
    return {'watertreePillar': state}


def oceanvine_deco_components(data: object) -> Components:
    # oceanvine_deco.lua saves animnum. Without it the constructor rolls one.
    return validate_fields(schema.OCEANVINE_DECO, data, 'Unsupported oceanvine_deco save state')


def oceantree_pillar_components(data: object) -> Components:
    # oceantree_pillar.lua saves droppedvines only when true.
    source = validate(schema.OCEANTREE_PILLAR, data, 'Unsupported oceantree_pillar save state')
    return {'oceantreePillar': json_fields(source)} if source else {}


def archive_pillar_components(data: object) -> Components:
    # archive_pillar.lua saves broken. Without it the constructor rolls one.
    return validate_fields(schema.ARCHIVE_PILLAR, data, 'Unsupported archive_pillar save state')


def vault_pillar_components(data: object) -> Components:
    # vault_pillar.lua saves capped or broken. World generation can also specify random.
    return validate_fields(schema.VAULT_PILLAR, data, 'Unsupported vault_pillar save state')


def monkeypillar_components(data: object) -> Components:
    # monkeypillar.lua saves pillar_id as a string, and world generation may supply a number.
    return validate_fields(schema.MONKEY_PILLAR, data, 'Unsupported monkeypillar save state')


def cave_exit_components(data: object) -> Components:
    # worldmigrator.lua saves links that the project does not restore yet.
    validate(schema.CAVE_EXIT, data, 'Unsupported cave_exit save state')
    return {}


def cave_entrance_components(opened: bool) -> Converter:
    # The open entrance also saves the unported bat childspawner and worldsettingstimer.
    def convert(data: object) -> Components:
        if opened:
            validate(schema.OPEN_CAVE_ENTRANCE, data, 'Unsupported cave_entrance save state')
        else:
            validate(schema.CAVE_EXIT, data, 'Unsupported cave_entrance save state')
        return {}
    return convert


def grotto_pool_components(data: object, big: bool) -> Components:
    # The source GUIDs become project entity IDs after every entity has been imported (see link_grotto_pools).
    children: list[JsonValue]
    if big:
        source = validate(schema.GROTTO_POOL_BIG, data, 'Unsupported grotto_pool_big save state')
        children = [{'index': index, 'sourceId': child}
                    for index, child in zip(source.get('children_indexes', []), source.get('children_ids', []), strict=True)]
    else:
        small = validate(schema.GROTTO_POOL_SMALL, data, 'Unsupported grotto_pool_small save state')
        children = [{'index': 1, 'sourceId': small['wf_id']}] if 'wf_id' in small else []
    return {'grottoPool': {'children': children}}


def grotto_waterfall_components(data: object) -> Components:
    validate(schema.EMPTY, data, 'Unsupported grotto_waterfall_big save state')
    return {}


def link_grotto_pools(result: Mapping[str, list[EntitySaveRecord]], imported_ids: Mapping[int, str]) -> None:
    # Only children that were imported can be linked; a pool respawns any missing prop (setup_children).
    for prefab in ('grotto_pool_big', 'grotto_pool_small'):
        for entity in result.get(prefab, []):
            components = entity['components']
            pool = cast(UnlinkedGrottoPool, components['grottoPool'])
            children: list[JsonValue] = [
                {'index': child['index'], 'id': imported_ids[child['sourceId']]}
                for child in pool['children'] if child['sourceId'] in imported_ids]
            if children:
                components['grottoPool'] = {'children': children}
            else:
                del components['grottoPool']


def staff_light_components(limit: Number) -> Converter:
    # stafflight.lua has no OnSave. Only timer.lua's extinguish task is saved; limit is its tuning.lua duration.
    duration = schema.number_range(limit)

    def convert(data: object) -> Components:
        source = validate(schema.STAFF_LIGHT, data, 'Unsupported staff light extinguish timer')
        entry = source['timer']['timers']['extinguish']
        validate(duration, entry['initial_time'], 'Unsupported staff light extinguish timer')
        return {'timer': {'timers': {'extinguish': json_fields(entry)}}}
    return convert


def pond_components(data: object) -> Components:
    # pond.lua saves plants and the unported frog childspawner and worldsettingstimer. A frozen pond has no plants.
    source = validate(schema.POND, data, 'Unsupported pond save state')
    # Offsets turn with the world, as project_position does: X is kept and Z negated.
    plants: list[JsonValue] = [
        {'offset': [x, y, 0 - z]} for x, y, z in (plant['offset'] for plant in source.get('plants', []))
    ]
    return {'plants': plants} if plants else {}


def hotspring_components(data: object) -> Components:
    # hotspring.lua saves at most one state flag. Only the normal and bath-bombed, non-glass states are supported.
    source = validate(schema.HOTSPRING, data, 'Unsupported hotspring save state')
    flags = source.keys() & {'delay_refill', 'glassed', 'isbathbombed', 'empty'}
    if flags and flags != {'isbathbombed'}:
        raise ValueError(f'Unsupported hotspring state flags: {sorted(flags)}')
    return {'hotspring': {'isbathbombed': True} if flags else {}}


def lava_pond_components(data: object) -> Components:
    # lava_pond.lua saves the rock layout spawned around the pool.
    source = validate(schema.LAVA_POND, data, 'Unsupported lava_pond save state')
    if 'rocks' not in source:
        return {}
    rocks: list[JsonValue] = [
        {'rocktype': rock['rocktype'], 'offset': list(rock['offset'])} for rock in source['rocks']
    ]
    return {'lavaPond': {'rocks': rocks}}


def ruins_relic_components(prefab: str) -> RelicConverter:
    # ruinsrelic.lua has no prefab OnSave; smashables.lua OnSave/OnPreLoad keeps rubble and maxhealth.
    replica = prefab.startswith('ruinsrelic_')
    decor = replica and prefab.rsplit('_', 1)[1] in {'plate', 'bowl', 'chipbowl', 'vase'}

    def convert(data: object, context: SkinContext | None = None) -> Components:
        if replica:
            skin = context['skin'] if context else None
            if skin and (prefab != 'ruinsrelic_chair' or skin not in {'ruinsrelic_chair_tesla', 'ruinsrelic_chair_toilet'}):
                raise ValueError(f'Unsupported {prefab} skin')
            if decor:
                source = validate(schema.RELIC_REPLICA_DECOR, data, f'Unsupported {prefab} save fields')
                moisture = source.get('inventoryitemmoisture')
                return {'inventoryitemmoisture': json_fields(moisture)} if moisture else {}
            validate(schema.RELIC_REPLICA, data, f'Unsupported {prefab} save fields')
            return {}

        ancient = validate(schema.ANCIENT_RELIC, data, f'Unsupported {prefab} save fields')
        result: Components = {}
        rubble = ancient.get('rubble', False)
        if rubble:
            result['ruinsRelic'] = {'rubble': True}
        maximum = ancient.get('maxhealth')
        if maximum is None:
            if ancient:
                raise ValueError(f'Missing {prefab} maxhealth')
            if prefab.startswith('ruins_rubble_'):
                result['ruinsRelic'] = {'rubble': True}
            return result  # Early snapshots omit component data; the constructor supplies it.
        health = ancient.get('health')
        default_health = maximum * (.2 if rubble else .8)
        current = health.get('health', default_health) if health else default_health
        state = {'current': current, 'maximum': maximum}
        result['health'] = validate_fields(schema.HEALTH_RANGE, state, f'Invalid {prefab} health')
        return result
    return convert


def shadow_forge_components(data: object) -> Components:
    """shadow_forge.lua has no OnSave and workable saves nothing."""
    if data is not None:
        validate(schema.EMPTY, data, 'Unsupported shadow_forge save state')
    return {}
