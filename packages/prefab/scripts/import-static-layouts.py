#!/usr/bin/env python3
"""Convert static_layout.lua's ConvertStaticLayoutToLayout output for the layouts the game places.

Reads map/static_layouts/<name>.lua with luajit and applies the same BG_TILES sampling
(every tilefactor-th cell, `tilefactor = ceil(64 / tilewidth)`) and FG_OBJECTS positions
(`x = (obj.x + width / 2) / 64 - (layout width / tilefactor) / 2`, in tile units) as the
Lua loader. Tile values are GROUND_TYPES indices, resolved here to WORLD_TILES names.

Usage: import-static-layouts.py [--source DIR] [--check]
"""
import argparse
import json
import math
import re
import subprocess
from pathlib import Path

LAYOUTS = ['default_pigking']

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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    scripts = args.source / 'databundles/scripts_unpacked/scripts'
    types = ground_types(scripts)
    result = {name: convert(scripts, name, types) for name in LAYOUTS}
    target = Path(__file__).resolve().parent.parent / 'src/staticLayouts.json'
    serialized = json.dumps(result, indent=1) + '\n'
    if args.check:
        if target.read_text() != serialized:
            raise ValueError('staticLayouts.json is out of date')
    else:
        target.write_text(serialized)
    print(f'{"Checked" if args.check else "Imported"} {len(result)} static layouts')


if __name__ == '__main__':
    main()
