#!/usr/bin/env python3
"""Import selected DST cave regions and whitelisted entities into a local save."""
import argparse
import base64
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import runpy
import struct

LITERALS = runpy.run_path(str(Path(__file__).with_name('dst-save-literal.py')))
ROOT = Path(__file__).resolve().parent.parent
TILE_SIZE = 12


def source_grid_position(coordinate, extent):
    # map/bunch_spawner.lua and waterlog_worldgen.lua checkIfValidGround:
    # floor(extent / 2 + .5 + coordinate / TILE_SCALE).
    # These are cell-boundary coordinates, matching the project's floor(world / TILE_SIZE).
    return coordinate / 4 + extent / 2 + .5


def pighead_components(data):
    # stickheads.lua onsave/onload. Workable.savestate is false; awake is rebuilt.
    if set(data) - {'burnt', 'workable'} or data.get('workable'):
        raise ValueError('Unsupported pighead save state')
    if data.get('burnt') is not None and data.get('burnt') is not True:
        raise ValueError('Expected a true pighead burnt flag')
    return {'building': {'state': 'idle', **({'burnt': True} if data.get('burnt') else {})}}


def archive_moon_statue_components(data):
    # archive_props.lua onsave/onloadpostpass; mining work is deliberately not persisted.
    if set(data) - {'anim', 'workable'} or data.get('workable'):
        raise ValueError('Unsupported archive_moon_statue save state')
    anim = data.get('anim')
    if type(anim) is not int or not 1 <= anim <= 4:
        raise ValueError('Expected archive_moon_statue anim in 1..4')
    return {'archiveProp': {'anim': anim}}


def cave_exit_components(data):
    # worldmigrator.lua OnSave (id/auto/linkedWorld/receivedPortal) belongs to the shard link, which is not connected yet.
    migrator = data.get('worldmigrator')
    if set(data) != {'worldmigrator'} or not isinstance(migrator, dict) \
            or set(migrator) - {'id', 'auto', 'linkedWorld', 'receivedPortal'}:
        raise ValueError('Unsupported cave_exit save state')
    return {}


def mushtree_components(data, medium):
    # mushtree.lua / mushtree_moon.lua OnSave plus growable/plantregrowth. plantregrowth (offspring regrowth) is not
    # ported, so its timer is not carried over; a stump's decay timer is rebuilt when the stump is made.
    allowed = {'plantregrowth', 'stump', 'burnt', 'treestate', 'growable'} if medium else {'plantregrowth', 'stump', 'burnt'}
    if set(data) - allowed or data.get('timer') is not None:
        raise ValueError('Unsupported mushtree save state')
    for flag in ('stump', 'burnt'):
        if flag in data and data[flag] is not True:
            raise ValueError(f'Expected a true mushtree {flag} flag')
    if data.get('stump') and data.get('burnt'):
        raise ValueError('A burnt mushtree is not a stump')
    components = {}
    state = {key: True for key in ('stump', 'burnt') if data.get(key)}
    if 'treestate' in data:
        if data['treestate'] not in ('normal', 'bloom'):
            raise ValueError('Unsupported mushtree treestate')
        state['treestate'] = data['treestate']
    if state:
        components['mushtree'] = state
    growth = data.get('growable')
    if growth is not None:
        if not isinstance(growth, dict) or set(growth) - {'stage', 'time', 'sleeptime', 'usetimemultiplier'} \
                or growth.get('usetimemultiplier') not in (None, False) \
                or type(growth.get('stage')) is not int or not 1 <= growth['stage'] <= 3 \
                or any(type(growth[key]) not in (int, float) or growth[key] < 0 for key in ('time', 'sleeptime') if key in growth):
            raise ValueError('Unsupported mushtree growable state')
        components['growable'] = {key: growth[key] for key in ('stage', 'time', 'sleeptime') if key in growth}
    return components


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


