#!/usr/bin/env python3
"""DST inventory item save records -> the project's held records, shared by the player and item containers.

An item keeps GetSaveRecord's shape: its prefab, its skinname and the records of the components the project's item has
(stackable, finiteuses, fueled, perishable, inventoryitemmoisture, container), as packages/prefab/src/saveRecord.ts
HeldEntityRecord declares it.
"""


def lua_slots(items, path):
    # Inventory/Container:OnSave key items by one-based slot; a table with holes is read as a keyed dict.
    if isinstance(items, list):
        return list(enumerate(items, 1))
    if not isinstance(items, dict) or any(type(slot) is not int or slot < 1 for slot in items):
        raise ValueError(f'Expected one-based slots in {path}')
    return sorted(items.items())


def item_components(prefab, data, spec, path, entity_id, catalog, report):
    """An item's component records the project keeps, and the names of the ones it drops."""
    components, dropped = {}, []
    count = (data.get('stackable') or {}).get('stack', 1)
    if type(count) is not int or not 1 <= count <= spec['maxStack']:
        raise ValueError(f'{path}: stack {count} exceeds {prefab} maxStack {spec["maxStack"]}')
    if count != 1:
        components['stackable'] = {'stack': count}
    for component, value in data.items():
        if component == 'stackable':
            continue
        if component == 'finiteuses' and 'maxUses' in spec:
            uses, step = value['uses'], spec.get('useStep', 1)
            if not step <= uses <= spec['maxUses'] or uses / step != round(uses / step):
                raise ValueError(f'{path}: {prefab} uses {uses} outside the project durability')
            components['finiteuses'] = {'uses': uses}
        elif component == 'fueled' and 'maxFuel' in spec:
            fuel = value.get('fuel')
            if fuel is None:
                continue
            if not 0 <= fuel <= spec['maxFuel']:
                raise ValueError(f'{path}: {prefab} fuel {fuel} outside the project fuel')
            components['fueled'] = {'fuel': fuel}
        elif component == 'perishable' and 'perishTime' in spec and value.get('time') is not None:
            # perishremainingtime, bounded by the project's perishable:SetPerishTime.
            components['perishable'] = {'time': min(value['time'], spec['perishTime']), **({'paused': True} if value.get('paused') else {})}
        elif component == 'inventoryitemmoisture':
            moisture = {**({'moisture': min(max(value['moisture'], 0), 100)} if value.get('moisture') else {}),
                        **({'wet': True} if value.get('wet') else {})}
            if moisture:
                components['inventoryitemmoisture'] = moisture
        elif component == 'container' and 'containerSlots' in spec:
            components['container'] = convert_slots(value.get('items', {}), f'{path}.container', spec['containerSlots'],
                                                    entity_id, catalog, report)
        else:
            dropped.append(component)
    return components, dropped


def convert_item(record, path, entity_id, catalog, report):
    """GetSaveRecord of an inventory item -> held record; unsupported items and components are reported."""
    prefab = record.get('prefab')
    spec = catalog['items'].get(prefab)
    if spec is None:
        report['skipped'].append({'path': path, 'prefab': prefab, 'reason': 'unknown item'})
        return None
    data = record.get('data') or {}
    if not isinstance(data, dict):
        raise ValueError(f'Expected component data at {path}')
    item, dropped = {'id': entity_id, 'prefab': prefab}, []
    skin = record.get('skinname')
    if skin is not None:
        if skin in catalog['skins'] and catalog['skins'][skin] in (None, prefab):
            item['skinname'] = skin
        else:
            dropped.append('skinname')
    item['components'], dropped_components = item_components(prefab, data, spec, path, entity_id, catalog, report)
    dropped += dropped_components
    if dropped:
        report['droppedComponents'].append({'path': path, 'prefab': prefab, 'components': dropped})
    return item


def convert_slots(items, path, slot_count, entity_prefix, catalog, report):
    """Container:OnSave items -> held records by one-based slot; items that cannot go in a container are reported."""
    converted_items = {}
    for slot, child in lua_slots(items, path):
        child_path = f'{path}.{slot}'
        if slot > slot_count:
            raise ValueError(f'{child_path} is outside the container')
        converted = convert_item(child, child_path, f'{entity_prefix}_{slot - 1}', catalog, report)
        if converted is None:
            continue
        spec = catalog['items'][converted['prefab']]
        if 'containerSlots' in spec or spec.get('canGoInContainer') is False:
            report['skipped'].append({'path': child_path, 'prefab': converted['prefab'], 'reason': 'cannot go in a container'})
            continue
        converted_items[str(slot)] = converted
    return {'items': converted_items}
