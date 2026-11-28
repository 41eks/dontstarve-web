#!/usr/bin/env python3
"""Source component rules: how one saved DST component, or one prefab OnSave field, becomes project save state.

EntityScript:GetPersistData writes one flat table per entity: each component's OnSave under the component's name, beside
the fields of the prefab's own OnSave. dst-region-entities.py lists, for each imported prefab, which of those keys it
saves and the rule that converts each of them. A rule is `rule(value, context)`: it validates the saved value against the
limits it was built with (the prefab's tuning), then writes the project component it maps to, or drops the value when the
project does not port it. Rules know nothing about prefab names; messages name the record's prefab through the context.
"""
import math


class Context:
    """One source record during conversion: its saved table, the project components written so far, and importer hooks."""

    def __init__(self, prefab, source, data, hooks):
        self.prefab = prefab
        self.source = source  # The saved table as read.
        self.data = data  # The saved table with the entity's defaults for keys it did not save.
        self.out = {}
        self.skip = False  # Set when the project cannot represent the saved state: the record is not imported.
        self.links = []  # Called with {source GUID: project ID} once every record has been imported.
        self.hooks = hooks

    def fail(self, what, *value):
        detail = f': {value[0]}' if value else ''
        raise ValueError(f'Unsupported {self.prefab} {what}{detail}')

    def write(self, path, value):
        if path is None:
            return
        if isinstance(path, tuple):
            component, field = path
            self.out.setdefault(component, {})[field] = value
        else:
            self.out[path] = value

    def item(self, record, path):
        return self.hooks['item'](record, path)

    def items(self, items, path, slot_count):
        return self.hooks['items'](items, path, slot_count)

    def project(self, position):
        return self.hooks['project'](position)

    def link(self, update):
        self.links.append(update)


def needs_items(rule):
    """Mark a rule that converts held items, so the importer requires the save item catalog."""
    rule.needs_items = True
    return rule


def is_number(value):
    return type(value) in (int, float) and math.isfinite(value)


def is_count(value, maximum=math.inf):
    return type(value) is int and 0 <= value <= maximum


def in_range(value, minimum, maximum):
    return is_number(value) and minimum <= value <= maximum


def table(value, context, what, allowed=None, required=()):
    """A saved Lua table with only the `allowed` keys and every `required` one. The literal reader returns an empty
    table as a list."""
    if value == []:
        value = {}
    if not isinstance(value, dict) or (allowed is not None and set(value) - set(allowed)) or set(required) - set(value):
        context.fail(what, value)
    return value


# --- Prefab OnSave fields ---------------------------------------------------------------------------------------------

def flag(into=None):
    """A field the prefab only writes as true."""
    def rule(value, context):
        if value is not True:
            context.fail('flag', value)
        context.write(into, True)
    return rule


def boolean(into=None):
    def rule(value, context):
        if type(value) is not bool:
            context.fail('boolean', value)
        context.write(into, value)
    return rule


def fixed(expected, into=None):
    """A saved value with exactly one supported state, which the constructor restores: written to `into`, if any."""
    def rule(value, context):
        if value != expected or type(value) is not type(expected):
            context.fail('state', value)
        context.write(into, expected)
    return rule


def integer(minimum, maximum, into=None):
    def rule(value, context):
        if type(value) is not int or not minimum <= value <= maximum:
            context.fail(f'value in {minimum}..{maximum}', value)
        context.write(into, value)
    return rule


def number(minimum, maximum, into=None):
    def rule(value, context):
        if not in_range(value, minimum, maximum):
            context.fail(f'value in {minimum}..{maximum}', value)
        context.write(into, value)
    return rule


def choice(values, into=None, convert=None):
    """One of `values`, written as itself or as `convert[value]`."""
    def rule(value, context):
        if type(value) not in (str, int) or value not in values:
            context.fail('choice', value)
        context.write(into, convert[value] if convert else value)
    return rule


def text(into=None):
    def rule(value, context):
        if type(value) is not str:
            context.fail('string', value)
        context.write(into, value)
    return rule


def ignored(value, context):
    """State whose source has no project owner, checked by nothing: plantregrowth, uniqueid and the like."""


