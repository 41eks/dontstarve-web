#!/usr/bin/env python3
"""Landmark save states: shard migrators, spawned child props and pond layouts."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESEARCH_LAB_SKINS = {
    prefab: set(definition['skinArchives'])
    for prefab, definition in json.loads((ROOT / 'packages/prefab/src/definitions.json').read_text())['animatedBuildings'].items()
    if prefab in ('researchlab', 'researchlab2', 'researchlab3', 'researchlab4')
}


def researchlab_components(prefab):
    # scienceprototyper.lua / magicprototyper.lua OnSave write only burnt.
    # workable.lua writes {} when savestate is false; skinname lives on the entity record.
    def convert(data, context):
        if set(data) - {'burnt', 'workable'} or ('workable' in data and data['workable'] != {}):
            raise ValueError(f'Unsupported {prefab} save state')
        if 'burnt' in data and data['burnt'] is not True:
            raise ValueError(f'Expected a true {prefab} burnt flag')
        skin = context['skin']
        if skin is not None and skin not in RESEARCH_LAB_SKINS[prefab]:
            raise ValueError(f'Unsupported {prefab} skin: {skin}')
        return {'building': {'state': 'idle',
                             **({'skinId': skin} if skin is not None else {}),
                             **({'burnt': True} if data.get('burnt') else {})}}
    return convert


def pigking_components(data):
    # pigking.lua has no OnSave; trader and sleep/stategraph state are rebuilt on load.
    if data:
        raise ValueError('Unsupported pigking save state')
    return {}


def atrium_gate_components(data):
    # atrium_gate.lua OnSave plus the component records used by OnLoadPostPass.
    if set(data) - {'vault_key_socketed', 'can_spawn_charlie_hand_keystone', 'launch_key',
                    'pickable', 'charliecutscene', 'worldsettingstimer', 'entitytracker', 'ritual_state'}:
        raise ValueError('Unsupported atrium_gate save state')
    if 'ritual_state' in data and data['ritual_state'] != 0:
        raise ValueError('Unsupported atrium_gate ritual_state')
    result = {}
    own = {key: True for key in ('vault_key_socketed', 'can_spawn_charlie_hand_keystone', 'launch_key') if data.get(key) is True}
    for key in ('vault_key_socketed', 'can_spawn_charlie_hand_keystone', 'launch_key'):
        if key in data and data[key] is not True:
            raise ValueError(f'Unsupported atrium_gate {key} flag')
    if own:
        result['atriumGate'] = own
    for source, target, allowed in (
        ('pickable', 'pickable', {'picked', 'paused', 'caninteractwith'}),
        ('charliecutscene', 'charliecutscene', {'running', 'gatefixed'}),
    ):
        value = data.get(source)
        if value is not None:
            if not isinstance(value, dict) or set(value) - allowed or any(flag is not True for flag in value.values()):
                raise ValueError(f'Unsupported atrium_gate {source} state')
            result[target] = value
    timer = data.get('worldsettingstimer')
    if timer is not None:
        if not isinstance(timer, dict) or set(timer) != {'timers'} or not isinstance(timer['timers'], dict) \
                or set(timer['timers']) - {'destabilizing', 'destabilizedelay', 'cooldown'}:
            raise ValueError('Unsupported atrium_gate worldsettingstimer')
        for name, entry in timer['timers'].items():
            if not isinstance(entry, dict) or set(entry) - {'timeleft', 'paused', 'blocklongupdate', 'initial_time'} \
                    or type(entry.get('timeleft')) not in (int, float) or not 0 <= entry['timeleft'] <= 1 \
                    or ('paused' in entry and type(entry['paused']) is not bool) \
                    or ('blocklongupdate' in entry and type(entry['blocklongupdate']) is not bool) \
                    or ('initial_time' in entry and (type(entry['initial_time']) not in (int, float) or not 0 <= entry['initial_time'] <= 9600)):
                raise ValueError(f'Unsupported atrium_gate {name} timer')
        result['worldsettingstimer'] = {'timers': {
            name: {**entry, 'paused': entry.get('paused', False)} for name, entry in timer['timers'].items()}}
    tracker = data.get('entitytracker')
    if tracker is not None:
        if not isinstance(tracker, dict) or set(tracker) != {'entities'} or not isinstance(tracker['entities'], list) \
                or any(not isinstance(entry, dict) or set(entry) != {'name', 'GUID'} \
                       or entry['name'] not in ('stalker', 'charlie_hand') or type(entry['GUID']) is not int or entry['GUID'] < 0
                       for entry in tracker['entities']):
            raise ValueError('Unsupported atrium_gate entitytracker')
        result['entitytracker'] = tracker
    return result


def cave_exit_components(data):
    # worldmigrator.lua OnSave (id/auto/linkedWorld/receivedPortal) belongs to the shard link, which is not connected yet.
    if not data:
        return {}
    migrator = data.get('worldmigrator')
    if set(data) != {'worldmigrator'} or not isinstance(migrator, dict) \
            or set(migrator) - {'id', 'auto', 'linkedWorld', 'receivedPortal'}:
        raise ValueError('Unsupported cave_exit save state')
    return {}


def cave_entrance_components(allowed):
    # worldmigrator.lua OnSave belongs to the shard link; childspawner/worldsettingstimer (bats) are not ported either,
    # so the open entrance keeps only identity and position. Closed workable.savestate is false.
    def convert(data):
        if not data:
            return {}
        migrator = data.get('worldmigrator')
        if not isinstance(migrator, dict) or set(migrator) - {'id', 'auto', 'linkedWorld', 'receivedPortal'} \
                or set(data) - allowed:
            raise ValueError('Unsupported cave_entrance save state')
        return {}
    return convert


def grotto_pool_components(data, big):
    # grotto_pool_big.lua / grotto_pool_small.lua on_save: children_ids + children_indexes, or the small pool's wf_id.
    # The source GUIDs become project entity IDs once every imported entity is known (see link_grotto_pools).
    if big:
        ids, indexes = data.get('children_ids', []), data.get('children_indexes', [])
        if set(data) - {'children_ids', 'children_indexes'} or not isinstance(ids, list) or not isinstance(indexes, list) \
                or len(ids) != len(indexes) or len(set(indexes)) != len(indexes) \
                or any(type(value) is not int or value < 0 for value in ids) \
                or any(type(value) is not int or not 1 <= value <= 5 for value in indexes):
            raise ValueError('Unsupported grotto_pool_big save state')
        children = [{'index': index, 'sourceId': child} for index, child in zip(indexes, ids)]
    else:
        if set(data) - {'wf_id'} or ('wf_id' in data and (type(data['wf_id']) is not int or data['wf_id'] < 0)):
            raise ValueError('Unsupported grotto_pool_small save state')
        children = [{'index': 1, 'sourceId': data['wf_id']}] if 'wf_id' in data else []
    return {'grottoPool': {'children': children}}


def grotto_waterfall_components(data):
    if data:
        raise ValueError('Unsupported grotto_waterfall_big save state')
    return {}


def link_grotto_pools(result, imported_ids):
    # Only children that were imported can be linked; a pool respawns any missing prop (setup_children).
    for prefab in ('grotto_pool_big', 'grotto_pool_small'):
        for entity in result.get(prefab, []):
            children = entity['components']['grottoPool']['children']
            entity['components']['grottoPool']['children'] = [
                {'index': child['index'], 'id': imported_ids[child['sourceId']]}
                for child in children if child['sourceId'] in imported_ids]
            if not entity['components']['grottoPool']['children']:
                del entity['components']['grottoPool']


def pond_components(data):
    # pond.lua OnSave: plants + childspawner/worldsettingstimer (frog spawner, not ported).
    # Only fishable is ported, and a full pond saves nothing, so the frog and plant state is validated and dropped.
    if set(data) - {'plants', 'childspawner', 'worldsettingstimer'}:
        raise ValueError('Unsupported pond save state')
    plants = data.get('plants', [])
    if not isinstance(plants, list) or any(not isinstance(plant, dict) or set(plant) != {'offset'}
                                           or not isinstance(plant['offset'], list) or len(plant['offset']) != 3
                                           or any(type(v) not in (int, float) or not math.isfinite(v) for v in plant['offset'])
                                           for plant in plants):
        raise ValueError('Unsupported pond plants')
    return {}


def lava_pond_components(data):
    # lava_pond.lua OnSave/OnLoad: the rock layout spawned around the pool.
    if set(data) - {'rocks'}:
        raise ValueError('Unsupported lava_pond save state')
    if 'rocks' not in data:
        return {}
    rocks = data['rocks']
    if not isinstance(rocks, list) or any(
            not isinstance(rock, dict) or set(rock) != {'rocktype', 'offset'}
            or rock['rocktype'] not in ('', '2', '3', '4', '5', '6', '7')
            or not isinstance(rock['offset'], list) or len(rock['offset']) != 3
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in rock['offset']) for rock in rocks):
        raise ValueError('Unsupported lava_pond rocks')
    return {'lavaPond': {'rocks': [{'rocktype': rock['rocktype'], 'offset': rock['offset']} for rock in rocks]}}
