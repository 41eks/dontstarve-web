#!/usr/bin/env python3
"""Workable prop save states: mining/hammering work and the fixed visual variant."""


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