def keep(into, check=None):
    """A table copied as saved, after `check(value, context)`."""
    def rule(value, context):
        if check is not None:
            check(value, context)
        context.write(into, dict(value) if isinstance(value, dict) else value)
    return rule


# --- pickable.lua, witherable.lua -------------------------------------------------------------------------------------

PICKABLE_NAMES = {'picked': 'picked', 'time': 'regrowSeconds', 'paused': 'paused', 'transplanted': 'transplanted',
                  'cycles_left': 'cyclesLeft', 'max_cycles': 'maxCycles', 'protected_cycles': 'protectedCycles'}
PICKABLE_FLAGS = {'picked', 'transplanted', 'paused', 'caninteractwith'}


def pickable(fields=(*PICKABLE_NAMES, 'caninteractwith'), *, keep='project', maximum=math.inf, fixed=None):
    """Pickable:OnSave. `keep` is 'project' (PickableSaveState names; caninteractwith is its default true), 'source'
    (the table as saved) or None (validated, for a prefab rule that reads it). `fixed` fields have one valid value that
    the prefab constructor restores, so they are not written."""
    fixed = fixed or {}

    def rule(value, context):
        state = table(value, context, 'pickable state', fields)
        for key, saved in state.items():
            if key in fixed:
                valid = saved == fixed[key]
            elif key in PICKABLE_FLAGS:
                valid = saved is True
            else:
                valid = type(saved) in (int, float) and 0 <= saved <= maximum
            if not valid:
                context.fail(f'pickable {key}', saved)
        if keep == 'source':
            context.write('pickable', dict(state))
        elif keep == 'project':
            converted = {PICKABLE_NAMES[key]: state[key] for key in PICKABLE_NAMES if key in state and key not in fixed}
            if converted:
                context.write('pickable', converted)
    return rule


WITHERABLE_NAMES = {'withered': 'withered', 'restore_cycles': 'restoreCycles', 'delay_time_remaining': 'delaySeconds',
                    'task_time_remaining': 'taskSeconds', 'protect_time_remaining': 'protectSeconds'}
# witherable.lua's delay and check tasks (TUNING.WITHER_*) and the protection a watering can grants.
WITHERABLE_LIMITS = {'delay_time_remaining': 480, 'task_time_remaining': 60, 'protect_time_remaining': 9600}


def witherable():
    """Witherable:OnSave -> the project Witherable. Protection tasks are not ported."""
    def rule(value, context):
        state = table(value, context, 'witherable state', WITHERABLE_NAMES)
        withered = state.get('withered')
        if ('withered' in state and withered is not True) \
                or ('restore_cycles' in state and (not withered or not is_count(state['restore_cycles']))) \
                or ('delay_time_remaining' in state and 'task_time_remaining' in state) \
                or any(not in_range(state[key], 0, limit) for key, limit in WITHERABLE_LIMITS.items() if key in state):
            context.fail('witherable state', state)
        context.write('witherable', {WITHERABLE_NAMES[key]: saved for key, saved in state.items()})
    return rule


# --- growable.lua -----------------------------------------------------------------------------------------------------

def growable(stages, *, scaled=False):
    """Growable:OnSave: the stage and its remaining time. growable.lua divides the saved time by usetimemultiplier; only a
    `scaled` growable has one, and the project keeps the actual seconds."""
    def rule(value, context):
        growth = table(value, context, 'growable state', ('stage', 'time', 'sleeptime', 'usetimemultiplier'), ('stage',))
        multiplier = growth.get('usetimemultiplier')
        if type(growth['stage']) is not int or not 1 <= growth['stage'] <= stages \
                or any(not in_range(growth[key], 0, math.inf) for key in ('time', 'sleeptime') if key in growth) \
                or not (multiplier in (None, False) or (scaled and is_number(multiplier) and multiplier > 0)):
            context.fail('growable state', growth)
        converted = {'stage': growth['stage']}
        if 'time' in growth:
            converted['time'] = round(growth['time'] * multiplier, 3) if multiplier else growth['time']
        if 'sleeptime' in growth:
            converted['sleeptime'] = growth['sleeptime']
        context.write('growable', converted)
    return rule


# --- workable.lua, lunarhailbuildup.lua -------------------------------------------------------------------------------

def workable(value, context):
    """Workable with savestate false: OnSave writes nothing, so only an empty table can be saved."""
    if value:
        context.fail('workable state', value)


