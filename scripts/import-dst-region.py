#!/usr/bin/env python3
"""Import DST forest/cave maps, whitelisted entities and the player's position and inventory into project shard saves."""
import argparse
import base64
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import runpy
import struct
import subprocess
import zlib

LITERALS = runpy.run_path(str(Path(__file__).with_name('dst-save-literal.py')))
ROOT = Path(__file__).resolve().parent.parent
TILE_SIZE = 12
SHARDS = {'forest': ('Master', 'master'), 'cave': ('Caves', 'caves')}
# tiledefs.lua TileRanges.OCEAN; OCEAN_ICE belongs to LAND.
OCEAN_TILES = {'OCEAN_COASTAL_SHORE', 'OCEAN_COASTAL', 'OCEAN_WATERLOG', 'OCEAN_BRINEPOOL',
               'OCEAN_SWELL', 'OCEAN_ROUGH', 'OCEAN_HAZARDOUS', 'OCEAN_BRINEPOOL_SHORE'}


def source_grid_position(coordinate, extent):
    # map/bunch_spawner.lua and waterlog_worldgen.lua checkIfValidGround:
    # floor(extent / 2 + .5 + coordinate / TILE_SCALE).
    # These are cell-boundary coordinates, matching the project's floor(world / TILE_SIZE).
    return coordinate / 4 + extent / 2 + .5


def project_position(coordinates, translation):
    # DST's world is left-handed and Three.js is right-handed (see packages/ui/src/minimap-view.ts):
    # keep X and negate Z so the imported map is not mirrored.
    x, y, z = (round(value * TILE_SIZE / 4 + shift, 6) for value, shift in zip(coordinates, translation))
    return [x, y, 0 - z]


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
    # grass.lua / sapling.lua OnSave only add was_herd, which re-registers the herd with
    # lunarthrall_plantspawner (with herdmember's knownlocations); that spawner is not ported.
    # Transplanted grass also saves its grassgekko morph timers, and grassgekko is not ported either.
    def convert(data):
        extra = {'was_herd', 'knownlocations'} | ({'worldsettingstimer'} if prefab == 'grass' else set())
        if set(data) - {'pickable', 'witherable'} - extra or data.get('was_herd') not in (None, True):
            raise ValueError(f'Unsupported {prefab} save state')
        timers = (data.get('worldsettingstimer') or {}).get('timers') or {}
        if set(timers) - {'morphdelay', 'morphing', 'morphrelay'}:
            raise ValueError(f'Unsupported {prefab} worldsettingstimer state')
        locations = data.get('knownlocations') or {}
        if not isinstance(locations, dict) or set(locations) - {'locations'} \
                or any(not isinstance(location, dict) or location.get('name') != 'herd' for location in locations.get('locations') or []):
            raise ValueError(f'Unsupported {prefab} knownlocations state')
        state = pickable_state(data.get('pickable') or {}, prefab)
        components = {'pickable': state} if state else {}
        # witherable.lua OnSave -> the existing Witherable component. Protection tasks are not ported.
        if 'witherable' in data:
            wither = data['witherable']
            if not isinstance(wither, dict) or set(wither) - {'withered', 'restore_cycles', 'delay_time_remaining', 'task_time_remaining'} \
                    or ('withered' in wither and wither['withered'] is not True) \
                    or ('restore_cycles' in wither and (not wither.get('withered') or type(wither['restore_cycles']) is not int or wither['restore_cycles'] < 0)) \
                    or ('delay_time_remaining' in wither and 'task_time_remaining' in wither) \
                    or any(type(wither[key]) not in (int, float) or not math.isfinite(wither[key]) or not 0 <= wither[key] <= limit
                           for key, limit in [('delay_time_remaining', 480), ('task_time_remaining', 60)] if key in wither):
                raise ValueError(f'Unsupported {prefab} witherable state')
            fields = {'withered': 'withered', 'restore_cycles': 'restoreCycles',
                      'delay_time_remaining': 'delaySeconds', 'task_time_remaining': 'taskSeconds'}
            components['witherable'] = {fields[key]: value for key, value in wither.items()}
        return components
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
    # ChildSpawner:OnSave writes childrenoutside only when a child is out.
    if isinstance(spawner, dict):
        spawner = {'childrenoutside': [], **spawner}
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
    # Only imported lightfliers can be linked; the others are not in the whitelist.
    for entity in result.get('lightflier_flower', []):
        spawner = entity['components']['lightflierFlower']['childspawner']
        spawner['childrenoutside'] = [imported_ids[child] for child in spawner['childrenoutside'] if child in imported_ids]


