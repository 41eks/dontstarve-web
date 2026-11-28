#!/usr/bin/env python3
"""Pickable plant save states: pickable, witherable, bulb light timers and child spawners."""
import math


def blue_mushroom_components(data):
    # mushrooms.lua OnSave: rain only while positive. The open/closed pose follows the world phase, and the pickable
    # component saves nothing else for an unpicked mushroom: caninteractwith is dropped, and a picked pickable is not
    # carried over. MakeNoGrowInWinter pauses it in winter, which pickable.lua OnSave keeps as paused = true.
    pickable = data.get('pickable', {})
    if set(data) - {'rain', 'pickable'} or not isinstance(pickable, dict) or set(pickable) - {'caninteractwith', 'paused'} \
            or any(pickable[flag] is not True for flag in pickable):
        raise ValueError('Unsupported blue_mushroom save state')
    components = {'pickable': {'paused': True}} if pickable.get('paused') else {}
    rain = data.get('rain')
    if rain is None:
        return components
    if type(rain) is not int or not 1 <= rain <= 20:
        raise ValueError('Expected blue_mushroom rain in 1..20')
    return {**components, 'mushroom': {'rain': rain}}


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
            if not isinstance(wither, dict) or set(wither) - {'withered', 'restore_cycles', 'delay_time_remaining', 'task_time_remaining', 'protect_time_remaining'} \
                    or ('withered' in wither and wither['withered'] is not True) \
                    or ('restore_cycles' in wither and (not wither.get('withered') or type(wither['restore_cycles']) is not int or wither['restore_cycles'] < 0)) \
                    or ('delay_time_remaining' in wither and 'task_time_remaining' in wither) \
                    or any(type(wither[key]) not in (int, float) or not math.isfinite(wither[key]) or not 0 <= wither[key] <= limit
                           for key, limit in [('delay_time_remaining', 480), ('task_time_remaining', 60),
                                              ('protect_time_remaining', 9600)] if key in wither):
                raise ValueError(f'Unsupported {prefab} witherable state')
            fields = {'withered': 'withered', 'restore_cycles': 'restoreCycles',
                      'delay_time_remaining': 'delaySeconds', 'task_time_remaining': 'taskSeconds',
                      'protect_time_remaining': 'protectSeconds'}
            components['witherable'] = {fields[key]: value for key, value in wither.items()}
        return components
    return convert


def rock_avocado_bush_components(data):
    # rock_avocado_bush.lua on_save/on_load: data.burning (on_save) plus growable, pickable, witherable and the unported
    # lunarhailbuildup. Growable drives the four stages and the pickable has no regrow task of its own.
    if not isinstance(data, dict) or set(data) - {'growable', 'lunarhailbuildup', 'pickable', 'witherable', 'burning'}:
        raise ValueError(f'Unsupported rock_avocado_bush save state: {sorted(data or {})}')
    if 'burning' in data and data['burning'] is not True:
        raise ValueError('Expected a true rock_avocado_bush burning flag')
    growth = data.get('growable')
    if not isinstance(growth, dict) or set(growth) - {'stage', 'time', 'sleeptime', 'usetimemultiplier'} \
            or growth.get('usetimemultiplier') not in (None, False) \
            or type(growth.get('stage')) is not int or not 1 <= growth['stage'] <= 4 \
            or any(type(growth[key]) not in (int, float) or not math.isfinite(growth[key]) or growth[key] < 0
                   for key in ('time', 'sleeptime') if key in growth):
        raise ValueError(f'Unsupported rock_avocado_bush growable state')
    components = {'growable': {key: growth[key] for key in ('stage', 'time', 'sleeptime') if key in growth}}
    # lunarhailbuildup.lua OnSave (SetLunarHailBuildupAmountSmall) is not ported: validate and drop.
    buildup = data.get('lunarhailbuildup')
    if buildup is not None and (not isinstance(buildup, dict) or set(buildup) - {'workleft', 'buildupcurrent'} \
            or any(type(buildup[key]) not in (int, float) or not 0 <= buildup[key] <= maximum
                   for key, maximum in (('workleft', 2), ('buildupcurrent', 1)) if key in buildup)):
        raise ValueError(f'Unsupported rock_avocado_bush lunarhailbuildup state')
    pickable = pickable_state(data.get('pickable') or {}, 'rock_avocado_bush')
    if pickable:
        components['pickable'] = pickable
    if 'witherable' in data:
        wither = data['witherable']
        if not isinstance(wither, dict) or set(wither) - {'withered', 'restore_cycles', 'delay_time_remaining', 'task_time_remaining', 'protect_time_remaining'} \
                or ('withered' in wither and wither['withered'] is not True) \
                or ('restore_cycles' in wither and (not wither.get('withered') or type(wither['restore_cycles']) is not int or wither['restore_cycles'] < 0)) \
                or ('delay_time_remaining' in wither and 'task_time_remaining' in wither) \
                or any(type(wither[key]) not in (int, float) or not math.isfinite(wither[key]) or not 0 <= wither[key] <= limit
                       for key, limit in [('delay_time_remaining', 480), ('task_time_remaining', 60),
                                          ('protect_time_remaining', 9600)] if key in wither):
            raise ValueError(f'Unsupported rock_avocado_bush witherable state')
        fields = {'withered': 'withered', 'restore_cycles': 'restoreCycles',
                  'delay_time_remaining': 'delaySeconds', 'task_time_remaining': 'taskSeconds',
                  'protect_time_remaining': 'protectSeconds'}
        components['witherable'] = {fields[key]: value for key, value in wither.items()}
    if data.get('burning') is True:
        components['burning'] = True
    return components


def cactus_components(prefab):
    # cactus.lua has no OnSave of its own; has_flower follows the season on wake/load and is not saved.
    def convert(data):
        if set(data) - {'pickable'}:
            raise ValueError(f'Unsupported {prefab} save state')
        state = pickable_state(data.get('pickable') or {}, prefab)
        return {'pickable': state} if state else {}
    return convert


def oceanvine_components(data):
    # oceanvine.lua has no OnSave of its own. Its fn sets max_cycles = nil and cycles_left = 1, which pickable.lua
    # OnSave therefore always writes; cycles only fall for a transplanted plant, which a vine never is, so
    # cycles_left must be 1 and is left to fn. caninteractwith is the default true that pickable_state drops.
    if set(data) - {'pickable'}:
        raise ValueError(f'Unsupported oceanvine save state: {sorted(data)}')
    pickable = dict(data.get('pickable') or {})
    if pickable.pop('cycles_left', 1) != 1 or 'max_cycles' in pickable:
        raise ValueError('Unsupported oceanvine pickable cycles')
    state = pickable_state(pickable, 'oceanvine')
    state.pop('caninteractwith', None)
    return {'pickable': state} if state else {}


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
        if not data:
            return {}
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
    if not data:
        return {}
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
        state = entity['components'].get('lightflierFlower')
        if state is None:
            continue
        spawner = state['childspawner']
        spawner['childrenoutside'] = [imported_ids[child] for child in spawner['childrenoutside'] if child in imported_ids]


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
