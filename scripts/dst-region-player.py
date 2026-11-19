#!/usr/bin/env python3
"""DST player snapshot -> project local player: position and inventory (inventory.lua OnSave's records)."""
import math
from pathlib import Path
import runpy

TILE = runpy.run_path(str(Path(__file__).with_name('dst-region-tile.py')))
ITEM = runpy.run_path(str(Path(__file__).with_name('dst-region-item.py')))
project_position, lua_slots, convert_item = TILE['project_position'], ITEM['lua_slots'], ITEM['convert_item']

# inventory.lua EQUIPSLOTS names, which the save keeps, -> the project equip kind an item declares.
EQUIP_SLOTS = {'hands': 'hand', 'body': 'body', 'head': 'head'}
PLAYER_SLOT_COUNT = 15


def reset_player(player, shard_id, position):
    """The template player becomes a full-stat Wilson with empty inventory at the map's spawn."""
    player['prefab'] = 'wilson'
    player['shardId'] = shard_id
    player['transform'] = {'position': position, 'rotationY': 0}
    player.pop('ghost', None)
    player['stats'] = {'health': 150, 'hunger': 150, 'sanity': 200}
    player['inventory'] = {'items': {}, 'equip': {}}
    player['builder'] = {'bufferedBuilds': []}


def convert_player(source, translation, size, entity_prefix, catalog):
    """A DST player snapshot's position and inventory; stats and the character stay the template's."""
    data = source.get('data') or {}
    inventory = data.get('inventory') or {}
    report = {'character': source.get('prefab'), 'sourcePosition': [source.get('x', 0), 0, source.get('z', 0)],
              'skipped': [], 'droppedComponents': []}
    position = project_position(report['sourcePosition'], translation)
    if any(type(value) not in (int, float) or not math.isfinite(value) or abs(value) > size / 2 for value in position):
        raise ValueError('Player position is outside the imported map')
    converted = {'items': {}, 'equip': {}}
    for slot, record in lua_slots(inventory.get('items', {}), 'inventory.items'):
        if slot > PLAYER_SLOT_COUNT:
            raise ValueError(f'inventory.items.{slot} is outside the player inventory')
        item = convert_item(record, f'inventory.items.{slot}', f'{entity_prefix}_items_{slot - 1}', catalog, report)
        if item is not None:
            converted['items'][str(slot)] = item
    for equipslot in EQUIP_SLOTS:
        record = (inventory.get('equip') or {}).get(equipslot)
        if record is None:
            continue
        path = f'inventory.equip.{equipslot}'
        item = convert_item(record, path, f'{entity_prefix}_equip_{EQUIP_SLOTS[equipslot]}', catalog, report)
        if item is None:
            continue
        if catalog['items'][item['prefab']].get('equippable') != EQUIP_SLOTS[equipslot]:
            report['skipped'].append({'path': path, 'prefab': item['prefab'], 'reason': f'not equippable in {equipslot}'})
            continue
        converted['equip'][equipslot] = item
    for source_slot, record in (inventory.get('equip') or {}).items():
        if source_slot not in EQUIP_SLOTS:
            report['skipped'].append({'path': f'inventory.equip.{source_slot}', 'prefab': record.get('prefab'), 'reason': 'unknown equipment slot'})
    if inventory.get('activeitem'):
        item = convert_item(inventory['activeitem'], 'inventory.activeitem', f'{entity_prefix}_cursor', catalog, report)
        if item is not None:
            converted['activeitem'] = item
    return position, converted, report


def player_snapshot(session, snapshot):
    """The single local player's file saved with this world snapshot, if the player was in this shard."""
    users = sorted(path for path in session.iterdir() if path.is_dir())
    if len(users) > 1:
        raise ValueError(f'Expected at most one player in {session}')
    if not users or not (users[0] / snapshot).is_file():
        return None, None
    return users[0], users[0] / snapshot