def pigking_components(data):
    # pigking.lua has no OnSave; trader and sleep/stategraph state are rebuilt on load.
    if data:
        raise ValueError('Unsupported pigking save state')
    return {}


def flower_components(data):
    # flower.lua OnSave: anim + planted. Picking removes the entity, so only an unpicked flower persists.
    if set(data) - {'anim', 'planted', 'pickable'} or data.get('anim') not in [*[f'f{i}' for i in range(1, 11)], 'rose']:
        raise ValueError('Unsupported flower save state')
    if 'planted' in data and data['planted'] is not True:
        raise ValueError('Expected a true flower planted flag')
    pickable = data.get('pickable') or {}
    if not isinstance(pickable, dict) or set(pickable) - {'caninteractwith'} or pickable.get('caninteractwith', True) is not True:
        raise ValueError('Unsupported flower pickable state')
    return {'flower': {'animation': data['anim'], **({'planted': True} if data.get('planted') else {})}}


def insect_components(prefab):
    # fireflies.lua / butterfly.lua: these inventoryitem prefabs use the existing ground_item owner.
    # Stackable:OnSave only writes non-singleton stacks; live butterflies have maximum health 1.
    def convert(data):
        allowed = {'stackable', 'workable', 'inventoryitemmoisture'} | ({'health', 'perishable', 'knownlocations'} if prefab == 'butterfly' else set())
        if set(data) - allowed or data.get('workable'):
            raise ValueError(f'Unsupported {prefab} save state')
        stackable = data.get('stackable') or {}
        if not isinstance(stackable, dict) or set(stackable) - {'stack'} \
                or type(stackable.get('stack', 1)) is not int or not 1 <= stackable.get('stack', 1) <= 40:
            raise ValueError(f'Unsupported {prefab} stackable state')
        stack = {'itemId': prefab, 'count': stackable.get('stack', 1)}
        # InventoryItemMoisture:OnSave; the stack keeps only the wet flag, not the moisture level.
        moisture = data.get('inventoryitemmoisture') or {}
        if not isinstance(moisture, dict) or set(moisture) - {'wet', 'moisture'} or moisture.get('wet') not in (None, True):
            raise ValueError(f'Unsupported {prefab} moisture state')
        if moisture.get('wet'):
            stack['wet'] = True
        if prefab == 'butterfly':
            health = data.get('health') or {}
            if not isinstance(health, dict) or set(health) - {'health'} or type(health.get('health', 1)) not in (int, float) or health.get('health', 1) != 1:
                raise ValueError('Unsupported butterfly health state')
            locations = data.get('knownlocations') or {}
            if not isinstance(locations, dict) or set(locations) - {'locations'} or locations.get('locations') not in (None, []):
                raise ValueError('Unsupported butterfly knownlocations state')
            perish = data.get('perishable')
            if perish is not None:
                if not isinstance(perish, dict) or set(perish) - {'time', 'paused'} \
                        or perish.get('paused') is not True \
                        or type(perish.get('time')) not in (int, float) or not math.isfinite(perish['time']) \
                        or not 0 < perish['time'] <= 1440:
                    raise ValueError('Unsupported ground butterfly perishable state')
                stack['freshnessPercent'] = perish['time'] / 1440
        return {'stack': stack}
    return convert


def decay_timer_state(timer, prefab):
    # timer.lua: preserve the deadline, initial duration and paused state of the saved decay task.
    if not isinstance(timer, dict) or set(timer) != {'timers'} or not isinstance(timer['timers'], dict) \
            or set(timer['timers']) - {'decay'}:
        raise ValueError(f'Unsupported {prefab} timer state')
    for saved in timer['timers'].values():
        if not isinstance(saved, dict) or set(saved) != {'timeleft', 'initial_time', 'paused'} \
                or type(saved['paused']) is not bool \
                or any(type(saved[key]) not in (int, float) or not math.isfinite(saved[key]) for key in ('timeleft', 'initial_time')) \
                or not 0 <= saved['timeleft'] <= saved['initial_time'] <= 21600:
            raise ValueError(f'Unsupported {prefab} decay timer')
    return timer