def grotto_glass_components(data):
    # grotto_pool_moonglass.lua / grotto_waterfall_small.lua: workable.savestate writes workleft (and maxwork -1).
    if set(data) - {'workable'}:
        raise ValueError('Unsupported grotto prop save state')
    work = data.get('workable')
    if work is None:
        return {}
    if not isinstance(work, dict) or set(work) - {'workleft', 'maxwork'} or work.get('maxwork', -1) != -1 \
            or type(work.get('workleft')) not in (int, float) or not 0 <= work['workleft'] <= 6:
        raise ValueError('Unsupported grotto prop workable state')
    return {'grottoGlass': {'workleft': work['workleft']}}


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


def blue_mushroom_components(data):
    # mushrooms.lua OnSave: rain only while positive. The open/closed pose follows the world phase, and the pickable
    # component saves nothing for an unpicked mushroom; a saved pickable (picked, caninteractwith...) is not carried over.
    if set(data) - {'rain'}:
        raise ValueError('Unsupported blue_mushroom save state')
    rain = data.get('rain')
    if rain is None:
        return {}
    if type(rain) is not int or not 1 <= rain <= 20:
        raise ValueError('Expected blue_mushroom rain in 1..20')
    return {'mushroom': {'rain': rain}}


def rock_components(data):
    # rocks.lua: these prefabs have no OnSave fields; workable.savestate defaults to false.
    if set(data) - {'workable'} or data.get('workable'):
        raise ValueError('Unsupported rock save state')
    return {}


def cavein_boulder_components(data):
    # cavein_boulder.lua OnSave: the default swap_boulder symbol omits variation (1).
    # Only ground art is ported; reject falling/linked formations rather than lose their state.
    if set(data) - {'variation', 'raised', 'formed', 'submersible', 'workable'} or data.get('workable'):
        raise ValueError('Unsupported cavein_boulder save state')
    variation = data.get('variation', 1)
    if type(variation) is not int or not 1 <= variation <= 8:
        raise ValueError('Expected cavein_boulder variation in 1..8')
    for flag in ('raised', 'formed'):
        if flag in data and data[flag] is not True:
            raise ValueError(f'Expected a true cavein_boulder {flag} flag')
    if data.get('raised') and data.get('formed'):
        raise ValueError('A raised cavein_boulder does not save formed')
    submersible = data.get('submersible')
    if submersible is not None and submersible != {'force_no_repositioning': False}:
        raise ValueError('Unsupported cavein_boulder submersible state')
    return {'caveinBoulder': {'variation': variation, **{flag: True for flag in ('raised', 'formed') if data.get(flag)}}}


def pickable_state(data, prefab):
    # pickable.lua OnSave -> PickableSaveState. caninteractwith is its default true; stuck and pause_time have no
    # project equivalent, so reject them rather than lose the state.
    if set(data) - {'protected_cycles', 'picked', 'transplanted', 'paused', 'caninteractwith', 'cycles_left', 'max_cycles', 'time'}:
        raise ValueError(f'Unsupported {prefab} pickable state')
    for flag in ('picked', 'transplanted', 'paused', 'caninteractwith'):
        if flag in data and data[flag] is not True:
            raise ValueError(f'Expected a true {prefab} pickable {flag} flag')
    for key in ('protected_cycles', 'cycles_left', 'max_cycles', 'time'):
        if key in data and (type(data[key]) not in (int, float) or data[key] < 0):
            raise ValueError(f'Invalid {prefab} pickable {key}')
    names = {'picked': 'picked', 'time': 'regrowSeconds', 'paused': 'paused', 'transplanted': 'transplanted',
             'cycles_left': 'cyclesLeft', 'max_cycles': 'maxCycles', 'protected_cycles': 'protectedCycles'}
    return {names[key]: data[key] for key in names if key in data}


def pickable_plant_components(prefab):
    # grass.lua / sapling.lua add no OnSave fields of their own.
    def convert(data):
        if set(data) - {'pickable'}:
            raise ValueError(f'Unsupported {prefab} save state')
        state = pickable_state(data.get('pickable') or {}, prefab)
        return {'pickable': state} if state else {}
    return convert


