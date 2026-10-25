#!/usr/bin/env python3
"""DST player snapshot -> project local player: position and inventory."""
import math
from pathlib import Path
import runpy

TILE = runpy.run_path(str(Path(__file__).with_name('dst-region-tile.py')))
ITEM = runpy.run_path(str(Path(__file__).with_name('dst-region-item.py')))
project_position, lua_slots, convert_item = TILE['project_position'], ITEM['lua_slots'], ITEM['convert_item']

# inventory.lua equipslots -> project equipment slot keys.
EQUIP_SLOTS = {'hands': 'hand', 'body': 'body', 'head': 'head'}
PLAYER_SLOT_COUNT = 15


def reset_player(player, shard_id, position):
    """The template player becomes a full-stat Wilson with empty inventory at the map's spawn."""
    player['prefab'] = 'wilson'
    player['shardId'] = shard_id
    player['transform'] = {'position': position, 'rotationY': 0}
    player.pop('ghost', None)
    player['stats'] = {'health': 150, 'hunger': 150, 'sanity': 200}
    player['inventory'] = {'containers': {
        'player:inventory': {'slotCount': PLAYER_SLOT_COUNT, 'slots': []},
        'player:equipment': {'slotCount': 3, 'slots': []},
        'player:cursor': {'slotCount': 1, 'slots': []},
    }, 'bufferedBuilds': []}


def convert_player(source, translation, size, entity_prefix, catalog):
    """A DST player snapshot's position and inventory; stats and the character stay the template's."""
    data = source.get('data') or {}
    inventory = data.get('inventory') or {}
    report = {'character': source.get('prefab'), 'sourcePosition': [source.get('x', 0), 0, source.get('z', 0)],
              'skipped': [], 'droppedComponents': []}
    position = project_position(report['sourcePosition'], translation)
    if any(type(value) not in (int, float) or not math.isfinite(value) or abs(value) > size / 2 for value in position):
        raise ValueError('Player position is outside the imported map')
    slots = []
    for slot, record in lua_slots(inventory.get('items', {}), 'inventory.items'):
        if slot > PLAYER_SLOT_COUNT:
            raise ValueError(f'inventory.items.{slot} is outside the player inventory')
        item = convert_item(record, f'inventory.items.{slot}', f'{entity_prefix}_items_{slot - 1}', catalog, report)
        if item is not None:
            slots.append({'slotKey': str(slot - 1), 'item': item})
    equipment = []
    for source_slot, record in (inventory.get('equip') or {}).items():
        path = f'inventory.equip.{source_slot}'
        slot = EQUIP_SLOTS.get(source_slot)
        if slot is None:
            report['skipped'].append({'path': path, 'prefab': record.get('prefab'), 'reason': 'unknown equipment slot'})
            continue
        item = convert_item(record, path, f'{entity_prefix}_equip_{slot}', catalog, report)
        if item is None:
            continue
        if catalog['items'][item['itemId']].get('equippable') != slot:
            report['skipped'].append({'path': path, 'prefab': item['itemId'], 'reason': f'not equippable in {slot}'})
            continue
        equipment.append({'slotKey': slot, 'item': item})
    cursor = []
    if inventory.get('activeitem'):
        item = convert_item(inventory['activeitem'], 'inventory.activeitem', f'{entity_prefix}_cursor', catalog, report)
        if item is not None:
            cursor.append({'slotKey': '0', 'item': item})
    containers = {
        'player:inventory': {'slotCount': PLAYER_SLOT_COUNT, 'slots': slots},
        'player:equipment': {'slotCount': 3, 'slots': sorted(equipment, key=lambda s: list(EQUIP_SLOTS.values()).index(s['slotKey']))},
        'player:cursor': {'slotCount': 1, 'slots': cursor},
    }
    return position, containers, report


def player_snapshot(session, snapshot):
    """The single local player's file saved with this world snapshot, if the player was in this shard."""
    users = sorted(path for path in session.iterdir() if path.is_dir())
    if len(users) > 1:
        raise ValueError(f'Expected at most one player in {session}')
    if not users or not (users[0] / snapshot).is_file():
        return None, None
    return users[0], users[0] / snapshot