def deciduoustree_components(data):
    # deciduoustrees.lua OnSave/OnLoad; hostile monster trees are a separate, unported behaviour branch.
    if set(data) - {'growable', 'plantregrowth', 'stump', 'burnt', 'burntcone', 'timer', 'monster',
                    'build', 'leaf_state', 'target_leaf_state', 'leaveschangetime'} or ('monster' in data and data['monster'] is not False):
        raise ValueError('Unsupported deciduoustree save state')
    # The normal growth table and dead-tree flags share the evergreen converter's validation.
    base = evergreen_components({key: value for key, value in data.items()
                                 if key in ('growable', 'plantregrowth', 'stump', 'burnt', 'burntcone', 'timer')})
    if base.get('growable', {}).get('stage', 1) > 3:
        raise ValueError('Expected deciduoustree growable stage in 1..3')
    state = base.pop('evergreen', {})
    if 'evergreenTimer' in base:
        base['deciduousTimer'] = base.pop('evergreenTimer')
    states = ('normal', 'colorful', 'barren')
    if data.get('leaf_state') not in states or (data.get('target_leaf_state') not in states
            and not (data.get('target_leaf_state') is None and (data.get('stump') or data.get('burnt')))):
        raise ValueError('Unsupported deciduoustree leaf state')
    if 'build' in data and data['build'] not in ('normal', 'red', 'orange', 'yellow', 'barren'):
        raise ValueError('Unsupported deciduoustree build')
    state.update({key: data[key] for key in ('build', 'leaf_state', 'target_leaf_state') if key in data})
    if 'leaveschangetime' in data:
        time = data['leaveschangetime']
        if data.get('stump') or data.get('burnt') or type(time) not in (int, float) or not math.isfinite(time) or not 0 <= time <= 900:
            raise ValueError('Unsupported deciduoustree leaf change timer')
        state['leaveschangetime'] = time
    return {**base, 'deciduoustree': state}


def evergreen_components(data):
    # evergreens.lua OnSave plus growable/plantregrowth; plantregrowth (offspring regrowth) is not ported.
    if set(data) - {'growable', 'plantregrowth', 'stump', 'burnt', 'burntcone', 'timer'}:
        raise ValueError('Unsupported evergreen save state')
    for flag in ('stump', 'burnt', 'burntcone'):
        if flag in data and data[flag] is not True:
            raise ValueError(f'Expected a true evergreen {flag} flag')
    if data.get('stump') and data.get('burnt'):
        raise ValueError('A burnt evergreen is not a stump')
    growth = data.get('growable')
    if growth is None and (data.get('stump') or data.get('burnt')):
        growth = {}
    elif not isinstance(growth, dict) or set(growth) - {'stage', 'time', 'sleeptime', 'usetimemultiplier'} \
            or growth.get('usetimemultiplier') not in (None, False) \
            or type(growth.get('stage')) is not int or not 1 <= growth['stage'] <= 4 \
            or any(type(growth[key]) not in (int, float) or growth[key] < 0 for key in ('time', 'sleeptime') if key in growth):
        raise ValueError('Unsupported evergreen growable state')
    state = {key: True for key in ('stump', 'burnt', 'burntcone') if data.get(key)}
    components = {**({'evergreen': state} if state else {}),
                  **({'growable': {key: growth[key] for key in ('stage', 'time', 'sleeptime') if key in growth}} if growth else {})}
    if 'timer' in data:
        components['evergreenTimer'] = decay_timer_state(data['timer'], 'evergreen')
    return components


def moon_tree_components(data):
    # moontree.lua on_save/on_load; size selects the same three growable stages.
    if set(data) - {'size', 'growable', 'plantregrowth', 'stump', 'burnt', 'timer'}:
        raise ValueError('Unsupported moon_tree save state')
    size = data.get('size', 'normal')
    if size not in ('short', 'normal', 'tall'):
        raise ValueError('Unsupported moon_tree size')
    base = evergreen_components({key: value for key, value in data.items() if key != 'size'})
    growth = base.get('growable')
    if growth and growth['stage'] != ('short', 'normal', 'tall').index(size) + 1:
        raise ValueError('Expected moon_tree stage to match size')
    state = base.pop('evergreen', {})
    if 'evergreenTimer' in base:
        base['moonTreeTimer'] = base.pop('evergreenTimer')
    return {**base, 'moonTree': {**state, 'size': size}}