def work_left(maximum, *, maxwork=-1, require_maxwork=False, require_workleft=True, integer=False, keep=None,
              default=None):
    """Workable:OnSave with savestate: workleft and maxwork (-1 for an unlimited work count). `keep` is None (dropped),
    'source' (the table as saved), 'workable' ({maxwork, workleft}, `default` filling an unsaved workleft) or a path for
    workleft alone."""
    def rule(value, context):
        work = table(value, context, 'workable state', ('maxwork', 'workleft'),
                     (('maxwork',) if require_maxwork else ()) + (('workleft',) if require_workleft else ()))
        left = work.get('workleft', default)
        if not is_number(work.get('maxwork', maxwork)) or work.get('maxwork', maxwork) != maxwork \
                or ('workleft' in work and (not in_range(left, 0, maximum) or (integer and type(left) is not int))):
            context.fail('workable state', work)
        if keep == 'source':
            context.write('workable', dict(work))
        elif keep == 'workable':
            if work:
                context.write('workable', {'maxwork': maxwork, 'workleft': left})
        else:
            context.write(keep, left)
    return rule


def lunar_hail_buildup(max_work=None, *, keep=False):
    """LunarHailBuildup:OnSave (MakeSnowCovered's buildup from lunar hail). Ported only where `keep`, bounded by the
    prefab's TUNING.LUNARHAIL_BUILDUP_TOTAL_WORK_AMOUNT_*; elsewhere it is validated and dropped."""
    def rule(value, context):
        buildup = table(value, context, 'lunarhailbuildup', ('workleft', 'buildupcurrent'))
        if max_work is not None and any(not in_range(buildup[key], 0, limit) for key, limit
                                        in (('workleft', max_work), ('buildupcurrent', 1)) if key in buildup):
            context.fail('lunarhailbuildup', buildup)
        if keep and buildup:
            context.write('lunarhailbuildup', dict(buildup))
    return rule


# --- timer.lua, worldsettingstimer.lua --------------------------------------------------------------------------------

def ordered(max_initial, min_initial=0, *, paused=None):
    """Timer:OnSave's {timeleft, initial_time, paused}: a deadline within its tuning duration."""
    def check(entry, context, name):
        if not isinstance(entry, dict) or set(entry) != {'timeleft', 'initial_time', 'paused'} \
                or type(entry['paused']) is not bool or (paused is not None and entry['paused'] is not paused) \
                or not in_range(entry['initial_time'], min_initial, max_initial) \
                or not in_range(entry['timeleft'], 0, entry['initial_time']):
            context.fail(f'{name} timer', entry)
        return entry
    return check


def remaining(max_left):
    """A running task of which only the time left is restored."""
    def check(entry, context, name):
        if not isinstance(entry, dict) or entry.get('paused') or not in_range(entry.get('timeleft'), 0, max_left):
            context.fail(f'{name} timer', entry)
        return entry
    return check


def running(entry, context, name):
    """A task that is counting down: never paused, with time left."""
    if not isinstance(entry, dict) or entry.get('paused') is not False or type(entry.get('timeleft')) not in (int, float) \
            or entry['timeleft'] <= 0:
        context.fail(f'{name} timer', entry)
    return entry


def defaulted(entry, context, name):
    """A timer whose unsaved paused flag and initial time take Timer:OnLoad's defaults."""
    table(entry, context, f'{name} timer', ('timeleft', 'paused', 'initial_time'), ('timeleft',))
    if not is_number(entry['timeleft']) or type(entry.get('paused', False)) is not bool \
            or not is_number(entry.get('initial_time', 0)):
        context.fail(f'{name} timer', entry)
    return {'timeleft': entry['timeleft'], 'paused': entry.get('paused', False),
            'initial_time': entry.get('initial_time', entry['timeleft'])}


def fraction(max_initial):
    """WorldSettingsTimer:OnSave saves timeleft as the fraction of its duration left."""
    def check(entry, context, name):
        table(entry, context, f'{name} timer', ('timeleft', 'paused', 'blocklongupdate', 'initial_time'), ('timeleft',))
        if not in_range(entry['timeleft'], 0, 1) or any(type(entry[key]) is not bool for key in ('paused', 'blocklongupdate')
                                                        if key in entry) \
                or ('initial_time' in entry and not in_range(entry['initial_time'], 0, max_initial)):
            context.fail(f'{name} timer', entry)
        return {**entry, 'paused': entry.get('paused', False)}
    return check


