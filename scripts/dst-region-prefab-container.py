#!/usr/bin/env python3
"""Item container save states: chest and storage contents, the cooking pot's stewer and burnt flag; the skin, checked
here, stays the record's skinname."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFINITIONS = json.loads((ROOT / 'packages/prefab/src/definitions.json').read_text())['animatedBuildings']
CHEST_SKINS = DEFINITIONS['treasurechest']['skinArchives']
# containers.lua params.treasurechest: the 3 x 3 chest widget.
CHEST_SLOT_COUNT = 9
# containers.lua params.cookpot: the 1 x 4 cooking pot widget.
COOK_POT_SLOT_COUNT = 4
# containers.lua params.dragonflychest (params.shadowchester): the 3 x 4 chest widget.
DRAGONFLY_CHEST_SLOT_COUNT = 12
# containers.lua params.dragonflyfurnace: the 2 x 2 cooker widget.
DRAGONFLY_FURNACE_SLOT_COUNT = 4
# stewer.lua OnSave; product_spoilage and spoiltime belong to spoilage, which the project does not port.
STEWER_FIELDS = {'product', 'done', 'remainingtime', 'ingredient_prefabs', 'chef_id', 'product_spoilage', 'spoiltime'}


def check_skin(prefab, skin, reject=lambda skin: False):
    if skin is not None and (skin not in DEFINITIONS[prefab]['skinArchives'] or reject(skin)):
        raise ValueError(f'Unsupported {prefab} skin: {skin}')


def treasurechest_components(data, context):
    # treasurechest.lua onsave/onload write only burnt; container.lua OnSave writes items by one-based slot.
    # Upgradeable.OnSave writes numupgrades/stage, and only the unupgraded chest is ported.
    if set(data) - {'container', 'burnt', 'upgradeable', 'scenariorunner', 'smart_minisign'}:
        raise ValueError('Unsupported treasurechest save state')
    if 'burnt' in data and data['burnt'] is not True:
        raise ValueError('Expected a true treasurechest burnt flag')
    if data.get('upgradeable', {'numupgrades': 0, 'stage': 1}) != {'numupgrades': 0, 'stage': 1}:
        raise ValueError('Unsupported treasurechest upgradeable state')
    # ScenarioRunner.OnSave: a scenario that has already run does nothing more on load.
    scenario = data.get('scenariorunner')
    if scenario is not None and (not isinstance(scenario, dict) or set(scenario) - {'hasrunonce', 'scriptname'}
                                 or scenario.get('hasrunonce') is not True
                                 or type(scenario.get('scriptname', '')) is not str):
        raise ValueError('Unsupported treasurechest scenariorunner state')
    # smart_minisign is newer than the source scripts; its attached minisign is not ported and is dropped.
    sign = data.get('smart_minisign')
    if sign is not None and (not isinstance(sign, dict) or set(sign) - {'sign', 'nohuaminisign'}
                             or type(sign.get('nohuaminisign', False)) is not bool
                             or not isinstance(sign.get('sign', {'prefab': 'minisign'}), dict)
                             or sign.get('sign', {'prefab': 'minisign'}).get('prefab') != 'minisign'):
        raise ValueError('Unsupported treasurechest smart_minisign state')
    building = {'state': 'closed'}
    # DoUpgradeVisuals derives the treasurechest_upgraded_* build at runtime; the saved skinname is the base skin.
    check_skin('treasurechest', context['skin'], lambda skin: skin.startswith('treasurechest_upgraded_'))
    if data.get('burnt'):
        # DefaultBurntStructureFn removes the container, so a burnt chest saves no items.
        if 'container' in data:
            raise ValueError('A burnt treasurechest has no container')
        return {'building': {**building, 'burnt': True}}
    container = data.get('container') or {}
    if not isinstance(container, dict) or set(container) - {'items'}:
        raise ValueError('Unsupported treasurechest container state')
    return {'container': context['items'](container.get('items', {}), 'container', CHEST_SLOT_COUNT), 'building': building}


def pandoraschest_components(data, context):
    # MakeChest(indestructible = true): no burnable, so onsave writes nothing; container.lua OnSave writes items.
    # The chest_labyrinth scenariorunner is added by SpawnSaveRecord; one that has run does nothing more on load.
    if set(data) - {'container', 'scenariorunner'}:
        raise ValueError('Unsupported pandoraschest save state')
    if context['skin'] is not None:
        raise ValueError('pandoraschest has no skins')
    scenario = data.get('scenariorunner')
    if scenario is not None and scenario != {'hasrunonce': True, 'scriptname': 'chest_labyrinth'}:
        raise ValueError('Unsupported pandoraschest scenariorunner state')
    container = data.get('container') or {}
    if not isinstance(container, dict) or set(container) - {'items'}:
        raise ValueError('Unsupported pandoraschest container state')
    return {'container': context['items'](container.get('items', {}), 'container', CHEST_SLOT_COUNT),
            'building': {'state': 'closed'}}


def storage_components(prefab, slot_count):
    """icebox.lua / saltbox.lua: neither has its own OnSave, and preserver.lua saves nothing."""
    def convert(data, context):
        if set(data) - {'container'}:
            raise ValueError(f'Unsupported {prefab} save state')
        check_skin(prefab, context['skin'])
        container = data.get('container') or {}
        if not isinstance(container, dict) or set(container) - {'items'}:
            raise ValueError(f'Unsupported {prefab} container state')
        return {'container': context['items'](container.get('items', {}), 'container', slot_count), 'building': {}}
    return convert


def dragonflychest_components(data, context):
    # dragonfly_chest.lua has no OnSave of its own and cannot burn; container.lua OnSave writes items, and
    # upgradeable.lua writes numupgrades/stage. Only the unupgraded chest is ported.
    if set(data) - {'container', 'upgradeable'}:
        raise ValueError('Unsupported dragonflychest save state')
    if data.get('upgradeable', {'numupgrades': 0, 'stage': 1}) != {'numupgrades': 0, 'stage': 1}:
        raise ValueError('Unsupported dragonflychest upgradeable state')
    # DoUpgradeVisuals derives the dragonflychest_upgraded_* build at runtime; the saved skinname is the base skin.
    check_skin('dragonflychest', context['skin'], lambda skin: skin.startswith('dragonflychest_upgraded_'))
    container = data.get('container') or {}
    if not isinstance(container, dict) or set(container) - {'items'}:
        raise ValueError('Unsupported dragonflychest container state')
    return {'container': context['items'](container.get('items', {}), 'container', DRAGONFLY_CHEST_SLOT_COUNT),
            'building': {}}


def dragonflyfurnace_components(data, context):
    # dragonfurnace.lua's furnace saves only container.lua's items: the incinerator and heater save nothing.
    # The `salad` flag belongs to the unported saladfurnace prefab and is rejected with every other field.
    if set(data) - {'container'}:
        raise ValueError('Unsupported dragonflyfurnace save state')
    check_skin('dragonflyfurnace', context['skin'])
    container = data.get('container') or {}
    if not isinstance(container, dict) or set(container) - {'items'}:
        raise ValueError('Unsupported dragonflyfurnace container state')
    return {'container': context['items'](container.get('items', {}), 'container', DRAGONFLY_FURNACE_SLOT_COUNT),
            'building': {}}


def stewer_components(data):
    """stewer.lua OnSave -> StewerSaveData; a pot that never cooked saves an empty table."""
    if not isinstance(data, dict) or set(data) - STEWER_FIELDS:
        raise ValueError('Unsupported cookpot stewer state')
    product = data.get('product')
    if product is None:
        # stewer.lua OnLoad ignores every field without a product: a harvested pot keeps only its last ingredients.
        return None
    if type(product) is not str:
        raise ValueError('Unsupported cookpot stewer product')
    done = data.get('done', False)
    if type(done) is not bool:
        raise ValueError('Unsupported cookpot stewer done flag')
    remaining = data.get('remainingtime')
    if remaining is not None and (type(remaining) not in (int, float) or not math.isfinite(remaining) or remaining < 0):
        raise ValueError('Unsupported cookpot stewer remaining time')
    ingredients = data.get('ingredient_prefabs')
    if ingredients is not None and (not isinstance(ingredients, list) or not all(type(p) is str for p in ingredients)):
        raise ValueError('Unsupported cookpot stewer ingredients')
    chef = data.get('chef_id')
    if chef is not None and type(chef) is not str:
        raise ValueError('Unsupported cookpot stewer chef')
    return {'product': product,
            **({'done': True} if done else {}),
            **({'remainingtime': remaining} if remaining is not None else {}),
            **({} if ingredients is None else {'ingredient_prefabs': ingredients}),
            **({} if chef is None else {'chef_id': chef})}


def cookpot_components(data, context):
    # cookpot.lua onsave writes burnt; container.lua and stewer.lua OnSave write the pot's contents and cooking state.
    if set(data) - {'container', 'stewer', 'burnt'}:
        raise ValueError('Unsupported cookpot save state')
    if 'burnt' in data and data['burnt'] is not True:
        raise ValueError('Expected a true cookpot burnt flag')
    check_skin('cookpot', context['skin'])
    if data.get('burnt'):
        # DefaultBurntStructureFn removes the container and the stewer, so a burnt pot saves neither.
        if 'container' in data or 'stewer' in data:
            raise ValueError('A burnt cookpot has no container or stewer')
        return {'building': {'burnt': True}}
    container = data.get('container') or {}
    if not isinstance(container, dict) or set(container) - {'items'}:
        raise ValueError('Unsupported cookpot container state')
    components = {'container': context['items'](container.get('items', {}), 'container', COOK_POT_SLOT_COUNT),
                  'building': {}}
    stewer = data.get('stewer')
    if stewer is not None:
        converted = stewer_components(stewer)
        if converted is not None:
            components['stewer'] = converted
    return components