def cave_fern_components(prefab):
    # cave_fern.lua / cave_fern_withered.lua OnSave: data.anim is one of f1..f10.
    def convert(data):
        if set(data) - {'pickable', 'anim'}:
            raise ValueError(f'Unsupported {prefab} save state')
        if data.get('anim') not in [f'f{number}' for number in range(1, 11)]:
            raise ValueError(f'Expected {prefab} anim in f1..f10')
        state = pickable_state(data.get('pickable') or {}, prefab)
        return {**({'pickable': state} if state else {}), 'variant': {'anim': data['anim']}}
    return convert


def houndbone_components(data):
    # houndbone.lua OnSave: data.bonetype (1..3). The legacy `anim` field is no longer written, and workable saves nothing.
    if set(data) != {'bonetype'} or type(data['bonetype']) is not int or not 1 <= data['bonetype'] <= 3:
        raise ValueError('Unsupported houndbone save state')
    return {'houndbone': {'bonetype': data['bonetype']}}


def bulb_timers(data, light_state):
    # timer.lua OnSave: only the running turnoff (ON) or recharge (RECHARGING) task is meaningful, and never a paused one.
    timers = (data.get('timer') or {}).get('timers', {})
    if set(data.get('timer') or {}) - {'timers'} or set(timers) - {'turnoff', 'recharge'}:
        raise ValueError('Unsupported bulb plant timer state')
    for name, timer in timers.items():
        if not isinstance(timer, dict) or timer.get('paused') is not False or type(timer.get('timeleft')) not in (int, float) \
                or timer['timeleft'] <= 0:
            raise ValueError(f'Unsupported bulb plant {name} timer')
    expected = {'ON': 'turnoff', 'RECHARGING': 'recharge'}.get(light_state)
    if set(timers) - {expected}:
        raise ValueError(f'Unexpected bulb plant timer in {light_state}')
    return timers


def bulb_light_state(data, picked):
    light_state = data.get('light_state')
    if light_state not in ('ON', 'CHARGED', 'RECHARGING') or (picked and light_state == 'ON'):
        raise ValueError('Unsupported bulb plant light_state')
    return light_state


def bulb_pickable(data, prefab):
    # pickable.lua OnSave: picked and the remaining regrow `time`; caninteractwith is the default.
    pickable = data.get('pickable') or {}
    if set(pickable) - {'picked', 'caninteractwith', 'time'} or pickable.get('picked', True) is not True:
        raise ValueError(f'Unsupported {prefab} pickable state')
    if 'time' in pickable and (not pickable.get('picked') or type(pickable['time']) not in (int, float) or pickable['time'] <= 0):
        raise ValueError(f'Unsupported {prefab} pickable time')
    return bool(pickable.get('picked'))


def flower_cave_components(prefab):
    # flower_cave.lua OnSave: light_state (+ plantname for the single flower); double/triple have fixed art.
    fixed = {'flower_cave_double': 'double', 'flower_cave_triple': 'triple'}.get(prefab)

    def convert(data):
        if set(data) - {'light_state', 'pickable', 'plantname', 'timer'} or (fixed is not None and 'plantname' in data):
            raise ValueError(f'Unsupported {prefab} save state')
        variant = fixed or {'_single': 'single', '_springy': 'springy'}.get(data.get('plantname'))
        if variant is None:
            raise ValueError(f'Unsupported {prefab} plantname')
        picked = bulb_pickable(data, prefab)
        light_state = bulb_light_state(data, picked)
        timers = bulb_timers(data, light_state)
        if picked and timers:
            raise ValueError(f'A picked {prefab} has no light timer')
        state = {'variant': variant, 'lightState': light_state}
        if not picked and light_state != 'CHARGED':
            if not timers:
                raise ValueError(f'Missing {prefab} light timer')
            state['remainingSeconds'] = next(iter(timers.values()))['timeleft']
        if picked:
            state['picked'] = True
            if 'time' in data['pickable']:
                state['regrowSeconds'] = data['pickable']['time']
        return {'bulbPlant': state}
    return convert


