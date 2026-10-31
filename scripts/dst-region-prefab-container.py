#!/usr/bin/env python3
"""Item container save states: chest contents, skin and burnt flag."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CHEST_SKINS = json.loads((ROOT / 'packages/prefab/src/definitions.json').read_text())['animatedBuildings']['treasurechest']['skinArchives']
# containers.lua params.treasurechest: the 3 x 3 chest widget.
CHEST_SLOT_COUNT = 9


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
    if context['skin'] is not None:
        # DoUpgradeVisuals derives the treasurechest_upgraded_* build at runtime; the saved skinname is the base skin.
        if context['skin'] not in CHEST_SKINS or context['skin'].startswith('treasurechest_upgraded_'):
            raise ValueError(f'Unsupported treasurechest skin: {context["skin"]}')
        building['skinId'] = context['skin']
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
