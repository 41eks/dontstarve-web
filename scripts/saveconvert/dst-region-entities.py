#!/usr/bin/env python3
"""The imported DST prefabs: which keys each one saves, and the component rule that converts each key.

Each entry lists the keys of the prefab's GetPersistData (its components' OnSave tables and its own OnSave fields) with
the rule from dst-region-components.py and the prefab's tuning limits, in the order the project writes them. A key that
is not listed is unsupported and fails the import, so adding a prefab means stating how each saved key converts rather
than copying arbitrary Lua data. `onload` rules check what the prefab's OnLoad reads across several keys.
"""
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
import runpy

ROOT = Path(__file__).resolve().parents[2]
C = runpy.run_path(str(Path(__file__).with_name('dst-region-components.py')))
(flag, boolean, fixed, integer, number, choice, text, ignored, keep, table, is_count, in_range, needs_items,
 pickable, witherable, growable, workable, work_left, lunar_hail_buildup, timers, ordered, remaining, running, defaulted,
 fraction, partial, anything, health, childspawner, SPAWN_FIELDS, known_locations, upgradeable, container, stewer,
 stackable, inventory_item_moisture, perishable, submersible, scenario_runner, entity_tracker, world_migrator,
 object_spawner, teleporter, empty_table, fishable, construction_site, saved_rotation, true_flags, petrifiable, shaveable,
 periodic_spawner, beard, domesticatable, unnamed, leader, creature_moisture, inventory, ramping_spawner, exclusive,
 together, burnt_structure) = (C[name] for name in (
    'flag', 'boolean', 'fixed', 'integer', 'number', 'choice', 'text', 'ignored', 'keep', 'table', 'is_count',
    'in_range', 'needs_items', 'pickable', 'witherable', 'growable', 'workable', 'work_left', 'lunar_hail_buildup',
    'timers', 'ordered', 'remaining', 'running', 'defaulted', 'fraction', 'partial', 'anything', 'health', 'childspawner',
    'SPAWN_FIELDS', 'known_locations', 'upgradeable', 'container', 'stewer', 'stackable', 'inventory_item_moisture',
    'perishable', 'submersible', 'scenario_runner', 'entity_tracker', 'world_migrator', 'object_spawner', 'teleporter',
    'empty_table', 'fishable', 'construction_site', 'saved_rotation', 'true_flags', 'petrifiable', 'shaveable',
    'periodic_spawner', 'beard', 'domesticatable', 'unnamed', 'leader', 'creature_moisture', 'inventory',
    'ramping_spawner', 'exclusive', 'together', 'burnt_structure'))

ANIMATED_BUILDINGS = json.loads((ROOT / 'packages/prefab/src/definitions.json').read_text())['animatedBuildings']


@dataclass(frozen=True)
class Entity:
    """How one source prefab's saved table converts.

    saved: saved key -> rule, in the order the project writes their components.
    required: saved keys every non-empty table has. `empty`: an empty table (an unsaved entity) imports with no state.
    defaults: values for unsaved keys whose rule still writes state (the value the constructor or OnLoad uses).
    base: components every imported record starts with. order: the project's component order, where it differs from
    the order the rules write them in. skins: the skinnames GetSaveRecord may write (a set, or a function of the prefab);
    None rejects any skin. height: 'ground' (y = 0), 'raised' (an item keeps its height) or 'settles' (a boulder still
    falling lands). save_as: the project prefab the records are saved under, when it is not the source prefab.
    """
    saved: dict = field(default_factory=dict)
    required: tuple = ()
    empty: bool = False
    defaults: dict = field(default_factory=dict)
    base: dict = field(default_factory=dict)
    onload: tuple = ()
    order: tuple = ()
    skins: object = None
    height: str = 'ground'
    save_as: str | None = None

    @property
    def needs_items(self):
        return any(getattr(rule, 'needs_items', False) for rule in (*self.saved.values(), *self.onload))


def entity(saved=None, **options):
    return Entity(saved or {}, **options)


def building_skins(upgraded=True):
    """The animated building's skins (packages/prefab/src/definitions.json). Without `upgraded`, an upgraded skin is
    rejected: DoUpgradeVisuals derives the *_upgraded_* build at runtime, so the saved skinname is the base skin."""
    def skins(prefab):
        names = set(ANIMATED_BUILDINGS[prefab]['skinArchives'])
        return names if upgraded else {name for name in names if not name.startswith(f'{prefab}_upgraded_')}
    return skins


# --- Rules for saved state that only these prefabs have ---------------------------------------------------------------

# moonbase.lua: the staffs a moon stone holds, and timer.lua's charge tasks (tuning.lua MOONBASE_CHARGE_*).
MOONBASE_STAFFS = ('yellowstaff', 'opalstaff')
MOONBASE_TIMERS = {'fullmoonstartdelay': 10, 'moonchargepre': 10, 'mooncharge': 49.9, 'mooncharge2': 18.7,
                   'mooncharge3': 18.7}


@needs_items
def held_staff(context):
    """moonbase.lua OnLoad: pickable gates the held staff (saved whole, or by name and uses in older saves), which a
    broken base cannot hold; only a yellow staff charges."""
    data = context.data
    work = data.get('workable')
    workleft = work.get('workleft', 4) if work else 4
    state = {}
    held = None
    if (data.get('pickable') or {}).get('caninteractwith') and ('staff' in data or 'staffname' in data):
        staff = data.get('staff')
        if staff is None:
            staff = {'prefab': data['staffname'],
                     'data': {**({'finiteuses': {'uses': data['staffuse']}} if 'staffuse' in data else {})}}
        if not isinstance(staff, dict) or staff.get('prefab') not in MOONBASE_STAFFS or workleft <= 0:
            context.fail('staff', staff)
        held = context.item(staff, 'staff')
        if held is None or 'stackable' in held['components']:
            context.fail('staff: expected one supported staff')
        state['staff'] = dict(held)
    names = (data.get('timer') or {}).get('timers', {}).keys()
    charging = {'moonchargepre', 'mooncharge', 'mooncharge2', 'mooncharge3'} & names
    if (charging and (held is None or held['prefab'] != 'yellowstaff')) or {'moonchargepre', 'mooncharge'} <= names \
            or ({'mooncharge2', 'mooncharge3'} & names and 'mooncharge' not in names) \
            or {'mooncharge2', 'mooncharge3'} <= names:
        context.fail('charge state', sorted(names))
    if 'timer' in data:
        state['timer'] = {'timers': {name: dict(entry) for name, entry in data['timer']['timers'].items()}}
    if state:
        context.write('moonbase', state)