def lightflier_flower_components(data):
    # lightflier_flower.lua OnSave: light_state + plantname, plus the pickable, timer and childspawner components.
    # Children are source GUIDs, linked to imported entities by link_lightflier_flowers.
    if set(data) - {'light_state', 'pickable', 'plantname', 'timer', 'childspawner'}:
        raise ValueError('Unsupported lightflier_flower save state')
    variant = {'_single': 'single', '_springy': 'springy'}.get(data.get('plantname'))
    spawner = data.get('childspawner')
    if variant is None or not isinstance(spawner, dict) or type(spawner.get('childreninside')) is not int \
            or not 0 <= spawner['childreninside'] <= 1 or not isinstance(spawner.get('childrenoutside'), list) \
            or any(type(child) is not int or child < 0 for child in spawner['childrenoutside']):
        raise ValueError('Unsupported lightflier_flower save state')
    picked = bulb_pickable(data, 'lightflier_flower')
    light_state = bulb_light_state(data, picked)
    timers = bulb_timers(data, light_state)
    state = {'variant': variant, 'lightState': light_state,
             'childspawner': {'childreninside': spawner['childreninside'], 'childrenoutside': spawner['childrenoutside']}}
    if 'recharge' in timers:
        state['rechargeSeconds'] = timers['recharge']['timeleft']
    if 'turnoff' in timers:
        state['turnoffSeconds'] = timers['turnoff']['timeleft']
    if picked:
        state['picked'] = True
        if 'time' in data['pickable']:
            state['regrowSeconds'] = data['pickable']['time']
    return {'lightflierFlower': state}


def link_lightflier_flowers(result, imported_ids):
    # Only imported lightfliers can be linked; the others are not part of the selection.
    for entity in result.get('lightflier_flower', []):
        spawner = entity['components']['lightflierFlower']['childspawner']
        spawner['childrenoutside'] = [imported_ids[child] for child in spawner['childrenoutside'] if child in imported_ids]


def evergreen_components(data):
    # evergreens.lua OnSave plus growable/plantregrowth; plantregrowth (offspring regrowth) is not ported.
    if set(data) - {'growable', 'plantregrowth', 'stump', 'burnt', 'burntcone'}:
        raise ValueError('Unsupported evergreen save state')
    for flag in ('stump', 'burnt', 'burntcone'):
        if flag in data and data[flag] is not True:
            raise ValueError(f'Expected a true evergreen {flag} flag')
    if data.get('stump') and data.get('burnt'):
        raise ValueError('A burnt evergreen is not a stump')
    growth = data.get('growable')
    if not isinstance(growth, dict) or set(growth) - {'stage', 'time', 'sleeptime', 'usetimemultiplier'} \
            or growth.get('usetimemultiplier') not in (None, False) \
            or type(growth.get('stage')) is not int or not 1 <= growth['stage'] <= 4 \
            or any(type(growth[key]) not in (int, float) or growth[key] < 0 for key in ('time', 'sleeptime') if key in growth):
        raise ValueError('Unsupported evergreen growable state')
    state = {key: True for key in ('stump', 'burnt', 'burntcone') if data.get(key)}
    return {**({'evergreen': state} if state else {}),
            'growable': {key: growth[key] for key in ('stage', 'time', 'sleeptime') if key in growth}}