def partial(entry, context, name):
    """A timer whose fields are all optional and whose state is dropped."""
    table(entry, context, f'{name} timer', ('timeleft', 'initial_time', 'paused'))
    if any(not in_range(entry[key], 0, math.inf) for key in ('timeleft', 'initial_time') if key in entry) \
            or type(entry.get('paused', False)) is not bool:
        context.fail(f'{name} timer', entry)
    return entry


def anything(entry, context, name):
    return entry


def timers(entries, *, exact=False, nonempty=False, optional_table=False, into=None, write_empty=True, left_into=None):
    """Timer:OnSave / WorldSettingsTimer:OnSave: {timers = {name = entry}}. `entries` checks each named task; `into` writes
    the checked table, and `left_into` writes each task's time left to its own path."""
    def rule(value, context):
        timer = table(value, context, 'timer state', ('timers',), () if optional_table else ('timers',))
        saved = table(timer.get('timers', {}), context, 'timers')
        if not isinstance(saved, dict) or set(saved) - set(entries) or (exact and set(saved) != set(entries)) \
                or (nonempty and not saved):
            context.fail('timers', sorted(saved) if isinstance(saved, dict) else saved)
        checked = {name: entries[name](entry, context, name) for name, entry in saved.items()}
        if into is not None and (checked or write_empty):
            context.write(into, {'timers': checked})
        for name, path in (left_into or {}).items():
            if name in checked:
                context.write(path, checked[name]['timeleft'])
    return rule


# --- health.lua -------------------------------------------------------------------------------------------------------

def health(maximum, *, shape='range', positive=False, saved_maximum=None, penalty=False, into='health'):
    """Health:OnSave writes the current health (maxhealth only with save_maxhealth, penalty when set). `maximum` is the
    prefab's tuning maximum, or a function of the record for one that depends on other saved state. The project saves
    `shape` 'range' as {current, maximum}, 'max' as {health, maxhealth} and 'source' as the saved table.
    `saved_maximum` is 'use' when a saved maxhealth replaces `maximum`, 'ignore' when one is accepted and dropped."""
    def rule(value, context):
        allowed = {'health'} | ({'maxhealth'} if saved_maximum else set()) | ({'penalty'} if penalty else set())
        state = table(value, context, 'health', allowed, ('health',))
        limit = maximum(context) if callable(maximum) else maximum
        if saved_maximum == 'use':
            limit = state.get('maxhealth', limit)
        current = state['health']
        if not is_number(limit) or limit <= 0 or not in_range(current, 0, limit) or (positive and current == 0) \
                or state.get('penalty') is not None and not in_range(state['penalty'], 0, 1):
            context.fail('health', state)
        if shape == 'range':
            context.write(into, {'current': current, 'maximum': limit})
        elif shape == 'max':
            context.write(into, {'health': current, 'maxhealth': limit,
                                 **({'penalty': state['penalty']} if state.get('penalty') is not None else {})})
        else:
            context.write(into, dict(state))
    return rule


# --- childspawner.lua -------------------------------------------------------------------------------------------------

def _int_list(value):
    return isinstance(value, list) and all(type(child) is int for child in value)


def _count_table(value):
    return isinstance(value, dict) and all(isinstance(key, str) and is_count(count) for key, count in value.items())


CHILDSPAWNER_FIELDS = {
    'childrenoutside': _int_list,
    'spawning': lambda value: type(value) is bool, 'regening': lambda value: type(value) is bool,
    'queued_spawn': lambda value: type(value) is bool,
    'timetonextspawn': is_number, 'timetonextregen': is_number,
    'emergencychildreninside': is_number, 'emergencychildrenoutside': _int_list,
    'otherchildreninside': _count_table, 'otheremergencychildreninside': _count_table,
    'maxchildren': is_count, 'maxemergencychildren': is_count,
}
SPAWN_FIELDS = ('childrenoutside', 'spawning', 'regening', 'queued_spawn', 'timetonextspawn', 'timetonextregen')