def smashable(starts_as_rubble=False):
    """smashables.lua OnSave/OnPreLoad: rubble and maxhealth, and the health left (80% when intact, 20% as rubble, when
    unsaved). An early snapshot without them uses the constructor's state."""
    def check(context):
        data = context.data
        maximum = data.get('maxhealth')
        if maximum is None:
            if data:
                context.fail('state: missing maxhealth')
            if starts_as_rubble:
                context.write(('ruinsRelic', 'rubble'), True)
            return
        if not in_range(maximum, 0, math.inf) or maximum == 0:
            context.fail('maxhealth', maximum)
        saved = table(data.get('health', {}), context, 'health', ('health',))
        current = saved.get('health', maximum * (.2 if data.get('rubble') else .8))
        if not in_range(current, 0, maximum):
            context.fail('health', current)
        context.write('health', {'current': current, 'maximum': maximum})
    return check


def tree_growth(counted=None, ignore=()):
    """A living tree saves its growable stage; a stump, a burnt tree or a table without tree state does not."""
    def check(context):
        saved = (set(context.source) if counted is None else set(context.source) & set(counted)) - set(ignore)
        if 'growable' not in saved and saved and not (context.data.get('stump') or context.data.get('burnt')):
            context.fail('growable state: missing')
    return check


def dead_tree_sheds_hail(context):
    """evergreens.lua onload: a stump or burnt tree calls RemoveLunarHailBuildup after its components load."""
    if any(context.data.get(key) for key in ('stump', 'burnt', 'burntcone')):
        context.out.pop('lunarhailbuildup', None)


def leaf_change(context):
    """deciduoustrees.lua: OnChangeLeaves returns at once on stumps and burnt trees, which keep no target or timer."""
    dead = context.data.get('stump') or context.data.get('burnt')
    if 'target_leaf_state' not in context.data and not dead:
        context.fail('leaf state: missing target_leaf_state')
    if 'leaveschangetime' in context.data and not dead:
        context.write(('deciduoustree', 'leaveschangetime'), context.data['leaveschangetime'])


MOON_TREE_SIZES = ('short', 'normal', 'tall')


def size_matches_stage(context):
    """moontree.lua: size names the same three growable stages."""
    growth = context.out.get('growable')
    if growth and growth['stage'] != MOON_TREE_SIZES.index(context.data['size']) + 1:
        context.fail('size: expected it to match the growable stage')


def mushtree_timers(context):
    """mushtree.lua: only a stump decays (makestump); the acid visuals of a stump or burnt tree are not restored."""
    state = context.out.get('mushtree', {})
    if 'decay' in state and not context.data.get('stump'):
        context.fail('decay timer: only a stump decays')
    if context.data.get('stump') or context.data.get('burnt'):
        state.pop('acidvisualsupdate', None)


def bulb_light(component, *, timer_required):
    """flower_cave.lua / lightflier_flower.lua: light_state's running task (turnoff while ON, recharge while RECHARGING)
    and pickable's regrow time. A picked plant is never lit; a picked flower_cave runs no light timer, and an unpicked one
    that is not CHARGED runs one."""
    def check(context):
        pick = context.data.get('pickable') or {}
        picked = bool(pick.get('picked'))
        light_state = context.data['light_state']
        saved = (context.data.get('timer') or {}).get('timers', {})
        expected = {'ON': 'turnoff', 'RECHARGING': 'recharge'}.get(light_state)
        if (picked and light_state == 'ON') or set(saved) - {expected} \
                or ('time' in pick and (not picked or pick['time'] <= 0)) \
                or (timer_required and (bool(saved) if picked else light_state != 'CHARGED' and not saved)):
            context.fail('light state', {'light_state': light_state, 'picked': picked, 'timers': sorted(saved)})
        if picked:
            context.write((component, 'picked'), True)
            if 'time' in pick:
                context.write((component, 'regrowSeconds'), pick['time'])
    return check


def pool_children(big):
    """grotto_pool_big.lua saves its children's GUIDs by index, grotto_pool_small.lua its waterfall's. They become project
    IDs once every entity has been imported; a pool respawns any prop that was not (setup_children)."""
    def check(context):
        data = context.data
        if big:
            ids, indexes = data.get('children_ids', []), data.get('children_indexes', [])
            if not isinstance(ids, list) or not isinstance(indexes, list) or len(ids) != len(indexes) \
                    or len(set(indexes)) != len(indexes) or not all(is_count(child) for child in ids) \
                    or not all(type(index) is int and 1 <= index <= 5 for index in indexes):
                context.fail('children', data)
            children = [{'index': index, 'sourceId': child} for index, child in zip(indexes, ids)]
        else:
            if 'wf_id' in data and not is_count(data['wf_id']):
                context.fail('wf_id', data['wf_id'])
            children = [{'index': 1, 'sourceId': data['wf_id']}] if 'wf_id' in data else []
        out = context.out
        out['grottoPool'] = {'children': children}

        def link(imported_ids):
            linked = [{'index': child['index'], 'id': imported_ids[child['sourceId']]}
                      for child in children if child['sourceId'] in imported_ids]
            if linked:
                out['grottoPool'] = {'children': linked}
            else:
                del out['grottoPool']
        context.link(link)
    return check


def pond_plants(value, context):
    """pond.lua saves its plants' offsets; a frozen pond has none. Offsets turn with the world, as project_position does:
    X is kept and Z negated."""
    if not isinstance(value, list) or any(
            not isinstance(plant, dict) or set(plant) != {'offset'} or not isinstance(plant['offset'], list)
            or len(plant['offset']) != 3 or not all(in_range(axis, -math.inf, math.inf) for axis in plant['offset'])
            for plant in value):
        context.fail('plants', value)
    plants = [{'offset': [x, y, 0 - z]} for x, y, z in (plant['offset'] for plant in value)]
    if plants:
        context.write('plants', plants)


def lava_rocks(value, context):
    """lava_pond.lua saves the rock layout spawned around the pool."""
    if not isinstance(value, list) or any(
            not isinstance(rock, dict) or set(rock) != {'rocktype', 'offset'}
            or rock['rocktype'] not in ('', '2', '3', '4', '5', '6', '7') or not isinstance(rock['offset'], list)
            or len(rock['offset']) != 3 or not all(in_range(axis, -math.inf, math.inf) for axis in rock['offset'])
            for rock in value):
        context.fail('rocks', value)
    context.write(('lavaPond', 'rocks'), [{'rocktype': rock['rocktype'], 'offset': list(rock['offset'])} for rock in value])


