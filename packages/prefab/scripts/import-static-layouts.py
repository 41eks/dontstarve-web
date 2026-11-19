#!/usr/bin/env python3
"""Write world generation's static layouts into project saves, around the saved entities that anchor them.

Reads map/static_layouts/<name>.lua with luajit and applies the same BG_TILES sampling
(every tilefactor-th cell, `tilefactor = ceil(64 / tilewidth)`) and FG_OBJECTS positions
(`x = (obj.x + width / 2) / 64 - (layout width / tilefactor) / 2`, in tile units) as the
Lua loader. Tile values are GROUND_TYPES indices, resolved here to WORLD_TILES names.

Like object_layout.lua ReserveAndPlaceLayout with `layout_position = CENTER`, each layout is centred on the tile
corner nearest its anchor and its tiles are written into the save's `world.map.tiles`; a cell the save already
holds keeps its saved tile. The layout's other objects must already be saved entities at their authored offsets.
Saves imported from DST (import-dst-region.py) already hold worldgen's final tiles and need no layout.

Usage: import-static-layouts.py [--source DIR] [--check] [SAVE ...]
"""
import argparse
import json
import math
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
# Each layout, by the prefab that anchors it in a save (layouts.lua DefaultPigking).
LAYOUTS = {'default_pigking': 'pigking'}
# The project's scene units per tile: TILE_SIZE in packages/animation/src/units.ts.
TILE_SIZE = 12
DEFAULT_SAVES = ['public/saves/initial-world.json', 'public/saves/initial-world copy 2.json',
                 'public/saves/initial-world.10k-fireflies.json', 'public/saves/Master.json']

DUMP = r'''
local function ser(v)
  local t = type(v)
  if t == "table" then
    local n = 0 for _ in pairs(v) do n = n + 1 end
    if n == #v then
      local parts = {} for i, x in ipairs(v) do parts[i] = ser(x) end
      return "[" .. table.concat(parts, ",") .. "]"
    end
    local parts = {} for k, x in pairs(v) do parts[#parts + 1] = string.format("%q:%s", tostring(k), ser(x)) end
    return "{" .. table.concat(parts, ",") .. "}"
  elseif t == "string" then return string.format("%q", v)
  elseif t == "boolean" then return tostring(v)
  else return tostring(v) end
end
io.write(ser(dofile(arg[1])))
'''


def ground_types(scripts):
    source = (scripts / 'map/static_layout.lua').read_text()
    block = re.search(r'local GROUND_TYPES =\s*\{(.*?)\n\}', source, re.S)[1]
    block = re.sub(r'--[^\n]*', '', block)
    return [name for name in re.findall(r'WORLD_TILES\.(\w+)', block)]


def convert(scripts, name, types):
    raw = subprocess.run(['luajit', '-e', f'arg = {{[1] = "{scripts}/map/static_layouts/{name}.lua"}} {DUMP}'],
                         check=True, capture_output=True, text=True).stdout
    layout = json.loads(raw)
    factor = math.ceil(64 / layout['tilewidth'])
    ground, objects = [], []
    for layer in layout['layers']:
        if layer['type'] == 'tilelayer' and layer['name'] == 'BG_TILES':
            width, data = layer['width'], layer['data']
            offset = width * (factor - 1)
            i = offset
            while i < len(data):
                row, j = [], 1
                while j <= width and i + j <= len(data):
                    value = data[i + j - 1]
                    row.append(types[value - 1] if value else None)
                    j += factor
                ground.append(row)
                i += offset + width
        elif layer['type'] == 'objectgroup' and 'FG_OBJECTS' in layer['name']:
            for obj in layer['objects']:
                x = (obj['x'] + obj['width'] / 2) / 64 - (layout['width'] / factor) / 2
                y = (obj['y'] + obj['height'] / 2) / 64 - (layout['height'] / factor) / 2
                objects.append({'prefab': obj['type'], 'x': x, 'y': y})
    objects.sort(key=lambda o: (o['prefab'], o['x'], o['y']))
    return {'ground': ground, 'objects': objects}


def place(layout, anchor_prefab, anchor):
    """ReserveAndPlaceLayout with CENTER: the layout's tile cells and other objects around the corner nearest `anchor` (x, z)."""
    corner = [math.floor(value / TILE_SIZE + .5) * TILE_SIZE for value in anchor]
    half = len(layout['ground']) / 2
    tiles = {}
    for row_index, row in enumerate(layout['ground']):
        for column_index, name in enumerate(row):
            if name is None:
                continue
            x = corner[0] + (column_index - half + .5) * TILE_SIZE
            z = corner[1] + (row_index - half + .5) * TILE_SIZE
            tiles[(math.floor(x / TILE_SIZE), math.floor(z / TILE_SIZE))] = name
    objects = [(o['prefab'], corner[0] + o['x'] * TILE_SIZE, corner[1] + o['y'] * TILE_SIZE)
               for o in layout['objects'] if o['prefab'] != anchor_prefab]
    return tiles, objects


def apply(save, layouts, tile_ids):
    """The save's tiles with each anchored layout's tiles added; raises when a layout object is missing."""
    tiles = save['world']['map'].setdefault('tiles', [])
    held = {(tile['col'], tile['row']) for tile in tiles}
    entities = save['world']['entities']
    for name, anchor_prefab in LAYOUTS.items():
        for anchor in entities.get(anchor_prefab, []):
            x, _, z = anchor['transform']['position']
            cells, objects = place(layouts[name], anchor_prefab, (x, z))
            for (col, row), tile in sorted(cells.items(), key=lambda item: (item[0][1], item[0][0])):
                if (col, row) not in held:
                    tiles.append({'col': col, 'row': row, 'tileId': tile_ids[tile]})
                    held.add((col, row))
            for prefab, ox, oz in objects:
                if not any(abs(r['transform']['position'][0] - ox) < 1e-6 and abs(r['transform']['position'][2] - oz) < 1e-6
                           for r in entities.get(prefab, [])):
                    raise ValueError(f'{name} around {anchor["id"]} needs a {prefab} at ({ox}, {oz})')


def indent_of(text):
    """The indent the file was written with, so a rewrite changes only the tiles."""
    data = json.loads(text)
    for indent in (2, 4, 1):
        if json.dumps(data, ensure_ascii=False, indent=indent) + '\n' == text:
            return indent
    raise ValueError('save is not in a JSON layout this script rewrites')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true', help='Verify the saves already hold their layouts')
    parser.add_argument('saves', nargs='*', type=Path, default=[ROOT / path for path in DEFAULT_SAVES])
    args = parser.parse_args()
    scripts = args.source / 'databundles/scripts_unpacked/scripts'
    types = ground_types(scripts)
    layouts = {name: convert(scripts, name, types) for name in LAYOUTS}
    tile_ids = {name: spec['tileId'] for name, spec in
                json.loads((ROOT / 'packages/prefab/src/groundTiles.json').read_text()).items()}
    for path in args.saves:
        text = path.read_text()
        save = json.loads(text)
        apply(save, layouts, tile_ids)
        serialized = json.dumps(save, ensure_ascii=False, indent=indent_of(text)) + '\n'
        if serialized != text:
            if args.check:
                raise ValueError(f'{path} lacks its static layout tiles')
            path.write_text(serialized)
        print(f'{"Checked" if args.check else "Applied"} {", ".join(LAYOUTS)} in {path}')


if __name__ == '__main__':
    main()