def childspawner(max_children, *, max_emergency=None, fields=SPAWN_FIELDS, max_outside=math.inf, children='regenerate',
                 keep=(), into='childspawner'):
    """ChildSpawner:OnSave. `max_children` and `max_emergency` are the prefab's tuning (or functions of the record).
    The children outside are source GUIDs: with `children` 'regenerate' the project respawns them instead, 'link' maps
    each to its imported entity and 'link_imported' keeps only the imported ones. `keep` lists the other saved fields the
    project restores, in this order."""
    def rule(value, context):
        spawner = table(value, context, 'childspawner', ('childreninside', *fields), ('childreninside',))
        limit = max_children(context) if callable(max_children) else max_children
        emergency = max_emergency(context) if callable(max_emergency) else max_emergency
        outside = spawner.get('childrenoutside', [])
        if not is_count(spawner['childreninside'], limit) \
                or any(not CHILDSPAWNER_FIELDS[key](saved) for key, saved in spawner.items() if key != 'childreninside') \
                or (emergency is not None and 'emergencychildreninside' in spawner
                    and not is_count(spawner['emergencychildreninside'], emergency)) \
                or len(outside) > max_outside or (children != 'regenerate' and any(child < 0 for child in outside)):
            context.fail('childspawner', spawner)
        converted = {'childreninside': spawner['childreninside'],
                     'childrenoutside': [] if children == 'regenerate' else outside,
                     **{key: spawner[key] for key in keep if key in spawner}}
        context.write(into, converted)
        if children != 'regenerate':
            def link(imported_ids):
                converted['childrenoutside'] = [imported_ids[child] for child in converted['childrenoutside']
                                                if children == 'link' or child in imported_ids]
            context.link(link)
    return rule


# --- knownlocations.lua -----------------------------------------------------------------------------------------------

def known_locations(*, names=None, keep=True, unique=False, plus_zero=False, write_empty=False, into='knownlocations'):
    """KnownLocations:OnSave: named world positions, written in project coordinates. `names` limits which locations may be
    saved; `plus_zero` writes a rounded -0.0 as 0, as a project save round trip does."""
    def rule(value, context):
        locations = table(value, context, 'knownlocations', ('locations',)).get('locations', [])
        if not isinstance(locations, list):
            context.fail('knownlocations', value)
        projected = []
        for location in locations:
            if not isinstance(location, dict) or set(location) != {'name', 'x', 'y', 'z'} \
                    or not isinstance(location['name'], str) or not all(is_number(location[axis]) for axis in 'xyz') \
                    or (names is not None and location['name'] not in names):
                context.fail('known location', location)
            position = context.project([location['x'], location['y'], location['z']])
            x, y, z = (axis + 0.0 for axis in position) if plus_zero else position
            projected.append({'name': location['name'], 'x': x, 'y': y, 'z': z})
        if unique and len({location['name'] for location in projected}) != len(projected):
            context.fail('known locations: duplicate name')
        if keep and (projected or write_empty):
            context.write(into, {'locations': projected})
    return rule


# --- upgradeable.lua --------------------------------------------------------------------------------------------------

def upgradeable(stages=None, *, max_upgrades=math.inf, require_stage=True, keep=True, skip_upgraded=False):
    """Upgradeable:OnSave's numupgrades and stage. A prefab whose upgrades are not ported limits `max_upgrades`; with
    `skip_upgraded` an upgraded one is not imported, so the source keeps the state the project cannot restore."""
    def rule(value, context):
        upgrade = table(value, context, 'upgradeable state', ('numupgrades', 'stage'),
                        ('numupgrades', 'stage') if require_stage else ('numupgrades',))
        stage = upgrade.get('stage')
        if not is_count(upgrade['numupgrades'], max_upgrades) or (
                stage is not None and (type(stage) is not int or not 1 <= stage <= (stages or math.inf))):
            context.fail('upgradeable state', upgrade)
        if skip_upgraded and upgrade['numupgrades'] > 0:
            context.skip = True
        if keep:
            context.write('upgradeable', {'numupgrades': upgrade['numupgrades'],
                                          **({'stage': stage} if stage is not None else {})})
    return rule


# --- container.lua, stewer.lua ----------------------------------------------------------------------------------------