# Each whitelist entry owns the source -> project component-state conversion.
# Adding a prefab here requires an actual converter, rather than copying arbitrary Lua data.
ENTITY_WHITELIST = {
    'pighead': pighead_components,
    'archive_moon_statue': archive_moon_statue_components,
    'cave_exit': cave_exit_components,
    'mushtree_moon': lambda data: mushtree_components(data, False),
    'mushtree_medium': lambda data: mushtree_components(data, True),
    'mushtree_tall': lambda data: mushtree_components(data, True),
    'blue_mushroom': blue_mushroom_components,
    'grass': pickable_plant_components('grass'),
    'sapling': pickable_plant_components('sapling'),
    'evergreen': evergreen_components,
    'flower_cave': flower_cave_components('flower_cave'),
    'flower_cave_double': flower_cave_components('flower_cave_double'),
    'flower_cave_triple': flower_cave_components('flower_cave_triple'),
    'lightflier_flower': lightflier_flower_components,
    'houndbone': houndbone_components,
    'cave_fern': cave_fern_components('cave_fern'),
    'cave_fern_withered': cave_fern_components('cave_fern_withered'),
    'rock1': rock_components,
    'rock2': rock_components,
    'cavein_boulder': cavein_boulder_components,
    'rock_moon_shell': rock_components,
    'rock_flintless': rock_components,
    'rock_flintless_med': rock_components,
    'rock_flintless_low': rock_components,
    'rock_moon': rock_components,
    'grotto_pool_big': lambda data: grotto_pool_components(data, True),
    'grotto_pool_small': lambda data: grotto_pool_components(data, False),
    'grotto_moonglass_1': grotto_glass_components,
    'grotto_moonglass_3': grotto_glass_components,
    'grotto_moonglass_4': grotto_glass_components,
    'grotto_waterfall_big': grotto_waterfall_components,
    'grotto_waterfall_small1': grotto_glass_components,
    'grotto_waterfall_small2': grotto_glass_components,
}


def convert_entities(terrain, source_entities, report, session_id):
    width, height = terrain['width'], terrain['height']
    nodes = decode_grid(terrain['nodeidtilemap'], width, height)
    names = terrain['topology']['ids']
    selected = set(report['nodes'])
    translation = report['translation']
    result, counts, sources, identities, imported_ids = {}, {}, [], set(), {}
    for prefab, convert_components in ENTITY_WHITELIST.items():
        records = source_entities.get(prefab, [])
        imported = []
        for index, record in enumerate(records, 1):
            coordinates = [record.get(axis, 0) for axis in ('x', 'y', 'z')]
            if any(type(value) not in (int, float) or not math.isfinite(value) for value in coordinates):
                raise ValueError(f'Invalid {prefab} position at source index {index}')
            x, y, z = coordinates
            col, row = math.floor(source_grid_position(x, width)), math.floor(source_grid_position(z, height))
            if not (0 <= col < width and 0 <= row < height):
                continue
            node = nodes[row * width + col]
            # Keep source props on overhang/void cells too: region membership is independent of land.
            if node == 0 or names[node - 1] not in selected:
                continue
            if y != 0 or record.get('skinname') or record.get('skin_id') or record.get('puid'):
                raise ValueError(f'Unsupported {prefab} height, skin or platform at source index {index}')
            data = record.get('data') or {}
            if not isinstance(data, dict):
                raise ValueError(f'Expected {prefab} component data at source index {index}')
            source_id = record.get('id')
            if source_id is not None and (type(source_id) is not int or source_id < 0):
                raise ValueError(f'Invalid {prefab} source ID')
            suffix = f'id_{source_id}' if source_id is not None else f'index_{index:06}'
            entity_id = f'dst_{session_id}_{prefab}_{suffix}'
            if entity_id in identities:
                raise ValueError(f'Duplicate imported entity ID: {entity_id}')
            identities.add(entity_id)
            if source_id is not None:
                imported_ids[source_id] = entity_id
            imported.append({'id': entity_id,
                             'transform': {'position': [round(value * TILE_SIZE / 4 + shift, 6)
                                                        for value, shift in zip(coordinates, translation)], 'rotationY': 0},
                             'components': convert_components(data)})
            sources.append({'id': entity_id, 'prefab': prefab, 'sourceIndex': index,
                            **({'sourceId': source_id} if source_id is not None else {}),
                            'sourcePosition': coordinates, 'sourceNode': names[node - 1]})
        if imported:
            result[prefab] = imported
        counts[prefab] = {'source': len(records), 'imported': len(imported), 'outsideRegion': len(records) - len(imported)}
    link_grotto_pools(result, imported_ids)
    link_lightflier_flowers(result, imported_ids)
    return result, {'entityWhitelist': list(ENTITY_WHITELIST), 'entityCounts': counts, 'entitySources': sources}


