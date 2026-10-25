#!/usr/bin/env python3
"""Tree save states: growable stages, stump/burnt flags and decay timers."""
import math


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
