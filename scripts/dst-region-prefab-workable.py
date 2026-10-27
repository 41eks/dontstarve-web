#!/usr/bin/env python3
"""Workable prop save states: mining/hammering work and the fixed visual variant."""


def statueglommer_components(data):
    # statueglommer.lua OnSave plus pickable.lua and workable.lua component records.
    if set(data) - {'worked', 'spawned', 'pickable', 'workable'}:
        raise ValueError('Unsupported statueglommer save state')
    result = {}
    state = {key: True for key in ('worked', 'spawned') if data.get(key) is True}
    for key in ('worked', 'spawned'):
        if key in data and data[key] is not True:
            raise ValueError(f'Unsupported statueglommer {key} flag')
    if state:
        result['statueglommer'] = state
    picked = data.get('pickable')
    if picked is not None:
        if not isinstance(picked, dict) or set(picked) - {'picked', 'caninteractwith'} \
                or any(value is not True for value in picked.values()):
            raise ValueError('Unsupported statueglommer pickable state')
        result['pickable'] = picked
    work = data.get('workable')
    if work is not None:
        if not isinstance(work, dict) or set(work) != {'maxwork', 'workleft'} or work['maxwork'] != -1 \
                or type(work['workleft']) not in (int, float) or not 0 <= work['workleft'] <= 6:
            raise ValueError('Unsupported statueglommer workable state')
        result['workable'] = work
    return result


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


def houndbone_components(data):
    # houndbone.lua OnSave: data.bonetype (1..3). The legacy `anim` field is no longer written, and workable saves nothing.
    if set(data) != {'bonetype'} or type(data['bonetype']) is not int or not 1 <= data['bonetype'] <= 3:
        raise ValueError('Unsupported houndbone save state')
    return {'houndbone': {'bonetype': data['bonetype']}}


def beequeenhivegrown_components(data):
    # beequeenhive.lua: workable.savestate = true; timer.lua saves an optional hiveregen task.
    if set(data) - {'workable', 'timer'}:
        raise ValueError('Unsupported beequeenhivegrown save state')
    result = {}
    work = data.get('workable')
    if work is not None:
        if not isinstance(work, dict) or set(work) - {'maxwork', 'workleft'} or work.get('maxwork') != 16 \
                or type(work.get('workleft')) not in (int, float) or not 0 <= work['workleft'] <= 16:
            raise ValueError('Unsupported beequeenhivegrown workable state')
        result['workable'] = {'maxwork': 16, 'workleft': work['workleft']}
    timer = data.get('timer')
    if timer is not None:
        if not isinstance(timer, dict) or set(timer) != {'timers'} or not isinstance(timer['timers'], dict) \
                or set(timer['timers']) != {'hiveregen'}:
            raise ValueError('Unsupported beequeenhivegrown timer state')
        entry = timer['timers']['hiveregen']
        if not isinstance(entry, dict) or set(entry) != {'timeleft', 'paused', 'initial_time'} \
                or type(entry['timeleft']) not in (int, float) or type(entry['initial_time']) not in (int, float) \
                or type(entry['paused']) is not bool or not 0 <= entry['timeleft'] <= entry['initial_time'] <= 120:
            raise ValueError('Unsupported beequeenhivegrown timer state')
        result['beeQueenHiveTimer'] = {'timers': {'hiveregen': entry}}
    return result