def container(slot_count):
    """Container:OnSave items by one-based slot -> held item records; `slot_count` is the containers.lua widget's."""
    @needs_items
    def rule(value, context):
        saved = table(value or {}, context, 'container state', ('items',))
        context.write('container', context.items(saved.get('items', {}), 'container', slot_count))
    return rule


# stewer.lua OnSave; product_spoilage and spoiltime belong to spoilage, which the project does not port.
STEWER_FIELDS = ('product', 'done', 'remainingtime', 'ingredient_prefabs', 'chef_id', 'product_spoilage', 'spoiltime')


def stewer(value, context):
    """Stewer:OnSave -> StewerSaveData; a pot that never cooked saves an empty table. Stewer:OnLoad ignores every field
    without a product, so a harvested pot keeps only its last ingredients, which are dropped."""
    state = table(value, context, 'stewer state', STEWER_FIELDS)
    product = state.get('product')
    if product is None:
        return
    remaining = state.get('remainingtime')
    ingredients = state.get('ingredient_prefabs')
    if type(product) is not str or type(state.get('done', False)) is not bool \
            or (remaining is not None and not in_range(remaining, 0, math.inf)) \
            or (ingredients is not None and (not isinstance(ingredients, list) or not all(type(p) is str for p in ingredients))) \
            or (state.get('chef_id') is not None and type(state['chef_id']) is not str):
        context.fail('stewer state', state)
    context.write('stewer', {'product': product, **({'done': True} if state.get('done') else {}),
                             **({'remainingtime': remaining} if remaining is not None else {}),
                             **({} if ingredients is None else {'ingredient_prefabs': ingredients}),
                             **({} if state.get('chef_id') is None else {'chef_id': state['chef_id']})})


# --- inventoryitem components: stackable.lua, inventoryitemmoisture.lua, perishable.lua, submersible.lua ---------------

def stackable(maximum):
    """Stackable:OnSave only writes a stack that is not a single item."""
    def rule(value, context):
        stack = table(value, context, 'stackable state', ('stack',)).get('stack', 1)
        if type(stack) is not int or not 1 <= stack <= maximum:
            context.fail('stackable state', value)
        if stack != 1:
            context.write('stackable', {'stack': stack})
    return rule


def inventory_item_moisture(keep=None):
    """InventoryItemMoisture:OnSave {moisture, wet}. `keep` is None (dropped), 'clamped' (as the held-item converter writes
    it) or 'source'."""
    def rule(value, context):
        moisture = table(value, context, 'moisture state', ('moisture', 'wet'))
        if ('wet' in moisture and (type(moisture['wet']) is not bool or (keep and moisture['wet'] is not True))) \
                or ('moisture' in moisture and not (is_number(moisture['moisture'])
                                                    if keep == 'clamped' else in_range(moisture['moisture'], 0, 100))):
            context.fail('moisture state', moisture)
        if keep == 'clamped':
            moisture = {**({'moisture': min(max(moisture['moisture'], 0), 100)} if moisture.get('moisture') else {}),
                        **({'wet': True} if moisture.get('wet') else {})}
        if keep and moisture:
            context.write('inventoryitemmoisture', dict(moisture))
    return rule


def perishable(max_time):
    """Perishable:OnSave of an item that is not perishing on the ground: its time left, paused."""
    def rule(value, context):
        perish = table(value, context, 'perishable state', ('time', 'paused'))
        if perish.get('paused') is not True or not is_number(perish.get('time')) or not 0 < perish['time'] <= max_time:
            context.fail('perishable state', perish)
        context.write('perishable', {'time': perish['time'], 'paused': True})
    return rule


def submersible(keep=True):
    """Submersible:OnSave's force_no_repositioning; without `keep` only false is supported, and dropped."""
    def rule(value, context):
        state = table(value, context, 'submersible state', ('force_no_repositioning',), ('force_no_repositioning',))
        if type(state['force_no_repositioning']) is not bool or (not keep and state['force_no_repositioning']):
            context.fail('submersible state', state)
        if keep:
            context.write('submersible', {'force_no_repositioning': state['force_no_repositioning']})
    return rule


# --- World entity components that the project keeps or validates and drops --------------------------------------------

