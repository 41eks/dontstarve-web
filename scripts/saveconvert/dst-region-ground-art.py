#!/usr/bin/env python3
"""Static ground art: loose items imported as their own prefabs with identity, position, quantity, skin and visual
variant, but no interactive component."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
GROUND_ART_ACTORS = {'mole', 'butterfly', 'moonbutterfly', 'fireflies', 'lightflier',
                     'bernie_inactive', 'crow', 'robin', 'robin_winter', 'canary'}


def ground_art_catalog():
    catalog = json.loads((ROOT / 'packages/prefab/src/groundItems.json').read_text())
    return {key: value for key, value in (catalog['items'] | catalog['staticItems']).items()
            if key not in GROUND_ART_ACTORS}, catalog['staticVariants']


def bundle_size(unwrappable):
    # unwrappable.lua: the wrapped items choose the bundle's small, medium or large art.
    size = len((unwrappable or {}).get('items') or [])
    return 'large' if size > 3 else 'medium' if size > 1 else 'small'


def trap_state(trap):
    # trap.lua OnSave: a sprung trap shows whether it caught loot.
    return ('full' if trap.get('loot') is not None else 'empty') if (trap or {}).get('sprung') else None


# The saved component or OnSave field that picks an item's art, with the variant it selects from the saved value (or
# from the constructor's default when the key is not saved). Only an item with catalog variants reads them.
GROUND_VARIANTS = (
    ('anim', lambda value, data: value),  # rocks.lua / ice.lua
    ('glassname', lambda value, data: value),  # moonglass.lua
    ('variation', lambda value, data: str(value if value is not None else 1)),  # singingshell.lua _variation
    ('is_rare', lambda value, data: 'rare' if value else None),  # blueprint.lua
    ('unwrappable', lambda value, data: bundle_size(value)),
    ('playingcard', lambda value, data: str((value or {}).get('card_id')) if data.get('faceup') else None),
    ('trap', lambda value, data: trap_state(value)),
)


def ground_variant(prefab, data, variants):
    """The first variant the catalog lists for this item. A saved key selecting only unlisted variants fails."""
    known = variants.get(prefab)
    if not known:
        return None
    unknown = None
    for key, select in GROUND_VARIANTS:
        variant = select(data.get(key), data)
        if variant in known:
            return variant
        if variant is not None and key in data and unknown is None:
            unknown = variant
    if unknown is not None:
        raise ValueError(f'Unsupported {prefab} ground variant: {unknown}')
    return None


def static_ground_components(prefab, record, definitions, variants):
    """Keep the saved visual branch and quantity; no interactive component is instantiated. The skin is the record's."""
    data = record.get('data') or {}
    count = (data.get('stackable') or {}).get('stack', 1)
    if type(count) is not int or not 1 <= count <= 9007199254740991:
        raise ValueError(f'Invalid {prefab} ground stack')
    components = {'stackable': {'stack': count}} if count != 1 else {}
    skin = record.get('skinname')
    if skin is not None and skin not in definitions[prefab]['skinArchives']:
        raise ValueError(f'Unsupported {prefab} ground skin: {skin}')
    variant = ground_variant(prefab, data, variants)
    if variant is not None:
        components['groundVariant'] = variant
    return components
