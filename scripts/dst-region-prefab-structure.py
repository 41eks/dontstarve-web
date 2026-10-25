#!/usr/bin/env python3
"""Landmark save states: shard migrators, spawned child props and pond layouts."""
import math


def pigking_components(data):
    # pigking.lua has no OnSave; trader and sleep/stategraph state are rebuilt on load.
    if data:
        raise ValueError('Unsupported pigking save state')
    return {}


def cave_exit_components(data):
    # worldmigrator.lua OnSave (id/auto/linkedWorld/receivedPortal) belongs to the shard link, which is not connected yet.
    migrator = data.get('worldmigrator')
    if set(data) != {'worldmigrator'} or not isinstance(migrator, dict) \
            or set(migrator) - {'id', 'auto', 'linkedWorld', 'receivedPortal'}:
        raise ValueError('Unsupported cave_exit save state')
    return {}


def cave_entrance_components(allowed):
    # worldmigrator.lua OnSave belongs to the shard link; childspawner/worldsettingstimer (bats) are not ported either,
    # so the open entrance keeps only identity and position. Closed workable.savestate is false.
    def convert(data):
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
