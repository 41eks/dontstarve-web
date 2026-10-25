#!/usr/bin/env python3
"""Inventory item save states: live stacks and static ground art."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


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


GROUND_ART_ACTORS = {'mole', 'butterfly', 'moonbutterfly', 'fireflies', 'lightflier',
                     'bernie_inactive', 'crow', 'robin', 'robin_winter', 'canary'}


def ground_art_catalog():
    catalog = json.loads((ROOT / 'packages/prefab/src/groundItems.json').read_text())
    return {key: value for key, value in (catalog['items'] | catalog['staticItems']).items()
            if key not in GROUND_ART_ACTORS}, catalog['staticVariants']


def static_ground_components(prefab, record, definitions, variants):
    """Keep the saved visual branch and quantity; no interactive component is instantiated."""
    data = record.get('data') or {}
    count = (data.get('stackable') or {}).get('stack', 1)
    if type(count) is not int or not 1 <= count <= 9007199254740991:
        raise ValueError(f'Invalid {prefab} ground stack')
    state = {'itemId': prefab, 'count': count}
    skin = record.get('skinname')
    if skin is not None:
        if skin not in definitions[prefab]['skinArchives']:
            raise ValueError(f'Unsupported {prefab} ground skin: {skin}')
        state['skinId'] = skin
    variant = None
    if prefab in ('rocks', 'ice'):
        variant = data.get('anim')
    elif prefab == 'moonglass':
        variant = data.get('glassname')
    elif prefab.startswith('singingshell_octave'):
        variant = str(data.get('variation', 1))
    elif prefab == 'blueprint' and data.get('is_rare'):
        variant = 'rare'
    elif prefab == 'bundle':
        size = len((data.get('unwrappable') or {}).get('items') or [])
        variant = 'large' if size > 3 else 'medium' if size > 1 else 'small'
    elif prefab == 'playing_card' and data.get('faceup'):
        variant = str((data.get('playingcard') or {}).get('card_id'))
    elif prefab == 'trap' and (data.get('trap') or {}).get('sprung'):
        variant = 'full' if (data['trap'].get('loot') is not None) else 'empty'
    if variant is not None:
        if variant not in variants.get(prefab, {}):
            raise ValueError(f'Unsupported {prefab} ground variant: {variant}')
        state['variant'] = variant
    return {'stack': state}