def bud_list(into):
    """oceantree.lua: the bud slots (1..7) grown or used."""
    def rule(value, context):
        if not isinstance(value, list) or len(value) > 7 or any(type(bud) is not int or not 1 <= bud <= 7 for bud in value):
            context.fail('buds', value)
        context.write(into, value)
    return rule


def smart_minisign(value, context):
    """smart_minisign, newer than the source scripts: its attached minisign is not ported and is dropped."""
    sign = table(value, context, 'smart_minisign state', ('sign', 'nohuaminisign'))
    if type(sign.get('nohuaminisign', False)) is not bool or not isinstance(sign.get('sign', {}), dict) \
            or sign.get('sign', {'prefab': 'minisign'}).get('prefab') != 'minisign':
        context.fail('smart_minisign state', sign)


# --- Shared tables ----------------------------------------------------------------------------------------------------

DECAY = {'decay': ordered(21600)}  # timer.lua's stump decay task.
SPAWN_TIMERS = ('ChildSpawner_SpawnPeriod', 'ChildSpawner_RegenPeriod')
HIVE_CHILDREN = (*SPAWN_FIELDS, 'emergencychildreninside', 'emergencychildrenoutside')
GEMS = ('greengem', 'redgem', 'bluegem', 'yellowgem', 'orangegem', 'purplegem')
FLOWER_ANIMS = tuple(f'f{number}' for number in range(1, 11))
LIGHT_STATES = ('ON', 'CHARGED', 'RECHARGING')
BULB_VARIANTS = {'_single': 'single', '_springy': 'springy'}
BULB_PICKABLE = ('picked', 'caninteractwith', 'time')
BULB_TIMERS = {'turnoff': running, 'recharge': running}
LEAF_STATES = ('normal', 'colorful', 'barren')
BEEFALO_TENDENCIES = ('DEFAULT', 'ORNERY', 'RIDER', 'PUDGY')  # beefalo.lua TENDENCY
EMPTY_CLOTHING = {'clothing': {slot: '' for slot in ('beef_horn', 'beef_feet', 'beef_head', 'beef_tail', 'beef_body')}}
# spiderden.lua stages: SPIDERDEN_SPIDERS (times SPRING_COMBAT_MOD), SPIDERDEN_EMERGENCY_WARRIORS, SPIDERDEN_HEALTH.
SPIDERDEN_SPIDERS, SPIDERDEN_EMERGENCY, SPIDERDEN_HEALTH = (3, 6, 9), (0, 4, 8), (250, 500, 1000)


def spiderden_stage(context):
    growth = context.data.get('growable')
    return growth['stage'] - 1 if growth else 0


def spiderden_health(context):
    if 'growable' not in context.data:
        context.fail('health: missing growable stage')
    return SPIDERDEN_HEALTH[spiderden_stage(context)]


def relic(*, decor=False, skins=None):
    """ruinsrelic.lua replicas: no prefab OnSave, and workable saves nothing; a decor item is an inventory item."""
    saved = {'workable': workable, **({'inventoryitemmoisture': inventory_item_moisture('source')} if decor else {})}
    return entity(saved, skins=skins)


def ancient_relic(starts_as_rubble=False):
    """ruinsrelic.lua's ancient furniture: no prefab OnSave; smashables.lua keeps rubble and maxhealth."""
    return entity({'rubble': flag(('ruinsRelic', 'rubble')), 'maxhealth': ignored, 'health': ignored},
                  onload=(smashable(starts_as_rubble),))


def ruins_statue(gemmed):
    """statueruins.lua: gem() saves only its gem (the project keeps the mage's field name for every gem() statue);
    nogem() never sets inst.gemmed, so it saves nothing. workable.savestate remains false."""
    if not gemmed:
        return entity()
    return entity({'gem': choice(GEMS, ('ruinsStatueMage', 'gem'))}, required=('gem',))


def rock():
    """rocks.lua / stalagmite.lua / stalagmite_tall.lua: no prefab OnSave; workable.savestate defaults false."""
    return entity({'workable': workable})


def chessjunk():
    """chessjunk.lua OnSave: repaired, with who repaired it; workable.savestate defaults false."""
    return entity({'repaired': flag(('chessJunk', 'repaired')), 'repairerid': text(('chessJunk', 'repairerid')),
                   'repairerchar': text(('chessJunk', 'repairerchar')), 'workable': workable},
                  required=('repaired',), empty=True)


def chesspiece_marble(save_as=None):
    """chesspieces.lua onsave: materialid (onload: `or 1`, marble); submersible.lua: force_no_repositioning. Stone and
    moonglass are other prefabs, not ported, so they must not import as marble. The heavy piece's inventoryitemmoisture
    is not ported."""
    return entity({'materialid': fixed(1, ('chesspiece', 'materialid')), 'submersible': submersible(),
                   'inventoryitemmoisture': inventory_item_moisture()}, defaults={'materialid': 1}, save_as=save_as)


def stateless(**options):
    """A prefab with no OnSave whose components save nothing."""
    return entity(**options)


def hive(max_children, max_health):
    """beehive.lua / wasphive.lua: health, childspawner and worldsettingstimer. The bees outside and the spawn/regen tasks
    are not ported: the project regenerates the children instead of restoring their GUIDs."""
    return entity({'health': health(max_health),
                   'childspawner': childspawner(max_children, max_emergency=8, fields=HIVE_CHILDREN,
                                                keep=('emergencychildreninside',)),
                   'worldsettingstimer': timers({name: partial for name in SPAWN_TIMERS})})


def mushtree(grows):
    """mushtree.lua / mushtree_moon.lua OnSave plus growable (the medium and tall trees) and plantregrowth (offspring
    regrowth, not ported). A stump's decay timer and the acid rain visuals keep their time left; onsave's
    time_since_acid_infusion and acidrecoveryremaining are dropped, as onload reads them from the tree data."""
    return entity({
        'stump': flag(('mushtree', 'stump')), 'burnt': flag(('mushtree', 'burnt')),
        **({'treestate': choice(('normal', 'bloom'), ('mushtree', 'treestate'))} if grows else {}),
        'timer': timers({'decay': ordered(21600, paused=False), 'acidvisualsupdate': remaining(10)}, nonempty=True,
                        left_into={'decay': ('mushtree', 'decay'),
                                   'acidvisualsupdate': ('mushtree', 'acidvisualsupdate')}),
        **({'growable': growable(3)} if grows else {}),
        'plantregrowth': ignored, 'time_since_acid_infusion': ignored, 'acidrecoveryremaining': ignored,
    }, onload=(exclusive('stump', 'burnt'), mushtree_timers))