def decode_grid(encoded, width, height):
    data = base64.b64decode(encoded, validate=True)
    if data[:9] != b'VRSN\0\x01\0\0\0' or len(data) != 9 + width * height * 2:
        raise ValueError('Unsupported DST grid header or dimensions')
    return struct.unpack(f'<{width * height}H', data[9:])


def convert(terrain, template, regions, supported, origin_cell=None):
    if terrain['prefab'] != 'cave':
        raise ValueError('Only cave terrain imports are supported')
    width, height = terrain['width'], terrain['height']
    tiles = decode_grid(terrain['tiles'], width, height)
    nodes = decode_grid(terrain['nodeidtilemap'], width, height)
    names = terrain['topology']['ids']
    if max(nodes) > len(names):
        raise ValueError('Grid references an unknown topology node')
    available = {name.split(':')[0] for name in names}
    if set(regions) - available:
        raise ValueError(f'Unknown regions: {sorted(set(regions) - available)}')
    selected = {i for i, name in enumerate(names, 1) if name.split(':')[0] in regions}
    # IDs are versioned: resolve source ID -> source name -> current runtime ID.
    source_names = {tile_id: name for name, tile_id in terrain['world_tile_map'].items()}
    selected_cells = []
    for index, (tile_id, node_id) in enumerate(zip(tiles, nodes)):
        if node_id not in selected:
            continue
        name = source_names.get(tile_id)
        if name == 'IMPASSABLE':
            continue
        if name not in supported:
            raise ValueError(f'Unsupported terrain {name or tile_id} in {names[node_id - 1]}')
        selected_cells.append((index % width, index // width, name, supported[name], node_id))
    land = [cell for cell in selected_cells if cell[2] != 'FAKE_GROUND']
    if not land:
        raise ValueError('Selected regions contain no land')
    min_x, max_x = min(c[0] for c in land), max(c[0] for c in land)
    min_z, max_z = min(c[1] for c in land), max(c[1] for c in land)
    origin_x, origin_z = origin_cell if origin_cell is not None else ((min_x + max_x) // 2, (min_z + max_z) // 2)
    half = max(max(abs(c[0] - origin_x), abs(c[1] - origin_z)) + 1 for c in selected_cells) + 2
    saved_tiles = [{'col': x - origin_x, 'row': z - origin_z, 'tileId': tile_id}
                   for x, z, _, tile_id, _ in selected_cells]
    # Prefer the blue forest, keeping the player away from the void edge.
    spawn_cells = [c for c in land if names[c[4] - 1].startswith(regions[0] + ':')]
    if not spawn_cells:
        raise ValueError('First selected region contains no land for player spawn')
    occupied = {(c[0], c[1]) for c in land}
    interior = [c for c in spawn_cells if all((c[0] + dx, c[1] + dz) in occupied
                for dx in (-1, 0, 1) for dz in (-1, 0, 1))]
    if not interior:
        raise ValueError('No safe interior spawn tile in the first region')
    cx = sum(c[0] for c in spawn_cells) / len(spawn_cells)
    cz = sum(c[1] for c in spawn_cells) / len(spawn_cells)
    spawn = min(interior, key=lambda c: (c[0] - cx) ** 2 + (c[1] - cz) ** 2)
    result = json.loads(json.dumps(template))
    result['world'] = {
        'shardId': 'caves', 'prefab': 'cave', 'elapsedSeconds': 0, 'systems': {},
        'map': {'kind': 'generated', 'defaultTileId': 1, 'tiles': saved_tiles,
                'generator': {'id': 'dst-region-v1', 'options': {
                    'size': half * 2 * TILE_SIZE, 'moonTreeCount': 0, 'moonTreeExclusionRadiusSquared': 0}}},
        'entities': {},
    }
    player = result['players']['local']
    player['prefab'] = 'wilson'
    player['shardId'] = 'caves'
    player['transform'] = {'position': [(spawn[0] - origin_x + .5) * TILE_SIZE, 0,
                                         (spawn[1] - origin_z + .5) * TILE_SIZE], 'rotationY': 0}
    player.pop('ghost', None)
    player['stats'] = {'health': 150, 'hunger': 150, 'sanity': 200}
    player['inventory'] = {'containers': {
        'player:inventory': {'slotCount': 15, 'slots': []},
        'player:equipment': {'slotCount': 3, 'slots': []},
        'player:cursor': {'slotCount': 1, 'slots': []},
    }, 'bufferedBuilds': []}
    report = {
        'regions': regions, 'nodes': [names[i - 1] for i in sorted(selected)],
        'sourceDimensions': [width, height], 'sourceBounds': [min_x, min_z, max_x, max_z],
        'sourceOriginCell': [origin_x, origin_z], 'worldScale': TILE_SIZE / 4,
        'translation': [(source_grid_position(0, width) - origin_x) * TILE_SIZE, 0,
                        (source_grid_position(0, height) - origin_z) * TILE_SIZE],
        'tileCounts': dict(sorted(Counter(c[2] for c in selected_cells).items())),
        'landCells': len(land), 'savedCells': len(saved_tiles),
        'note': 'Original impassable gaps and FAKE_GROUND are non-walkable; only whitelisted source entities are imported. No bridges are generated.',
    }
    return result, report


def write_or_check(path, data, check):
    serialized = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    if check:
        if not path.is_file() or path.read_text() != serialized:
            raise ValueError(f'{path} differs from the source import')
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(serialized)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--shard', required=True, type=Path, help='DST Caves shard directory')
    parser.add_argument('--output', required=True, type=Path, help='Project save JSON path')
    parser.add_argument('--template', type=Path, default=ROOT / 'public/saves/initial-world.json')
    parser.add_argument('--regions', nargs='+', default=['BlueForest', 'MoonCaveForest', 'ArchiveMaze', 'CaveExitTask1'])
    parser.add_argument('--origin-cell', nargs=2, type=int, metavar=('COL', 'ROW'),
                        help='Keep an existing source origin when extending an imported region')
    parser.add_argument('--snapshot', help='Ten-digit snapshot; defaults to latest in active session')
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    shard = args.shard.resolve()
    index = LITERALS['returned_table']((shard / 'save/shardindex').read_text())
    session_id = index['session_id']
    if not isinstance(session_id, str) or not session_id.isalnum():
        raise ValueError('Invalid session ID')
    session = shard / 'save/session' / session_id
    candidates = sorted(p for p in session.iterdir() if p.is_file() and len(p.name) == 10 and p.name.isdigit())
    if not candidates:
        raise ValueError('No world snapshots found')
    snapshot = args.snapshot or candidates[-1].name
    if len(snapshot) != 10 or not snapshot.isdigit():
        raise ValueError('Snapshot must contain ten digits')
    source = session / snapshot
    source_text = source.read_text()
    terrain = LITERALS['snapshot_map'](source_text)
    supported = {name: spec['tileId'] for name, spec in json.loads(
        (ROOT / 'packages/prefab/src/groundTiles.json').read_text()).items()}
    supported['FAKE_GROUND'] = 200
    result, report = convert(terrain, json.loads(args.template.read_text()), args.regions, supported, args.origin_cell)
    source_entities = LITERALS['snapshot_entities'](source_text, ENTITY_WHITELIST)
    result['world']['entities'], entity_report = convert_entities(terrain, source_entities, report, session_id)
    report.update(entity_report)
    result['session']['id'] = f'cave-{session_id}-region-v1'
    result['snapshot'] = {**result['snapshot'], 'id': snapshot, 'parentId': None, 'reason': 'initial'}
    report['source'] = f'{args.shard.as_posix()}/save/session/{session_id}/{snapshot}'
    report['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    write_or_check(args.output, result, args.check)
    write_or_check(args.output.with_suffix('.import.json'), report, args.check)
    print(f'{"Checked" if args.check else "Imported"} {report["landCells"]} land cells '
          f'from {len(report["nodes"])} nodes and {sum(len(records) for records in result["world"]["entities"].values())} '
          f'whitelisted entities into {args.output}')


if __name__ == '__main__':
    main()