def scenario_runner(script=None):
    """ScenarioRunner:OnSave. A scenario that has already run does nothing more on load, so it is dropped."""
    def rule(value, context):
        state = table(value, context, 'scenariorunner state', ('hasrunonce', 'scriptname'),
                      ('scriptname',) if script else ())
        if state.get('hasrunonce') is not True or type(state.get('scriptname', '')) is not str \
                or (script is not None and state['scriptname'] != script):
            context.fail('scenariorunner state', state)
    return rule


def entity_tracker(names, keep=False):
    """EntityTracker:OnSave: named source GUIDs."""
    def rule(value, context):
        entities = table(value, context, 'entitytracker', ('entities',), ('entities',))['entities']
        if not isinstance(entities, list) or any(
                not isinstance(entry, dict) or set(entry) != {'name', 'GUID'} or entry['name'] not in names
                or not is_count(entry['GUID']) for entry in entities):
            context.fail('entitytracker', value)
        if keep:
            context.write('entitytracker', {'entities': [dict(entry) for entry in entities]})
    return rule


def world_migrator(value, context):
    """WorldMigrator:OnSave links that the project does not restore yet."""
    table(value, context, 'worldmigrator', ('id', 'auto', 'linkedWorld', 'receivedPortal'))


def object_spawner(value, context):
    """ObjectSpawner:OnSave's object GUIDs, which the project has no owner for."""
    objects = table(value, context, 'objectspawner', ('objects',), ('objects',))['objects']
    if not _int_list(objects):
        context.fail('objectspawner', value)


def teleporter(value, context):
    """Teleporter:OnSave: the linked target, which the project does not restore, and no carried items."""
    state = table(value, context, 'teleporter', ('items', 'target', 'migration_data'), ('items',))
    if state['items'] != [] or (state.get('target') is not None and type(state['target']) is not int):
        context.fail('teleporter', state)


def empty_table(value, context):
    """A component whose OnSave writes an empty table."""
    if value:
        context.fail('component state', value)


def fishable(max_fish):
    """Fishable:OnSave writes fish only below the pond's maximum."""
    def rule(value, context):
        state = table(value, context, 'fishable', ('fish',), ('fish',))
        if type(state['fish']) is not int or not 0 <= state['fish'] < max_fish:
            context.fail('fishable', state)
        context.write('fishable', dict(state))
    return rule


def construction_site(materials):
    """ConstructionSite:OnSave: the materials added so far, each bounded by its recipe amount."""
    def rule(value, context):
        saved = table(value, context, 'constructionsite', ('materials',), ('materials',))['materials']
        table(saved, context, 'constructionsite materials', materials, materials)
        if any(type(count) is not int or not 1 <= count <= materials[name] for name, count in saved.items()):
            context.fail('constructionsite materials', saved)
        context.write('constructionsite', {'materials': dict(saved)})
    return rule


def saved_rotation(value, context):
    """SavedRotation:OnSave writes a non-zero rotation in degrees."""
    state = table(value, context, 'savedrotation', ('rotation',), ('rotation',))
    if not in_range(state['rotation'], -180, 180) or state['rotation'] == 0:
        context.fail('savedrotation', state)
    context.write('savedrotation', dict(state))


def true_flags(fields, into):
    """A component whose OnSave writes only true flags, kept as saved."""
    def rule(value, context):
        state = table(value, context, into, fields)
        if any(saved is not True for saved in state.values()):
            context.fail(into, state)
        context.write(into, dict(state))
    return rule


def petrifiable(value, context):
    """Petrifiable:OnSave's remaining time; petrification is not ported."""
    state = table(value, context, 'petrifiable state', ('remainingtime',), ('remainingtime',))
    if type(state['remainingtime']) not in (int, float) or state['remainingtime'] < 0:
        context.fail('petrifiable state', state)


def shaveable(value, context):
    state = table(value, context, 'shaveable state', ('prize_count',), ('prize_count',))
    if not is_count(state['prize_count']):
        context.fail('shaveable state', state)


# --- Creature components ----------------------------------------------------------------------------------------------

def periodic_spawner(max_time):
    """PeriodicSpawner:OnSave's time to the next spawn, within the prefab's SetRandomTimes."""
    def rule(value, context):
        time = table(value, context, 'periodicspawner state', ('time',)).get('time', 0)
        if not in_range(time, 0, max_time):
            context.fail('periodicspawner state', value)
        if time > 0:
            context.write('periodicspawner', {'time': time})
    return rule