def pickable_plant(*, morphs=False):
    """grass.lua / sapling.lua: pickable and witherable. OnSave only adds was_herd, which re-registers the herd with
    lunarthrall_plantspawner (with herdmember's knownlocations); that spawner is not ported. Transplanted grass also
    saves its grassgekko morph timers, and grassgekko is not ported either."""
    return entity({'pickable': pickable(), 'witherable': witherable(), 'was_herd': flag(),
                   'knownlocations': known_locations(names=('herd',), keep=False),
                   **({'worldsettingstimer': timers({name: anything for name in ('morphdelay', 'morphing', 'morphrelay')},
                                                    optional_table=True)} if morphs else {})})


def pickable_only():
    """cactus.lua, lichen.lua and reeds.lua have no OnSave of their own: only pickable state is saved. cactus's has_flower
    follows the season on load; reeds.lua SetUp leaves max_cycles nil, so pickable saves no cycles."""
    return entity({'pickable': pickable()})


def cave_fern():
    """cave_fern.lua / cave_fern_withered.lua OnSave: anim is one of f1..f10."""
    return entity({'pickable': pickable(), 'anim': choice(FLOWER_ANIMS, ('variant', 'anim'))}, required=('anim',))


def flower_cave(variant=None):
    """flower_cave.lua OnSave: light_state, and plantname for the single flower; double and triple have fixed art."""
    saved = {'plantname': choice(BULB_VARIANTS, ('bulbPlant', 'variant'), BULB_VARIANTS)} if variant is None else {}
    return entity({**saved, 'light_state': choice(LIGHT_STATES, ('bulbPlant', 'lightState')),
                   'timer': timers(BULB_TIMERS, optional_table=True,
                                   left_into={'turnoff': ('bulbPlant', 'remainingSeconds'),
                                              'recharge': ('bulbPlant', 'remainingSeconds')}),
                   'pickable': pickable(BULB_PICKABLE, keep=None)},
                  required=(*saved, 'light_state'), empty=True,
                  base={'bulbPlant': {'variant': variant}} if variant else {},
                  onload=(bulb_light('bulbPlant', timer_required=True),))


def grotto_glass():
    """grotto_pool_moonglass.lua / grotto_waterfall_small.lua: workable.savestate writes workleft (and maxwork -1)."""
    return entity({'workable': work_left(6, keep=('grottoGlass', 'workleft'))})


def stafflight(duration):
    """stafflight.lua has no OnSave. Only timer.lua's extinguish task is saved; `duration` is its tuning.lua limit."""
    return entity({'timer': timers({'extinguish': ordered(duration)}, exact=True, into='timer')}, required=('timer',))


def storage(slot_count, *, upgraded_skins=True, **saved):
    """An item container building: container.lua OnSave writes items by one-based slot (`slot_count` is the containers.lua
    widget's); the building component holds no saved state."""
    return entity({**saved, 'container': container(slot_count)}, defaults={'container': {}}, base={'building': {}},
                  order=('container', 'building'), skins=building_skins(upgraded_skins))


