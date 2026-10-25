#!/usr/bin/env python3
"""DST inventory item save records -> project InventoryStack, shared by the player and item containers."""

BACKPACK_SLOT_COUNT = 8


def lua_slots(items, path):
    # Inventory/Container:OnSave key items by one-based slot; a table with holes is read as a keyed dict.
    if isinstance(items, list):
        return list(enumerate(items, 1))
    if not isinstance(items, dict) or any(type(slot) is not int or slot < 1 for slot in items):
        raise ValueError(f'Expected one-based slots in {path}')
    return sorted(items.items())


def convert_item(record, path, entity_id, catalog, report):
    """GetSaveRecord of an inventory item -> InventoryStack; unsupported items and components are reported."""
    prefab = record.get('prefab')
    spec = catalog['items'].get(prefab)
    if spec is None:
        report['skipped'].append({'path': path, 'prefab': prefab, 'reason': 'unknown item'})
        return None
    data = record.get('data') or {}
    if not isinstance(data, dict):
        raise ValueError(f'Expected component data at {path}')
    item, dropped = {'entityId': entity_id, 'itemId': prefab}, []
    count = (data.get('stackable') or {}).get('stack', 1)
    if type(count) is not int or not 1 <= count <= spec['maxStack']:
        raise ValueError(f'{path}: stack {count} exceeds {prefab} maxStack {spec["maxStack"]}')
    item['count'] = count
    skin = record.get('skinname')
    if skin is not None:
        if skin in catalog['skins'] and catalog['skins'][skin] in (None, prefab):
            item['skinId'] = skin
        else:
            dropped.append('skinname')
    for component, value in data.items():
        if component == 'stackable':
            continue
        if component == 'finiteuses' and 'maxUses' in spec:
            uses, step = value['uses'], spec.get('useStep', 1)
            if not step <= uses <= spec['maxUses'] or uses / step != round(uses / step):
                raise ValueError(f'{path}: {prefab} uses {uses} outside the project durability')
            item['remainingUses'] = uses
        elif component == 'fueled' and 'maxFuel' in spec:
            fuel = value.get('fuel', spec['maxFuel'])
            if not 0 <= fuel <= spec['maxFuel']:
                raise ValueError(f'{path}: {prefab} fuel {fuel} outside the project fuel')
            item['remainingFuel'] = fuel
        elif component == 'perishable' and 'perishTime' in spec and value.get('time') is not None:
            # perishremainingtime -> remaining fraction of perishable:SetPerishTime.
            if value.get('paused'):
                dropped.append('perishable.paused')
            item['freshnessPercent'] = min(value['time'] / spec['perishTime'], 1)
        elif component == 'inventoryitemmoisture':
            if value.get('wet'):
                item['wet'] = True
        elif component == 'container' and prefab == 'backpack':
            item['container'] = convert_slots(value.get('items', {}), f'{path}.container', BACKPACK_SLOT_COUNT,
                                              entity_id, catalog, report)
        else:
            dropped.append(component)
    if dropped:
        report['droppedComponents'].append({'path': path, 'prefab': prefab, 'components': dropped})
    return item


def convert_slots(items, path, slot_count, entity_prefix, catalog, report):
    """Container:OnSave items -> saved container slots; items that cannot go in a container are reported."""
    slots = []
    for slot, child in lua_slots(items, path):
        child_path = f'{path}.{slot}'
        if slot > slot_count:
            raise ValueError(f'{child_path} is outside the container')
        converted = convert_item(child, child_path, f'{entity_prefix}_{slot - 1}', catalog, report)
        if converted is None:
            continue
        if converted['itemId'] == 'backpack' or catalog['items'][converted['itemId']].get('canGoInContainer') is False:
            report['skipped'].append({'path': child_path, 'prefab': converted['itemId'], 'reason': 'cannot go in a container'})
            continue
        slots.append({'slotKey': str(slot - 1), 'item': converted})
    return {'slotCount': slot_count, 'slots': slots}