def beard(max_bits):
    def rule(value, context):
        state = table(value, context, 'beard state', ('growth', 'growthaccumulator', 'bits'),
                      ('growth', 'growthaccumulator', 'bits'))
        if type(state['growth']) is not int or not is_number(state['growthaccumulator']) \
                or not is_count(state['bits'], max_bits):
            context.fail('beard state', state)
        context.write('beard', dict(state))
    return rule


# domesticatable.lua OnSave of a creature that was never fed or ridden.
WILD_DOMESTICATION = {'domestication_latch': False, 'tendencies': [], 'obedience': 0, 'minobedience': 0,
                      'domestication': 0, 'domesticated': False}


def domesticatable(tendencies):
    """Domesticatable:OnSave. Domestication, riding (rideable and its saddle) and the tendency the prefab's OnSave writes
    are not ported, so a domesticated creature imports as a wild one; a wild one keeps its default tendency and saves no
    eater or metrics."""
    def rule(value, context):
        state = table(value, context, 'domestication', None)
        if state.get('domesticated') is True:
            if set(state) - set(WILD_DOMESTICATION) - {'lastdomesticationgaindelta', 'rideable'} \
                    or context.data.get('tendency') not in tendencies:
                context.fail('domesticated state', state)
            return
        if context.data.get('tendency', tendencies[0]) != tendencies[0] or set(context.data) & {'eater', 'beefalometrics'}:
            context.fail('tendency of a wild creature', context.data.get('tendency'))
        wild = {key: saved for key, saved in state.items() if key not in ('lastdomesticationgaindelta', 'rideable')}
        if wild and wild != WILD_DOMESTICATION:
            context.fail('domestication', state)
    return rule


def unnamed(value, context):
    """Writeable:OnSave of a creature nobody named; a name is not ported."""
    if not isinstance(value, dict) or value.get('text'):
        context.fail('name', value)


def leader(value, context):
    """Leader:OnSave's followers, which belong to unported prefabs."""
    table(value, context, 'leader state', ('followers',))


def creature_moisture(into):
    """Moisture:OnSave."""
    def rule(value, context):
        state = table(value, context, 'moisture', ('moisture',), ('moisture',))
        if not in_range(state['moisture'], 0, 100):
            context.fail('moisture', state)
        context.write(into, value)
    return rule


def inventory(into):
    """Inventory:OnSave of a creature, kept as saved for the prefab that restores it."""
    def rule(value, context):
        state = table(value, context, 'inventory', ('items', 'equip', 'activeitem'), ('items', 'equip'))
        if not isinstance(state['items'], dict) or not isinstance(state['equip'], dict):
            context.fail('inventory', state)
        context.write(into, value)
    return rule


def ramping_spawner(into):
    """RampingSpawner:OnSave, kept as saved."""
    def rule(value, context):
        state = table(value, context, 'rampingspawner', ('current_wave', 'wave_num', 'spawning_on', 'spawns'),
                      ('current_wave', 'wave_num', 'spawning_on'))
        if type(state['current_wave']) is not int or type(state['wave_num']) is not int \
                or type(state['spawning_on']) is not bool:
            context.fail('rampingspawner', state)
        context.write(into, value)
    return rule


# --- Rules for an entity's whole saved table (its prefab's OnLoad) ----------------------------------------------------

def exclusive(*fields):
    """Saved fields that the prefab never writes together."""
    def check(context):
        if all(field in context.data for field in fields):
            context.fail(f'state: {" and ".join(fields)} together')
    return check


def together(*fields):
    """Saved fields that the prefab always writes together."""
    def check(context):
        missing = [field for field in fields if field not in context.data]
        if missing and len(missing) < len(fields):
            context.fail(f'{next(field for field in fields if field in context.data)}: saved without {", ".join(missing)}')
    return check


def burnt_structure(*components):
    """DefaultBurntStructureFn removes `components`: a burnt structure saves none of them, and imports none."""
    def check(context):
        if (context.out.get('building') or {}).get('burnt'):
            if set(components) & set(context.source):
                context.fail(f'burnt state with {", ".join(sorted(set(components) & set(context.source)))}')
            for component in components:
                context.out.pop(component, None)
    return check
