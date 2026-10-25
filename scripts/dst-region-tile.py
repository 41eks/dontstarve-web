#!/usr/bin/env python3
"""DST map grid -> project world map: tile remapping, coordinate projection and spawn selection."""
import base64
from collections import Counter
from pathlib import Path
import runpy
import struct
import zlib

LITERALS = runpy.run_path(str(Path(__file__).with_name('dst-save-literal.py')))
TILE_SIZE = 12
SHARDS = {'forest': ('Master', 'master'), 'cave': ('Caves', 'caves')}
# tiledefs.lua TileRanges.OCEAN; OCEAN_ICE belongs to LAND.
OCEAN_TILES = {'OCEAN_COASTAL_SHORE', 'OCEAN_COASTAL', 'OCEAN_WATERLOG', 'OCEAN_BRINEPOOL',
               'OCEAN_SWELL', 'OCEAN_ROUGH', 'OCEAN_HAZARDOUS', 'OCEAN_BRINEPOOL_SHORE'}


def source_grid_position(coordinate, extent):
    # map/bunch_spawner.lua and waterlog_worldgen.lua checkIfValidGround:
    # floor(extent / 2 + .5 + coordinate / TILE_SCALE).
    # These are cell-boundary coordinates, matching the project's floor(world / TILE_SIZE).
    return coordinate / 4 + extent / 2 + .5


def project_position(coordinates, translation):
    # DST's world is left-handed and Three.js is right-handed (see packages/ui/src/minimap-view.ts):
    # keep X and negate Z so the imported map is not mirrored.
    x, y, z = (round(value * TILE_SIZE / 4 + shift, 6) for value, shift in zip(coordinates, translation))
    return [x, y, 0 - z]


def decode_grid(encoded, width, height):
    data = base64.b64decode(encoded, validate=True)
    if data[:9] != b'VRSN\0\x01\0\0\0' or len(data) != 9 + width * height * 2:
        raise ValueError('Unsupported DST grid header or dimensions')
    return struct.unpack(f'<{width * height}H', data[9:])


def decode_underneath(terrain):
    # components/undertile.lua -> DataGrid:Save -> ZipAndEncodeSaveData.
    saved = terrain.get('persistdata', {}).get('undertile')
    if saved is None:
        return {}
    if not isinstance(saved, dict) or set(saved) != {'str'}:
        raise ValueError('Unsupported undertile save state')
    encoded = base64.b64decode(saved['str'], validate=True)
    if len(encoded) < 16:
        raise ValueError('Invalid zipped undertile header')
    version, offset, raw_size, compressed_size = struct.unpack('<4I', encoded[:16])
    if version != 1 or offset != 16 or compressed_size != len(encoded) - offset or raw_size > 16 * 1024 * 1024:
        raise ValueError('Unsupported zipped undertile header')
    decoder = zlib.decompressobj()
    raw = decoder.decompress(encoded[offset:], raw_size + 1)
    if len(raw) != raw_size or not decoder.eof or decoder.unused_data:
        raise ValueError('Invalid zipped undertile data')
    data = LITERALS['returned_table'](raw.decode())
    grid = data.get('underneath_tiles')
    if grid == []:
        return {}
    if not isinstance(grid, dict) or any(type(key) is not int or not 0 <= key < terrain['width'] * terrain['height']
                                         or type(value) is not int for key, value in grid.items()):
        raise ValueError('Invalid underlying tile grid')
    return grid


