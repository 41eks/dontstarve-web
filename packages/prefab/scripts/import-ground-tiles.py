#!/usr/bin/env python3
"""Mirror tilemanager.lua's ground atlas/noise paths from tiledefs.lua."""
import argparse
import json
from pathlib import Path
import re
import runpy
import xml.etree.ElementTree as ET


def parse_lua_table(text, pos):
    """Parse a literal Lua table of numbers and nested tables at text[pos] == '{'."""
    assert text[pos] == '{'
    pos += 1
    items, keyed = [], {}
    while True:
        while text[pos] in ' \t\r\n,':
            pos += 1
        if text[pos] == '}':
            return (keyed if keyed else items), pos + 1
        key = re.match(r'(\w+)\s*=\s*', text[pos:])
        if key:
            pos += key.end()
        if text[pos] == '{':
            value, pos = parse_lua_table(text, pos)
        else:
            number = re.match(r'-?\d+(?:\.\d+)?', text[pos:])
            if not number:
                raise ValueError(f'Unsupported Lua value near: {text[pos:pos + 30]!r}')
            value, pos = float(number[0]), pos + number.end()
        if key:
            keyed[key[1]] = value
        else:
            items.append(value)


def read_ocean_minimap_tuning(scripts):
    source = (scripts / 'tuning.lua').read_text()
    source = re.sub(r'--[^\n]*', '', source)
    start = source.index('OCEAN_MINIMAP_SHADER')
    return parse_lua_table(source, source.index('{', start))[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    package = Path(__file__).resolve().parent.parent
    scripts = args.source / 'databundles/scripts_unpacked/scripts'
    definitions = {}
    assets = set()
    read_tiles = runpy.run_path(str(Path(__file__).with_name('turf-source.py')))['read_tiles']
    for tile in read_tiles(scripts):
        if not tile['turf'] and tile['name'] not in {'DIRT', 'FARMING_SOIL', 'OCEAN_COASTAL', 'MONKEY_DOCK'}:
            continue
        ground = tile['ground']
        name = ground['name']
        noise = ground['noise_texture']
        atlas_name = ground.get('atlas', name)
        texture_path = f'levels/tiles/{name}.tex'
        atlas_path = f'levels/tiles/{atlas_name}.xml'
        noise_path = noise if (args.source / noise).is_file() else f'levels/textures/{noise}.tex'
        # Verify source atlas variants instead of assuming numbered rectangles.
        elements = ET.fromstring((args.source / atlas_path).read_text()).find('Elements')
        if {element.attrib['name'] for element in elements} != {f'{n:02}' for n in range(1, 49)}:
            raise ValueError(f'Unexpected ground tile variants: {atlas_path}')
        # tilemanager.lua ValidateMinimapTileDef: atlas and texture from `name`, noise from `noise_texture`.
        mini = tile['minimap']
        mini_noise = mini['noise_texture']
        mini_atlas_path = f'levels/tiles/{mini.get("atlas", mini["name"])}.xml'
        mini_texture_path = f'levels/tiles/{mini["name"]}.tex'
        mini_noise_path = mini_noise if (args.source / mini_noise).is_file() else f'levels/textures/{mini_noise}.tex'
        mini_elements = ET.fromstring((args.source / mini_atlas_path).read_text()).find('Elements')
        if {element.attrib['name'] for element in mini_elements} != {f'{n:02}' for n in range(1, 49)}:
            raise ValueError(f'Unexpected minimap tile variants: {mini_atlas_path}')
        definitions[tile['name']] = {
            'tileId': tile['tileId'], 'plantable': tile['land'] and not tile['hard'],
            'name': name, 'atlas': atlas_path, 'texture': texture_path, 'noise': noise_path,
            'renderOrder': tile['renderOrder'], 'cannotBeDug': ground.get('cannotbedug') == 'true',
            'minimapColour': tile['minimapColour'],
            'minimap': {'atlas': mini_atlas_path, 'texture': mini_texture_path, 'noise': mini_noise_path},
        }
        assets.update([texture_path, atlas_path, noise_path, mini_atlas_path, mini_texture_path, mini_noise_path])
    paper_path = 'images/minimap_paper.tex'  # prefabs/minimap.lua Asset("IMAGE", ...) used by minimapocean.ksh
    assets.add(paper_path)
    outputs = {
        'src/groundTiles.json': definitions,
        'src/minimapOcean.json': {'paper': paper_path, 'tuning': read_ocean_minimap_tuning(scripts)},
    }
    for name, content in outputs.items():
        target = package / name
        serialized = json.dumps(content, indent=2) + '\n'
        if args.check:
            if target.read_text() != serialized:
                raise ValueError(f'{name} is out of date')
        else:
            target.write_text(serialized)
    for relative in sorted(assets):
        data = (args.source / relative).read_bytes()
        target = package.parent.parent / 'public/dst/data' / relative
        if args.check:
            if not target.exists() or target.read_bytes() != data:
                raise ValueError(f'Missing or different asset: {relative}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    print(f'{"Checked" if args.check else "Imported"} {len(definitions)} terrain definitions, {len(assets)} assets')


if __name__ == '__main__':
    main()
