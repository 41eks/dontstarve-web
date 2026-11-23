#!/usr/bin/env python3
"""DST inventory item save records -> the project's held records, shared by the player and item containers.

An item keeps GetSaveRecord's shape: its prefab, its skinname and the records of the components the project's item has
(stackable, finiteuses, fueled, perishable, inventoryitemmoisture, container), as packages/prefab/src/saveRecord.ts
HeldEntityRecord declares it.
"""

from typing import Any, cast

from pydantic import JsonValue
from typing_extensions import TypedDict

from dst_save_schema import HeldEntityRecord, ItemSpec, SaveCatalog, SlotItemsSave


class SkippedItem(TypedDict):
    path: str
    prefab: str | None
    reason: str


class DroppedComponents(TypedDict):
    path: str
    prefab: str
    components: list[str]


class ItemImportReport(TypedDict):
    skipped: list[SkippedItem]
    droppedComponents: list[DroppedComponents]


def lua_slots(items: object, path: str) -> list[tuple[int, Any]]:
    # Inventory/Container:OnSave key items by one-based slot; a table with holes is read as a keyed dict.
    if isinstance(items, list):
        return list(enumerate(items, 1))
    if not isinstance(items, dict) or any(type(slot) is not int or slot < 1 for slot in items):
        raise ValueError(f'Expected one-based slots in {path}')
    return sorted(items.items())


def item_components(
    prefab: str,
    data: dict[str, Any],
    spec: ItemSpec,
    path: str,
    entity_id: str,
    catalog: SaveCatalog,
    report: ItemImportReport,
) -> tuple[dict[str, JsonValue], list[str]]:
    """An item's component records the project keeps, and the names of the ones it drops."""
    components: dict[str, JsonValue] = {}
    dropped: list[str] = []
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
            slots = convert_slots(value.get('items', {}), f'{path}.container', spec['containerSlots'],
                                  entity_id, catalog, report)
            components['container'] = cast(JsonValue, slots)
        else:
            dropped.append(component)
    return components, dropped


def convert_item(
    record: dict[str, Any], path: str, entity_id: str, catalog: SaveCatalog, report: ItemImportReport,
) -> HeldEntityRecord | None:
    """GetSaveRecord of an inventory item -> held record; unsupported items and components are reported."""
    prefab = record.get('prefab')
    spec = catalog['items'].get(prefab) if isinstance(prefab, str) else None
    if not isinstance(prefab, str) or spec is None:
        report['skipped'].append({'path': path, 'prefab': prefab, 'reason': 'unknown item'})
        return None
    data = record.get('data') or {}
    if not isinstance(data, dict):
        raise ValueError(f'Expected component data at {path}')
    dropped = []
    skin = record.get('skinname')
    if skin is not None and (skin not in catalog['skins'] or catalog['skins'][skin] not in (None, prefab)):
        dropped.append('skinname')
        skin = None
    components, dropped_components = item_components(prefab, data, spec, path, entity_id, catalog, report)
    dropped += dropped_components
    if dropped:
        report['droppedComponents'].append({'path': path, 'prefab': prefab, 'components': dropped})
    if skin is not None:
        return {'id': entity_id, 'prefab': prefab, 'skinname': skin, 'components': components}
    return {'id': entity_id, 'prefab': prefab, 'components': components}


def convert_slots(
    items: object, path: str, slot_count: int, entity_prefix: str, catalog: SaveCatalog, report: ItemImportReport,
) -> SlotItemsSave:
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