def convert_map(terrain, supported, origin_cell=None):
    """The project world (without entities), the player's spawn position and the provenance report."""
    prefab = terrain['prefab']
    if prefab not in SHARDS:
        raise ValueError('Only forest and cave terrain imports are supported')
    _, shard_id = SHARDS[prefab]
    width, height = terrain['width'], terrain['height']
    tiles = decode_grid(terrain['tiles'], width, height)
    nodes = decode_grid(terrain['nodeidtilemap'], width, height)
    names = terrain['topology']['ids']
    # IDs are versioned: resolve source ID -> source name -> current runtime ID.
    source_names = {tile_id: name for name, tile_id in terrain['world_tile_map'].items()}
    unassigned_nodes = set()
    map_cells = []
    for index, (tile_id, node_id) in enumerate(zip(tiles, nodes)):
        name = source_names.get(tile_id)
        if node_id > len(names):
            # Forest ocean cells can retain IDs after their topology nodes have been removed.
            if prefab != 'forest' or name not in OCEAN_TILES:
                raise ValueError('Grid references an unknown topology node')
            unassigned_nodes.add(node_id)
        if name == 'IMPASSABLE':
            continue
        if name not in supported:
            raise ValueError(f'Unsupported terrain {name or tile_id} at source cell ({index % width}, {index // width})')
        map_cells.append((index % width, index // width, name, supported[name], node_id))
    land = [cell for cell in map_cells if cell[2] != 'FAKE_GROUND' and cell[2] not in OCEAN_TILES]
    if not land:
        raise ValueError('Source map contains no land')
    min_x, max_x = min(c[0] for c in land), max(c[0] for c in land)
    min_z, max_z = min(c[1] for c in land), max(c[1] for c in land)
    origin_x, origin_z = origin_cell if origin_cell is not None else ((min_x + max_x) // 2, (min_z + max_z) // 2)
    # Include the complete source grid, including its impassable outer border.
    half = max(abs(origin_x), abs(width - 1 - origin_x), abs(origin_z), abs(height - 1 - origin_z)) + 3
    underneath = decode_underneath(terrain)
    saved_tiles = []
    for x, z, name, tile_id, _ in map_cells:
        # Source rows grow along DST +Z; project_position negates Z, so rows are mirrored around the origin.
        tile = {'col': x - origin_x, 'row': origin_z - z - 1, 'tileId': tile_id}
        if name in ('FARMING_SOIL', 'MONKEY_DOCK', 'OCEAN_ICE') and z * width + x in underneath:
            under_name = source_names.get(underneath[z * width + x])
            if under_name not in supported:
                raise ValueError(f'Unsupported underlying terrain {under_name}')
            tile['underTileId'] = supported[under_name]
        if name == 'MONKEY_DOCK' and 'underTileId' not in tile:
            raise ValueError(f'Missing underlying ocean at dock ({x}, {z})')
        saved_tiles.append(tile)
    # Choose a safe land tile near the map's land centre, without selecting a region.
    spawn_cells = land
    occupied = {(c[0], c[1]) for c in land}
    interior = [c for c in spawn_cells if all((c[0] + dx, c[1] + dz) in occupied
                for dx in (-1, 0, 1) for dz in (-1, 0, 1))]
    if not interior:
        raise ValueError('No safe interior spawn tile in the source map')
    cx = sum(c[0] for c in spawn_cells) / len(spawn_cells)
    cz = sum(c[1] for c in spawn_cells) / len(spawn_cells)
    spawn = min(interior, key=lambda c: (c[0] - cx) ** 2 + (c[1] - cz) ** 2)
    world = {
        'shardId': shard_id, 'prefab': prefab, 'elapsedSeconds': 0, 'systems': {},
        'map': {'kind': 'generated', 'defaultTileId': 1, 'tiles': saved_tiles,
                'generator': {'id': 'dst-map-v1', 'options': {
                    'size': half * 2 * TILE_SIZE, 'moonTreeCount': 0, 'moonTreeExclusionRadiusSquared': 0}}},
        'entities': {},
    }
    spawn_position = [(spawn[0] - origin_x + .5) * TILE_SIZE, 0, (origin_z - spawn[1] - .5) * TILE_SIZE]
    report = {
        'scope': 'full-map', 'nodes': names,
        **({'unassignedNodeIds': sorted(unassigned_nodes)} if unassigned_nodes else {}),
        'sourceDimensions': [width, height], 'sourceBounds': [min_x, min_z, max_x, max_z],
        'sourceOriginCell': [origin_x, origin_z], 'worldScale': TILE_SIZE / 4, 'mirroredAxis': 'z',
        'translation': [(source_grid_position(0, width) - origin_x) * TILE_SIZE, 0,
                        (source_grid_position(0, height) - origin_z) * TILE_SIZE],
        'tileCounts': dict(sorted(Counter(c[2] for c in map_cells).items())),
        'landCells': len(land), 'savedCells': len(saved_tiles),
        'note': 'Original impassable gaps and FAKE_GROUND are non-walkable; only whitelisted source entities are imported. No bridges are generated.',
    }
    return world, spawn_position, report