def moonbutterfly_sapling_components(data):
    # planted_tree.lua: the timer component owns the saved grow deadline.
    if set(data) != {'timer'} or not isinstance(data['timer'], dict) or set(data['timer']) != {'timers'}:
        raise ValueError('Unsupported moonbutterfly_sapling save state')
    timers = data['timer']['timers']
    if not isinstance(timers, dict) or set(timers) != {'grow'}:
        raise ValueError('Unsupported moonbutterfly_sapling timers')
    grow = timers['grow']
    if not isinstance(grow, dict) or set(grow) != {'timeleft', 'initial_time', 'paused'} \
            or type(grow['paused']) is not bool \
            or any(type(grow[key]) not in (int, float) or not math.isfinite(grow[key]) for key in ('timeleft', 'initial_time')) \
            or not 150 <= grow['initial_time'] <= 300 or not 0 <= grow['timeleft'] <= grow['initial_time']:
        raise ValueError('Unsupported moonbutterfly_sapling grow timer')
    return {'saplingTimer': data['timer']}


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


# Each whitelist entry owns the source -> project component-state conversion.
# Adding a prefab here requires an actual converter, rather than copying arbitrary Lua data.
ENTITY_WHITELIST = {
    'pigking': pigking_components,
    'deciduoustree': deciduoustree_components,
    'moon_tree': moon_tree_components,
    'moonbutterfly_sapling': moonbutterfly_sapling_components,
    'fireflies': insect_components('fireflies'),
    'flower': flower_components,
    'butterfly': insect_components('butterfly'),
    'pighead': pighead_components,
    'archive_moon_statue': archive_moon_statue_components,
    'cave_exit': cave_exit_components,
    'cave_entrance': cave_entrance_components({'worldmigrator'}),
    'cave_entrance_open': cave_entrance_components({'worldmigrator', 'worldsettingstimer', 'childspawner'}),
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
    'pond': pond_components,
    'lava_pond': lava_pond_components,
}


def convert_entities(terrain, source_entities, report, session_id):
    width, height = terrain['width'], terrain['height']
    nodes = decode_grid(terrain['nodeidtilemap'], width, height)
    names = terrain['topology']['ids']
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
            # Import every whitelisted record, including props on void, unassigned nodes or map edges.
            node = nodes[row * width + col] if 0 <= col < width and 0 <= row < height else 0
            if node > len(names) and node not in report.get('unassignedNodeIds', []):
                raise ValueError('Grid references an unknown topology node')
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
            components = convert_components(data)
            if 'stack' in components:
                components['stack']['entityId'] = entity_id
            imported.append({'id': entity_id,
                             'transform': {'position': project_position(coordinates, translation), 'rotationY': 0},
                             'components': components})
            sources.append({'id': entity_id, 'prefab': prefab, 'sourceIndex': index,
                            **({'sourceId': source_id} if source_id is not None else {}),
                            'sourcePosition': coordinates, 'sourceNode': names[node - 1] if 0 < node <= len(names) else None})
        if imported:
            target_prefab = 'ground_item' if prefab in ('fireflies', 'butterfly') else prefab
            result.setdefault(target_prefab, []).extend(imported)
        counts[prefab] = {'source': len(records), 'imported': len(imported)}
    link_grotto_pools(result, imported_ids)
    link_lightflier_flowers(result, imported_ids)
    return result, {'entityWhitelist': list(ENTITY_WHITELIST), 'entityCounts': counts, 'entitySources': sources}


def decode_grid(encoded, width, height):
    data = base64.b64decode(encoded, validate=True)
    if data[:9] != b'VRSN\0\x01\0\0\0' or len(data) != 9 + width * height * 2:
        raise ValueError('Unsupported DST grid header or dimensions')
    return struct.unpack(f'<{width * height}H', data[9:])


def decode_underneath(terrain):
    # components/undertile.lua -> DataGrid:Save -> ZipAndEncodeSaveData.
    saved = terrain.get('persistdata', {}).get('undertile')
    if saved is None:
        return {}
    if not isinstance(saved, dict) or set(saved) != {'str'}:
        raise ValueError('Unsupported undertile save state')
    encoded = base64.b64decode(saved['str'], validate=True)
    if len(encoded) < 16:
        raise ValueError('Invalid zipped undertile header')
    version, offset, raw_size, compressed_size = struct.unpack('<4I', encoded[:16])
    if version != 1 or offset != 16 or compressed_size != len(encoded) - offset or raw_size > 16 * 1024 * 1024:
        raise ValueError('Unsupported zipped undertile header')
    decoder = zlib.decompressobj()
    raw = decoder.decompress(encoded[offset:], raw_size + 1)
    if len(raw) != raw_size or not decoder.eof or decoder.unused_data:
        raise ValueError('Invalid zipped undertile data')
    data = LITERALS['returned_table'](raw.decode())
    grid = data.get('underneath_tiles')
    if grid == []:
        return {}
    if not isinstance(grid, dict) or any(type(key) is not int or not 0 <= key < terrain['width'] * terrain['height']
                                         or type(value) is not int for key, value in grid.items()):
        raise ValueError('Invalid underlying tile grid')
    return grid