ENTITIES = {
    # pigking.lua has no OnSave; trader and sleep/stategraph state are rebuilt on load.
    'pigking': stateless(),
    # moonbase.lua OnSave/OnLoad: workable owns the repair state; pickable gates the held staff.
    'moonbase': entity({'workable': work_left(6, maxwork=6, require_workleft=False, keep='workable', default=4),
                        'pickable': pickable(('picked', 'paused', 'caninteractwith', 'time', 'pause_time'), keep=None,
                                             maximum=1000000),
                        'staff': ignored, 'staffname': ignored, 'staffuse': ignored,
                        'timer': timers({name: ordered(limit) for name, limit in MOONBASE_TIMERS.items()})},
                       base={'building': {'state': 'idle'}}, onload=(held_staff,)),
    # scienceprototyper.lua / magicprototyper.lua save burnt. Workable has savestate=false.
    **{prefab: entity({'burnt': flag(('building', 'burnt')), 'workable': workable}, base={'building': {'state': 'idle'}},
                      skins=building_skins())
       for prefab in ('researchlab', 'researchlab2', 'researchlab3', 'researchlab4')},
    # statueglommer.lua OnSave plus pickable.lua and workable.lua component records.
    'statueglommer': entity({'worked': flag(('statueglommer', 'worked')), 'spawned': flag(('statueglommer', 'spawned')),
                             'pickable': pickable(('picked', 'caninteractwith'), keep='source'),
                             'workable': work_left(6, require_maxwork=True, keep='source')}),
    # atrium_fence.lua OnSave writes the shape from math.random(NUM_SHAPES).
    'atrium_fence': entity({'fenceid': integer(1, 5, 'fenceid')}),
    # atrium_gate.lua OnSave plus the component records used by OnLoadPostPass.
    'atrium_gate': entity({
        **{key: flag(('atriumGate', key)) for key in ('vault_key_socketed', 'can_spawn_charlie_hand_keystone', 'launch_key')},
        'pickable': pickable(('picked', 'paused', 'caninteractwith'), keep='source'),
        'charliecutscene': true_flags(('running', 'gatefixed'), 'charliecutscene'),
        'worldsettingstimer': timers({name: fraction(9600) for name in ('destabilizing', 'destabilizedelay', 'cooldown')},
                                     into='worldsettingstimer'),
        'entitytracker': entity_tracker(('stalker', 'charlie_hand'), keep=True),
        'ritual_state': fixed(0)}),
    # atrium_statue.lua MakeStatue("atrium_statue", false) has no OnSave; only the _facing variant saves savedrotation.
    'atrium_statue': stateless(),
    # atrium_overgrowth.lua rune_onsave: storyprogress is written once an inspection assigned it.
    'atrium_overgrowth': entity({'storyprogress': integer(1, 5, ('atriumOvergrowth', 'storyprogress'))}),
    # atrium_rubble.lua always saves animid and saves storyprogress once getstatus or OnLoad assigned it.
    'atrium_rubble': entity({'animid': integer(1, 2, ('atriumRubble', 'animid')),
                             'storyprogress': integer(1, 5, ('atriumRubble', 'storyprogress'))}, required=('animid',)),
    # tentacle_pillar.lua saves overtaken, health and linked teleporters. The project writes maximum health
    # (TENTACLE_PILLAR_HEALTH) and drops teleporter links because it does not restore them.
    'tentacle_pillar': entity({'overtaken': flag('overtaken'),
                               'health': health(500 * 1.5, shape='max', saved_maximum='ignore', penalty=True),
                               'teleporter': teleporter}),
    # nightmarerock.lua has no OnSave; the refresh task derives activation from nearby players.
    'insanityrock': stateless(),
    # mast.lua onsave off any boat: rotation and is_sail_raised, plus upgradeable:OnSave's numupgrades / stage.
    # Burnt and the lamp / lightning rod upgrade fields belong to unported branches.
    'mast_malbatross': entity({'rotation': number(-360, 360, ('mastMalbatross', 'rotation')),
                               'is_sail_raised': boolean(('mastMalbatross', 'is_sail_raised')),
                               'upgradeable': upgradeable(require_stage=False)},
                              base={'mastMalbatross': {}}, skins={'mast_malbatross_tesla', 'mast_malbatross_wagstaff'}),
    # stagehand.lua has no OnSave. Workable has savestate=false; only lunar hail buildup can persist.
    'stagehand': entity({'workable': workable, 'lunarhailbuildup': lunar_hail_buildup(2, keep=True)},
                        skins=building_skins()),
    # furniture_chairs.lua saves burnt; savedrotation.lua saves a non-zero rotation in degrees.
    'wood_chair': entity({'burnt': flag(('building', 'burnt')), 'savedrotation': saved_rotation}, base={'building': {}},
                         skins=building_skins()),
    # support_pillar.lua saves reinforced and constructionsite materials. Regen belongs to the dreadstone pillar.
    'support_pillar': entity({'reinforced': integer(1, 10, ('supportPillar', 'reinforced')),
                              'constructionsite': construction_site({'rocks': 40})}),
    # oasislake.lua only saves the regrowth flag as false. fishable:OnSave writes fish below OASISLAKE_MAX_FISH.
    'oasislake': entity({'regrowth': fixed(False, ('oasislake', 'regrowth')), 'fishable': fishable(15)}),
    # tuning.lua: math.ceil(BEEHIVE_BEES * SPRING_COMBAT_MOD) bees in spring, health 200; WASPHIVE_WASPS, health 250.
    'beehive': hive(7, 200),
    'wasphive': hive(5, 250),
    'ruinsrelic_table': relic(),
    'ruinsrelic_chair': relic(skins={'ruinsrelic_chair_tesla', 'ruinsrelic_chair_toilet'}),
    'ruinsrelic_vase': relic(decor=True),
    'ruinsrelic_chipbowl': relic(decor=True),
    'ruinsrelic_bowl': relic(decor=True),
    'ruinsrelic_plate': relic(decor=True),
    'ruins_table': ancient_relic(),
    'ruins_chair': ancient_relic(),
    'ruins_vase': ancient_relic(),
    'ruins_chipbowl': ancient_relic(),
    'ruins_bowl': ancient_relic(),
    'ruins_plate': ancient_relic(),
    'ruins_rubble_table': ancient_relic(starts_as_rubble=True),
    'ruins_rubble_chair': ancient_relic(starts_as_rubble=True),
    'ruins_rubble_vase': ancient_relic(starts_as_rubble=True),
    'ruins_statue_mage': ruins_statue(gemmed=True),
    'ruins_statue_mage_nogem': ruins_statue(gemmed=False),
    'ruins_statue_head': ruins_statue(gemmed=True),
    'ruins_statue_head_nogem': ruins_statue(gemmed=False),
    'chessjunk1': chessjunk(),
    'chessjunk2': chessjunk(),
    'chessjunk3': chessjunk(),
    # chesspieces.lua SetPrefabName saves every material under chesspiece_malbatross; materialid selects marble.
    'chesspiece_malbatross': chesspiece_marble(save_as='chesspiece_malbatross_marble'),
    'chesspiece_malbatross_marble': chesspiece_marble(),
    # archive_centipede.lua huskfn has no OnSave; health:OnSave writes health (and maxhealth only with save_maxhealth).
    'archive_centipede_husk': entity({'health': health(300, saved_maximum='use')}),
    # deciduoustrees.lua OnSave/OnLoad; hostile monster trees are a separate, unported behaviour branch.
    'deciduoustree': entity({
        'growable': growable(3), 'plantregrowth': ignored, 'timer': timers(DECAY, into='deciduousTimer'),
        **{key: flag(('deciduoustree', key)) for key in ('stump', 'burnt', 'burntcone')},
        'monster': fixed(False),
        'build': choice(('normal', 'red', 'orange', 'yellow', 'barren'), ('deciduoustree', 'build')),
        'leaf_state': choice(LEAF_STATES, ('deciduoustree', 'leaf_state')),
        'target_leaf_state': choice(LEAF_STATES, ('deciduoustree', 'target_leaf_state')),
        'leaveschangetime': number(0, 900),
    }, required=('leaf_state',), onload=(
        exclusive('stump', 'burnt'),
        tree_growth(counted=('growable', 'plantregrowth', 'stump', 'burnt', 'burntcone', 'timer')), leaf_change)),
    # moontree.lua on_save/on_load; size selects the same three growable stages.
    'moon_tree': entity({
        'growable': growable(4), 'plantregrowth': ignored, 'timer': timers(DECAY, into='moonTreeTimer'),
        'stump': flag(('moonTree', 'stump')), 'burnt': flag(('moonTree', 'burnt')),
        'size': choice(MOON_TREE_SIZES, ('moonTree', 'size')),
    }, defaults={'size': 'normal'}, onload=(
        exclusive('stump', 'burnt'), tree_growth(ignore=('size', 'lunarhailbuildup')), size_matches_stage)),
    # planted_tree.lua: the timer component owns the saved grow deadline.
    'moonbutterfly_sapling': entity({'timer': timers({'grow': ordered(300, 150)}, exact=True, into='saplingTimer')},
                                    required=('timer',)),
    # rock_avocado_fruit.lua rock_avocado_fruit_sprout_sapling: the timer component owns the grow deadline
    # (ROCK_FRUIT_SPROUT_GROWTIME = 5 * day_time = 1500). A sapling saved after its grow timer fired keeps no timer
    # record, and a fresh sapling re-arms the full deadline on load.
    'rock_avocado_fruit_sprout_sapling': entity({'timer': timers({'grow': ordered(1500)}, exact=True,
                                                                 into='saplingTimer')}),
    # fireflies.lua / butterfly.lua: inventoryitem prefabs saved under their own prefab IDs. Stackable:OnSave only
    # writes non-singleton stacks; live butterflies have maximum health 1 and no known locations.
    'fireflies': entity({'stackable': stackable(40), 'workable': workable,
                         'inventoryitemmoisture': inventory_item_moisture('clamped')}, height='raised'),
    # flower.lua OnSave: anim + planted. Picking removes the entity, so only an unpicked flower persists.
    'flower': entity({'anim': choice((*FLOWER_ANIMS, 'rose'), ('flower', 'animation')),
                      'planted': flag(('flower', 'planted')), 'pickable': pickable(('caninteractwith',))},
                     required=('anim',)),
    'butterfly': entity({'stackable': stackable(40), 'workable': workable,
                         'inventoryitemmoisture': inventory_item_moisture('clamped'), 'perishable': perishable(1440),
                         'health': fixed({'health': 1}), 'knownlocations': known_locations(names=(), keep=False)},
                        height='raised'),
    # stickheads.lua onsave/onload. Workable.savestate is false; awake is rebuilt.
    'pighead': entity({'burnt': flag(('building', 'burnt')), 'workable': workable}, base={'building': {'state': 'idle'}}),
    # archive_props.lua onsave/onloadpostpass; mining work is deliberately not persisted.
    'archive_moon_statue': entity({'anim': integer(1, 4, ('archiveProp', 'anim')), 'workable': workable}),
    # worldmigrator.lua saves links that the project does not restore yet.
    'cave_exit': entity({'worldmigrator': world_migrator}),
    # cave_hole.lua saves allowspawn. The project has no owner for objectspawner.lua's object GUIDs.
    'cave_hole': entity({'allowspawn': boolean('allowspawn'), 'objectspawner': object_spawner}),
    # pillar.lua and atrium_pillar.lua have no OnSave and add no component that saves anything.
    'pillar_ruins': stateless(),
    'pillar_cave': stateless(),
    'pillar_cave_flintless': stateless(),
    'pillar_cave_rock': stateless(),
    'pillar_algae': stateless(),
    'pillar_atrium': stateless(),
    # archive_pillar.lua saves broken. Without it the constructor rolls one.
    'archive_pillar': entity({'broken': boolean('broken')}),
    # moon_fissure.lua has no OnSave; its workable leaves savestate false and sanityaura / repairable save nothing.
    'moon_fissure': stateless(),
    # watertree_pillar.lua saves nuts, cocoon regrowth and childspawner state. The project drops the outside grassgator
    # GUIDs and their spawn/regen tasks.
    'watertree_pillar': entity({
        'num_oceantreenuts': integer(0, 2, ('watertreePillar', 'num_oceantreenuts')),
        'last_ram_time': number(0, math.inf, ('watertreePillar', 'last_ram_time')),
        'cocoons_to_regrow': integer(0, math.inf, ('watertreePillar', 'cocoons_to_regrow')),
        'childspawner': childspawner(1, fields=(*SPAWN_FIELDS, 'emergencychildreninside'),
                                     into=('watertreePillar', 'childspawner')),
        'timer': timers({'regrow_oceantreenut': defaulted, 'cocoon_regrow_check': defaulted},
                        into=('watertreePillar', 'timer'), write_empty=False),
        'worldsettingstimer': timers({name: anything for name in SPAWN_TIMERS}),
    }, required=('num_oceantreenuts', 'childspawner')),
    # oceantree.lua onsave plus growable. Its stump / burnt states, the enriched_cooldown timer (MakeEnriched) and a tree
    # saved while turning into oceantree_pillar are not ported. OCEANTREE_STAGES_TO_SUPERTALL bounds the progress.
    'oceantree': entity({
        'growable': growable(3),
        'supertall_growth_progress': integer(0, 3, ('oceantree', 'supertall_growth_progress')),
        'no_grow': boolean(('oceantree', 'no_grow')),
        'buds': bud_list(('oceantree', 'buds')), 'buds_used': bud_list(('oceantree', 'buds_used')),
    }, defaults={'supertall_growth_progress': 0}),
    # oceantree_pillar.lua saves droppedvines only when true.
    'oceantree_pillar': entity({'droppedvines': flag(('oceantreePillar', 'droppedvines'))}),
    # oceanvine.lua has no OnSave of its own. Its fn sets max_cycles = nil and cycles_left = 1, which pickable.lua OnSave
    # therefore always writes; cycles only fall for a transplanted plant, which a vine never is, so cycles_left must be
    # 1 and is left to fn.
    'oceanvine': entity({'pickable': pickable(('protected_cycles', 'picked', 'transplanted', 'paused', 'caninteractwith',
                                               'cycles_left', 'time'), fixed={'cycles_left': 1})}),
    # oceanvine_deco.lua saves animnum. Without it the constructor rolls one.
    'oceanvine_deco': entity({'animnum': integer(1, 6, 'animnum')}),
    # vault_pillar.lua saves capped or broken. World generation can also specify random.
    'vault_pillar': entity({'capped': integer(1, 2, 'capped'), 'broken': fixed(1, 'broken'), 'random': flag('random')}),
    # monkeypillar.lua saves pillar_id as a string, and world generation may supply a number.
    'monkeypillar': entity({'pillar_id': choice((1, 2, 3, 4, '1', '2', '3', '4'), 'pillar_id')}),
    # The open entrance also saves the unported bat childspawner and worldsettingstimer.
    'cave_entrance': entity({'worldmigrator': world_migrator}),
    'cave_entrance_open': entity({'worldmigrator': world_migrator, 'childspawner': ignored, 'worldsettingstimer': ignored},
                                  required=('worldmigrator',), empty=True),
    'mushtree_moon': mushtree(grows=False),
    'mushtree_medium': mushtree(grows=True),
    'mushtree_tall': mushtree(grows=True),
    # mushrooms.lua OnSave: rain only while positive. The open/closed pose follows the world phase, and the pickable
    # component saves nothing else for an unpicked mushroom: a picked pickable is not carried over. MakeNoGrowInWinter
    # pauses it in winter, which pickable.lua OnSave keeps as paused = true.
    'blue_mushroom': entity({'pickable': pickable(('caninteractwith', 'paused')),
                             'rain': integer(1, 20, ('mushroom', 'rain'))}),
    'grass': pickable_plant(morphs=True),
    'sapling': pickable_plant(),
    # rock_avocado_bush.lua on_save/on_load: data.burning (on_save) plus growable, pickable, witherable and the unported
    # lunarhailbuildup. Growable drives the four stages and the pickable has no regrow task of its own.
    'rock_avocado_bush': entity({'growable': growable(4), 'pickable': pickable(), 'witherable': witherable(),
                                 'burning': flag('burning')}, required=('growable',)),
    'cactus': pickable_only(),
    'oasis_cactus': pickable_only(),
    'lichen': pickable_only(),
    'reeds': pickable_only(),
    # livingtree.lua's independent stump/burnt flags and its lunar hail component.
    'livingtree': entity({'stump': flag(('livingtree', 'stump')), 'burnt': flag(('livingtree', 'burnt')),
                          'workable': workable, 'lunarhailbuildup': lunar_hail_buildup(4, keep=True)}),
    # evergreens.lua OnSave plus growable/plantregrowth; plantregrowth (offspring regrowth) is not ported.
    'evergreen': entity({
        **{key: flag(('evergreen', key)) for key in ('stump', 'burnt', 'burntcone')},
        'growable': growable(4), 'plantregrowth': ignored, 'timer': timers(DECAY, into='evergreenTimer'),
        'petrifiable': petrifiable, 'lunarhailbuildup': lunar_hail_buildup(4, keep=True),
    }, onload=(exclusive('stump', 'burnt'), tree_growth(), dead_tree_sheds_hail)),
    'flower_cave': flower_cave(),
    'flower_cave_double': flower_cave('double'),
    'flower_cave_triple': flower_cave('triple'),
    # lightflier_flower.lua OnSave: light_state + plantname, plus the pickable, timer and childspawner components.
    # Children are source GUIDs, linked to the imported lightfliers.
    'lightflier_flower': entity({
        'plantname': choice(BULB_VARIANTS, ('lightflierFlower', 'variant'), BULB_VARIANTS),
        'light_state': choice(LIGHT_STATES, ('lightflierFlower', 'lightState')),
        'childspawner': childspawner(1, fields=(*SPAWN_FIELDS, 'emergencychildreninside'), children='link_imported',
                                     into=('lightflierFlower', 'childspawner')),
        'timer': timers(BULB_TIMERS, optional_table=True, left_into={'recharge': ('lightflierFlower', 'rechargeSeconds'),
                                                                    'turnoff': ('lightflierFlower', 'turnoffSeconds')}),
        'pickable': pickable(BULB_PICKABLE, keep=None),
    }, required=('plantname', 'light_state', 'childspawner'), empty=True,
        onload=(bulb_light('lightflierFlower', timer_required=False),)),
    # houndbone.lua OnSave: data.bonetype (1..3). The legacy `anim` field is no longer written, and workable saves nothing.
    'houndbone': entity({'bonetype': integer(1, 3, ('houndbone', 'bonetype'))}, required=('bonetype',)),
    # beequeenhive.lua: workable.savestate = true; timer.lua saves an optional hiveregen task.
    'beequeenhivegrown': entity({'workable': work_left(16, maxwork=16, require_maxwork=True, keep='workable'),
                                 'timer': timers({'hiveregen': ordered(120)}, exact=True, into='beeQueenHiveTimer')}),
    'cave_fern': cave_fern(),
    'cave_fern_withered': cave_fern(),
    'stalagmite': rock(),
    'stalagmite_full': rock(),
    'stalagmite_med': rock(),
    'stalagmite_low': rock(),
    'stalagmite_tall': rock(),
    'stalagmite_tall_full': rock(),
    'stalagmite_tall_med': rock(),
    'stalagmite_tall_low': rock(),
    'rock1': rock(),
    'rock2': rock(),
    # cavein_boulder.lua OnSave: the default swap_boulder symbol omits variation (1). Ground art and the raised/formed
    # state are ported; entitytracker's propped link is not simulated. A boulder saved while settling lands.
    'cavein_boulder': entity({'variation': integer(1, 8, ('caveinBoulder', 'variation')),
                              'raised': flag(('caveinBoulder', 'raised')), 'formed': flag(('caveinBoulder', 'formed')),
                              'submersible': submersible(keep=False), 'workable': workable,
                              'entitytracker': entity_tracker(('propped',))},
                             defaults={'variation': 1}, onload=(exclusive('raised', 'formed'),), height='settles'),
    'rock_moon_shell': rock(),
    'rock_flintless': rock(),
    'rock_flintless_med': rock(),
    'rock_flintless_low': rock(),
    'rock_moon': rock(),
    # rocks.lua on_save_moonglass: data.rock_type (1..4); workable.savestate defaults false.
    'moonglass_rock': entity({'rock_type': integer(1, 4, 'rock_type'), 'workable': workable}),
    'grotto_pool_big': entity({'children_ids': ignored, 'children_indexes': ignored}, onload=(pool_children(big=True),)),
    'grotto_pool_small': entity({'wf_id': ignored}, onload=(pool_children(big=False),)),
    'grotto_moonglass_1': grotto_glass(),
    'grotto_moonglass_3': grotto_glass(),
    'grotto_moonglass_4': grotto_glass(),
    'grotto_waterfall_big': stateless(),
    'grotto_waterfall_small1': grotto_glass(),
    'grotto_waterfall_small2': grotto_glass(),
    # pond.lua saves plants and the unported frog childspawner and worldsettingstimer. A frozen pond has no plants.
    'pond': entity({'plants': pond_plants, 'childspawner': ignored, 'worldsettingstimer': ignored}),
    # hotspring.lua saves at most one state flag; only the normal and bath-bombed, non-glass states are supported. Every
    # hot spring saves its MINE workable, which the project does not port.
    'hotspring': entity({'workable': work_left(6, require_maxwork=True, integer=True),
                         'isbathbombed': flag(('hotspring', 'isbathbombed'))}, base={'hotspring': {}}),
    # tuning.lua YELLOWSTAFF_STAR_DURATION and OPALSTAFF_STAR_DURATION.
    'stafflight': stafflight(480 * 3.5),
    'staffcoldlight': stafflight(480 * 2),
    # lava_pond.lua saves the rock layout spawned around the pool.
    'lava_pond': entity({'rocks': lava_rocks}),
    # treasurechest.lua onsave/onload write only burnt. Upgradeable.OnSave writes numupgrades/stage, and only the
    # unupgraded chest is ported. ScenarioRunner and the newer smart_minisign are dropped.
    'treasurechest': entity({'container': container(9), 'burnt': flag(('building', 'burnt')),
                             'upgradeable': upgradeable(1, max_upgrades=0, keep=False),
                             'scenariorunner': scenario_runner(), 'smart_minisign': smart_minisign},
                            defaults={'container': {}}, base={'building': {'state': 'closed'}},
                            order=('container', 'building'), onload=(burnt_structure('container'),),
                            skins=building_skins(upgraded=False)),
    # MakeChest(indestructible = true): no burnable, so onsave writes nothing. The chest_labyrinth scenariorunner is added
    # by SpawnSaveRecord.
    'pandoraschest': entity({'container': container(9), 'scenariorunner': scenario_runner('chest_labyrinth')},
                            defaults={'container': {}}, base={'building': {'state': 'closed'}},
                            order=('container', 'building')),
    # cookpot.lua onsave writes burnt; container.lua and stewer.lua OnSave write the pot's contents and cooking state.
    'cookpot': entity({'container': container(4), 'stewer': stewer, 'burnt': flag(('building', 'burnt'))},
                      defaults={'container': {}}, base={'building': {}}, order=('container', 'building', 'stewer'),
                      onload=(burnt_structure('container', 'stewer'),), skins=building_skins()),
    # icebox.lua / saltbox.lua: neither has its own OnSave, and preserver.lua saves nothing.
    'icebox': storage(9),
    'saltbox': storage(9),
    # dragonfly_chest.lua has no OnSave of its own and cannot burn. Its upgrade permits oversized stacks that the current
    # container cannot restore: an upgraded chest is not imported (skippedEntities), preserving the source save.
    'dragonflychest': storage(12, upgraded_skins=False,
                              upgradeable=upgradeable(1, max_upgrades=1, keep=False, skip_upgraded=True)),
    # dragonfurnace.lua's furnace saves only container.lua's items: the incinerator and heater save nothing. The `salad`
    # flag belongs to the unported saladfurnace prefab.
    'dragonflyfurnace': storage(4),
    # wardrobe.lua only saves burnt, which the current prefab cannot restore.
    'wardrobe': entity(base={'building': {}}),
    # shadow_forge.lua has no OnSave and workable saves nothing.
    'shadow_forge': stateless(),
    # seastack.lua OnSave (stackid 1..5, tinted), workable.savestate (maxwork -1, workleft up to TUNING.SEASTACK_MINE)
    # and upgradeable:OnSave. The spawner prefabs in the same file are not ported.
    'seastack': entity({'stackid': integer(1, 5, 'stackid'), 'tinted': boolean('tinted'),
                        'workable': work_left(9, keep=('workable', 'workleft')), 'upgradeable': upgradeable(3)},
                       required=('stackid', 'tinted', 'workable', 'upgradeable')),
    # spiderden.lua SetPrefabName saves its three level prefabs as `spiderden`; growable.stage is the level and supplies
    # the health and childspawner limits. Outside spiders, their spawn/regen tasks and the queen stage are not ported.
    'spiderden': entity({
        'growable': growable(3, scaled=True),
        'health': health(spiderden_health),
        'childspawner': childspawner(
            lambda context: math.floor(SPIDERDEN_SPIDERS[spiderden_stage(context)] * 1.33),
            max_emergency=lambda context: SPIDERDEN_EMERGENCY[spiderden_stage(context)],
            fields=(*HIVE_CHILDREN, 'otherchildreninside', 'otheremergencychildreninside', 'maxchildren',
                    'maxemergencychildren'), keep=('emergencychildreninside',)),
        'upgradeable': upgradeable(3),
        'shaveable': shaveable, 'worldsettingstimer': timers({name: partial for name in SPAWN_TIMERS}),
        'bedazzlement': empty_table,
    }),
    # beefalo.lua OnSave (tendency, hascarrat) plus the component OnSaves. Only health, knownlocations, periodicspawner
    # and beard are ported; this port's Health saves its maximum too. leader followers are babybeefalo, which is not
    # ported; uniqueid, brushable and an unnamed writeable are rebuilt. A wild, unclothed beefalo's other components are
    # validated and dropped: hunger at its default, no carrat, and no clothing.
    'beefalo': entity({
        'health': health(1000, shape='max', positive=True), 'knownlocations': known_locations(unique=True),
        # periodicspawner:SetRandomTimes(40, 60): the saved time never exceeds the project's poop limit.
        'periodicspawner': periodic_spawner(100), 'beard': beard(3),
        'tendency': choice(BEEFALO_TENDENCIES), 'hascarrat': fixed(False), 'leader': leader, 'uniqueid': ignored,
        'skinner_beefalo': fixed(EMPTY_CLOTHING), 'brushable': ignored,
        'domesticatable': domesticatable(BEEFALO_TENDENCIES), 'hunger': fixed({'hunger': 0}), 'writeable': unnamed,
        'eater': ignored, 'beefalometrics': ignored,
    }, defaults={'health': {'health': 1000}, 'domesticatable': {}}),
    # lightninggoat.lua OnSave (charged, chargeleft) plus the component OnSaves: health (LIGHTNING_GOAT_HEALTH),
    # knownlocations (spawnpoint and herd) and the charge. The herd entity is not ported, so the herd location stays where
    # the herd was. An unsalted saltlicker and an empty timer save nothing.
    'lightninggoat': entity({'health': health(350 * 2, shape='max', positive=True),
                             'knownlocations': known_locations(unique=True, plus_zero=True),
                             'charged': flag(('lightninggoat', 'charged')),
                             'chargeleft': integer(1, 3, ('lightninggoat', 'chargeleft'))},
                            defaults={'health': {'health': 350 * 2}}, onload=(together('charged', 'chargeleft'),)),
    # dragonfly.lua OnSave playercombat; component OnSave: health, inventory, moisture and rampingspawner always write,
    # while knownlocations/timer/resistances write only when populated. The project's dragonfly restores them all.
    'dragonfly': entity({
        'playercombat': flag(('dragonfly', 'playercombat')),
        'health': health(27500, shape='source', saved_maximum='use', penalty=True, into=('dragonfly', 'health')),
        'inventory': inventory(('dragonfly', 'inventory')), 'moisture': creature_moisture(('dragonfly', 'moisture')),
        'rampingspawner': ramping_spawner(('dragonfly', 'rampingspawner')),
        'knownlocations': known_locations(write_empty=True, into=('dragonfly', 'knownlocations')),
        **{key: keep(('dragonfly', key)) for key in ('timer', 'sleeper', 'freezable', 'explosiveresist')},
    }, required=('health', 'inventory', 'moisture', 'rampingspawner')),
    # dragonfly_spawner.lua has no art; childspawner retains the queued child until OnEntityWake.
    'dragonfly_spawner': entity({
        'childspawner': childspawner(1, fields=(*SPAWN_FIELDS, 'emergencychildreninside'), max_outside=1, children='link',
                                     keep=('emergencychildreninside', 'queued_spawn', 'regening', 'spawning',
                                           'timetonextregen', 'timetonextspawn'),
                                     into=('dragonflySpawner', 'childspawner')),
        'worldsettingstimer': timers({'regen_dragonfly': anything}, exact=True,
                                     into=('dragonflySpawner', 'worldsettingstimer')),
    }, required=('childspawner',)),
}