def convert(terrain, template, supported, origin_cell=None):
    prefab = terrain['prefab']
    if prefab not in SHARDS:
        raise ValueError('Only forest and cave terrain imports are supported')
    _, shard_id = SHARDS[prefab]
    width, height = terrain['width'], terrain['height']
    tiles = decode_grid(terrain['tiles'], width, height)
    nodes = decode_grid(terrain['nodeidtilemap'], width, height)
    names = terrain['topology']['ids']
    # IDs are versioned: resolve source ID -> source name -> current runtime ID.
    source_names = {tile_id: name for name, tile_id in terrain['world_tile_map'].items()}
    unassigned_nodes = set()
    map_cells = []
    for index, (tile_id, node_id) in enumerate(zip(tiles, nodes)):
        name = source_names.get(tile_id)
        if node_id > len(names):
            # Forest ocean cells can retain IDs after their topology nodes have been removed.
            if prefab != 'forest' or name not in OCEAN_TILES:
                raise ValueError('Grid references an unknown topology node')
            unassigned_nodes.add(node_id)
        if name == 'IMPASSABLE':
            continue
        if name not in supported:
            raise ValueError(f'Unsupported terrain {name or tile_id} at source cell ({index % width}, {index // width})')
        map_cells.append((index % width, index // width, name, supported[name], node_id))
    land = [cell for cell in map_cells if cell[2] != 'FAKE_GROUND' and cell[2] not in OCEAN_TILES]
    if not land:
        raise ValueError('Source map contains no land')
    min_x, max_x = min(c[0] for c in land), max(c[0] for c in land)
    min_z, max_z = min(c[1] for c in land), max(c[1] for c in land)
    origin_x, origin_z = origin_cell if origin_cell is not None else ((min_x + max_x) // 2, (min_z + max_z) // 2)
    # Include the complete source grid, including its impassable outer border.
    half = max(abs(origin_x), abs(width - 1 - origin_x), abs(origin_z), abs(height - 1 - origin_z)) + 3
    underneath = decode_underneath(terrain)
    saved_tiles = []
    for x, z, name, tile_id, _ in map_cells:
        # Source rows grow along DST +Z; project_position negates Z, so rows are mirrored around the origin.
        tile = {'col': x - origin_x, 'row': origin_z - z - 1, 'tileId': tile_id}
        if name in ('FARMING_SOIL', 'MONKEY_DOCK', 'OCEAN_ICE') and z * width + x in underneath:
            under_name = source_names.get(underneath[z * width + x])
            if under_name not in supported:
                raise ValueError(f'Unsupported underlying terrain {under_name}')
            tile['underTileId'] = supported[under_name]
        if name == 'MONKEY_DOCK' and 'underTileId' not in tile:
            raise ValueError(f'Missing underlying ocean at dock ({x}, {z})')
        saved_tiles.append(tile)
    # Choose a safe land tile near the map's land centre, without selecting a region.
    spawn_cells = land
    occupied = {(c[0], c[1]) for c in land}
    interior = [c for c in spawn_cells if all((c[0] + dx, c[1] + dz) in occupied
                for dx in (-1, 0, 1) for dz in (-1, 0, 1))]
    if not interior:
        raise ValueError('No safe interior spawn tile in the source map')
    cx = sum(c[0] for c in spawn_cells) / len(spawn_cells)
    cz = sum(c[1] for c in spawn_cells) / len(spawn_cells)
    spawn = min(interior, key=lambda c: (c[0] - cx) ** 2 + (c[1] - cz) ** 2)
    result = json.loads(json.dumps(template))
    result['world'] = {
        'shardId': shard_id, 'prefab': prefab, 'elapsedSeconds': 0, 'systems': {},
        'map': {'kind': 'generated', 'defaultTileId': 1, 'tiles': saved_tiles,
                'generator': {'id': 'dst-map-v1', 'options': {
                    'size': half * 2 * TILE_SIZE, 'moonTreeCount': 0, 'moonTreeExclusionRadiusSquared': 0}}},
        'entities': {},
    }
    player = result['players']['local']
    player['prefab'] = 'wilson'
    player['shardId'] = shard_id
    player['transform'] = {'position': [(spawn[0] - origin_x + .5) * TILE_SIZE, 0,
                                         (origin_z - spawn[1] - .5) * TILE_SIZE], 'rotationY': 0}
    player.pop('ghost', None)
    player['stats'] = {'health': 150, 'hunger': 150, 'sanity': 200}
    player['inventory'] = {'containers': {
        'player:inventory': {'slotCount': 15, 'slots': []},
        'player:equipment': {'slotCount': 3, 'slots': []},
        'player:cursor': {'slotCount': 1, 'slots': []},
    }, 'bufferedBuilds': []}
    report = {
        'scope': 'full-map', 'nodes': names,
        **({'unassignedNodeIds': sorted(unassigned_nodes)} if unassigned_nodes else {}),
        'sourceDimensions': [width, height], 'sourceBounds': [min_x, min_z, max_x, max_z],
        'sourceOriginCell': [origin_x, origin_z], 'worldScale': TILE_SIZE / 4, 'mirroredAxis': 'z',
        'translation': [(source_grid_position(0, width) - origin_x) * TILE_SIZE, 0,
                        (source_grid_position(0, height) - origin_z) * TILE_SIZE],
        'tileCounts': dict(sorted(Counter(c[2] for c in map_cells).items())),
        'landCells': len(land), 'savedCells': len(saved_tiles),
        'note': 'Original impassable gaps and FAKE_GROUND are non-walkable; only whitelisted source entities are imported. No bridges are generated.',
    }
    return result, report


# inventory.lua equipslots -> project equipment slot keys.
EQUIP_SLOTS = {'hands': 'hand', 'body': 'body', 'head': 'head'}
PLAYER_SLOT_COUNT = 15
BACKPACK_SLOT_COUNT = 8


def lua_slots(items, path):
    # Inventory/Container:OnSave key items by one-based slot; a table with holes is read as a keyed dict.
    if isinstance(items, list):
        return list(enumerate(items, 1))
    if not isinstance(items, dict) or any(type(slot) is not int or slot < 1 for slot in items):
        raise ValueError(f'Expected one-based slots in {path}')
    return sorted(items.items())


def convert_player_item(record, path, entity_id, catalog, report):
    """GetSaveRecord of an inventory item -> InventoryStack; unsupported items and components are reported."""
    prefab = record.get('prefab')
    spec = catalog['items'].get(prefab)
    if spec is None:
        report['skipped'].append({'path': path, 'prefab': prefab, 'reason': 'unknown item'})
        return None
    data = record.get('data') or {}
    if not isinstance(data, dict):
        raise ValueError(f'Expected component data at {path}')
    item, dropped = {'entityId': entity_id, 'itemId': prefab}, []
    count = (data.get('stackable') or {}).get('stack', 1)
    if type(count) is not int or not 1 <= count <= spec['maxStack']:
        raise ValueError(f'{path}: stack {count} exceeds {prefab} maxStack {spec["maxStack"]}')
    item['count'] = count
    skin = record.get('skinname')
    if skin is not None:
        if skin in catalog['skins'] and catalog['skins'][skin] in (None, prefab):
            item['skinId'] = skin
        else:
            dropped.append('skinname')
    for component, value in data.items():
        if component == 'stackable':
            continue
        if component == 'finiteuses' and 'maxUses' in spec:
            uses, step = value['uses'], spec.get('useStep', 1)
            if not step <= uses <= spec['maxUses'] or uses / step != round(uses / step):
                raise ValueError(f'{path}: {prefab} uses {uses} outside the project durability')
            item['remainingUses'] = uses
        elif component == 'fueled' and 'maxFuel' in spec:
            fuel = value.get('fuel', spec['maxFuel'])
            if not 0 <= fuel <= spec['maxFuel']:
                raise ValueError(f'{path}: {prefab} fuel {fuel} outside the project fuel')
            item['remainingFuel'] = fuel
        elif component == 'perishable' and 'perishTime' in spec and value.get('time') is not None:
            # perishremainingtime -> remaining fraction of perishable:SetPerishTime.
            if value.get('paused'):
                dropped.append('perishable.paused')
            item['freshnessPercent'] = min(value['time'] / spec['perishTime'], 1)
        elif component == 'inventoryitemmoisture':
            if value.get('wet'):
                item['wet'] = True
        elif component == 'container' and prefab == 'backpack':
            slots = []
            for slot, child in lua_slots(value.get('items', {}), f'{path}.container'):
                child_path = f'{path}.container.{slot}'
                if slot > BACKPACK_SLOT_COUNT:
                    raise ValueError(f'{child_path} is outside the backpack')
                converted = convert_player_item(child, child_path, f'{entity_id}_{slot - 1}', catalog, report)
                if converted is None:
                    continue
                if converted['itemId'] == 'backpack' or catalog['items'][converted['itemId']].get('canGoInContainer') is False:
                    report['skipped'].append({'path': child_path, 'prefab': converted['itemId'], 'reason': 'cannot go in a container'})
                    continue
                slots.append({'slotKey': str(slot - 1), 'item': converted})
            item['container'] = {'slotCount': BACKPACK_SLOT_COUNT, 'slots': slots}
        else:
            dropped.append(component)
    if dropped:
        report['droppedComponents'].append({'path': path, 'prefab': prefab, 'components': dropped})
    return item


def convert_player(source, translation, size, entity_prefix, catalog):
    """A DST player snapshot's position and inventory; stats and the character stay the template's."""
    data = source.get('data') or {}
    inventory = data.get('inventory') or {}
    report = {'character': source.get('prefab'), 'sourcePosition': [source.get('x', 0), 0, source.get('z', 0)],
              'skipped': [], 'droppedComponents': []}
    position = project_position(report['sourcePosition'], translation)
    if any(type(value) not in (int, float) or not math.isfinite(value) or abs(value) > size / 2 for value in position):
        raise ValueError('Player position is outside the imported map')
    slots = []
    for slot, record in lua_slots(inventory.get('items', {}), 'inventory.items'):
        if slot > PLAYER_SLOT_COUNT:
            raise ValueError(f'inventory.items.{slot} is outside the player inventory')
        item = convert_player_item(record, f'inventory.items.{slot}', f'{entity_prefix}_items_{slot - 1}', catalog, report)
        if item is not None:
            slots.append({'slotKey': str(slot - 1), 'item': item})
    equipment = []
    for source_slot, record in (inventory.get('equip') or {}).items():
        path = f'inventory.equip.{source_slot}'
        slot = EQUIP_SLOTS.get(source_slot)
        if slot is None:
            report['skipped'].append({'path': path, 'prefab': record.get('prefab'), 'reason': 'unknown equipment slot'})
            continue
        item = convert_player_item(record, path, f'{entity_prefix}_equip_{slot}', catalog, report)
        if item is None:
            continue
        if catalog['items'][item['itemId']].get('equippable') != slot:
            report['skipped'].append({'path': path, 'prefab': item['itemId'], 'reason': f'not equippable in {slot}'})
            continue
        equipment.append({'slotKey': slot, 'item': item})
    cursor = []
    if inventory.get('activeitem'):
        item = convert_player_item(inventory['activeitem'], 'inventory.activeitem', f'{entity_prefix}_cursor', catalog, report)
        if item is not None:
            cursor.append({'slotKey': '0', 'item': item})
    containers = {
        'player:inventory': {'slotCount': PLAYER_SLOT_COUNT, 'slots': slots},
        'player:equipment': {'slotCount': 3, 'slots': sorted(equipment, key=lambda s: list(EQUIP_SLOTS.values()).index(s['slotKey']))},
        'player:cursor': {'slotCount': 1, 'slots': cursor},
    }
    return position, containers, report


def player_snapshot(session, snapshot):
    """The single local player's file saved with this world snapshot, if the player was in this shard."""
    users = sorted(path for path in session.iterdir() if path.is_dir())
    if len(users) > 1:
        raise ValueError(f'Expected at most one player in {session}')
    if not users or not (users[0] / snapshot).is_file():
        return None, None
    return users[0], users[0] / snapshot


def write_or_check(path, data, check):
    serialized = json.dumps(data, ensure_ascii=False, indent=2) + '\n'
    if check:
        if not path.is_file() or path.read_text() != serialized:
            raise ValueError(f'{path} differs from the source import')
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(serialized)


def import_shard(shard, template, supported, catalog, origin_cell=None, snapshot=None, expected_prefab=None):
    source_shard = shard
    shard = shard.resolve()
    index = LITERALS['returned_table']((shard / 'save/shardindex').read_text())
    session_id = index['session_id']
    if not isinstance(session_id, str) or not session_id.isalnum():
        raise ValueError('Invalid session ID')
    session = shard / 'save/session' / session_id
    candidates = sorted(p for p in session.iterdir() if p.is_file() and len(p.name) == 10 and p.name.isdigit())
    if not candidates:
        raise ValueError('No world snapshots found')
    snapshot = snapshot or candidates[-1].name
    if len(snapshot) != 10 or not snapshot.isdigit():
        raise ValueError('Snapshot must contain ten digits')
    source = session / snapshot
    source_text = source.read_text()
    terrain = LITERALS['snapshot_map'](source_text)
    result, report = convert(terrain, template, supported, origin_cell)
    source_entities = LITERALS['snapshot_entities'](source_text, ENTITY_WHITELIST)
    result['world']['entities'], entity_report = convert_entities(terrain, source_entities, report, session_id)
    report.update(entity_report)
    user, player_source = player_snapshot(session, snapshot)
    if player_source is not None:
        player = result['players']['local']
        position, player['inventory']['containers'], player_report = convert_player(
            LITERALS['player_snapshot'](player_source.read_text(encoding='utf-8', errors='surrogateescape')),
            report['translation'], result['world']['map']['generator']['options']['size'],
            f'dst_{session_id}_{user.name}', catalog)
        player['transform']['position'] = position
        report['player'] = {'source': f'{source_shard.as_posix()}/save/session/{session_id}/{user.name}/{snapshot}',
                            'sourceSha256': hashlib.sha256(player_source.read_bytes()).hexdigest(), **player_report}
    result['session']['id'] = f'{terrain["prefab"]}-{session_id}-map-v1'
    result['snapshot'] = {**result['snapshot'], 'id': snapshot, 'parentId': None, 'reason': 'initial'}
    report['source'] = f'{source_shard.as_posix()}/save/session/{session_id}/{snapshot}'
    report['sourceSha256'] = hashlib.sha256(source.read_bytes()).hexdigest()
    if expected_prefab is not None and terrain['prefab'] != expected_prefab:
        raise ValueError(f'{shard} must contain {expected_prefab} terrain')
    return result, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sources = parser.add_mutually_exclusive_group(required=True)
    sources.add_argument('--shard', type=Path, help='DST Master or Caves shard directory')
    sources.add_argument('--cluster', type=Path, help='DST cluster directory; import both Master and Caves')
    parser.add_argument('--output', required=True, type=Path,
                        help='Save JSON path with --shard; output directory with --cluster')
    parser.add_argument('--template', type=Path, default=ROOT / 'public/saves/initial-world.json')
    parser.add_argument('--origin-cell', nargs=2, type=int, metavar=('COL', 'ROW'),
                        help='Source origin for --shard; caves origin for --cluster (forest is centred independently)')
    parser.add_argument('--forest-origin-cell', nargs=2, type=int, metavar=('COL', 'ROW'),
                        help='Forest source origin with --cluster')
    parser.add_argument('--snapshot', help='Ten-digit snapshot; defaults to latest in each active session')
    parser.add_argument('--check', action='store_true', help='Verify both save and provenance without writing')
    args = parser.parse_args()
    if args.forest_origin_cell is not None and args.cluster is None:
        parser.error('--forest-origin-cell requires --cluster')
    if args.cluster is not None and (args.output.suffix.lower() == '.json' or args.output.is_file()):
        parser.error('--output must be a directory with --cluster')
    template = json.loads(args.template.read_text())
    supported = {name: spec['tileId'] for name, spec in json.loads(
        (ROOT / 'packages/prefab/src/groundTiles.json').read_text()).items()}
    supported['FAKE_GROUND'] = 200
    # The save loader's item catalog lives in TypeScript; validate player items against the same specs.
    catalog = json.loads(subprocess.run(['node', str(ROOT / 'scripts/export-save-catalog.mjs')],
                                        check=True, capture_output=True, text=True).stdout)
    jobs = [(args.shard, args.output, args.origin_cell, None)] if args.shard else [
        (args.cluster / name, args.output / f'{name}.json',
         args.forest_origin_cell if prefab == 'forest' else args.origin_cell, prefab)
        for prefab, (name, _) in SHARDS.items()]
    # Convert/validate every shard before replacing any output file.
    imports = [(output, *import_shard(shard, template, supported, catalog, origin, args.snapshot, prefab))
               for shard, output, origin, prefab in jobs]
    for output, result, report in imports:
        write_or_check(output, result, args.check)
        write_or_check(output.with_suffix('.import.json'), report, args.check)
        print(f'{"Checked" if args.check else "Imported"} {result["world"]["prefab"]}: {report["landCells"]} land cells '
              f'from {len(report["nodes"])} nodes and {sum(len(records) for records in result["world"]["entities"].values())} '
              f'whitelisted entities into {output}')


if __name__ == '__main__':
    main()
