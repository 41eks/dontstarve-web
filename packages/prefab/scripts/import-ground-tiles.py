#!/usr/bin/env python3
"""Mirror tilemanager.lua's ground atlas/noise paths from tiledefs.lua."""
import argparse
import json
from pathlib import Path
import runpy
import xml.etree.ElementTree as ET


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
        if not tile['turf'] and tile['name'] not in {'DIRT', 'FARMING_SOIL'}:
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
        definitions[tile['name']] = {
            'tileId': tile['tileId'],
            'name': name, 'atlas': atlas_path, 'texture': texture_path, 'noise': noise_path,
            'renderOrder': tile['renderOrder'], 'cannotBeDug': ground.get('cannotbedug') == 'true',
        }
        assets.update([texture_path, atlas_path, noise_path])
    target = package / 'src/groundTiles.json'
    serialized = json.dumps(definitions, indent=2) + '\n'
    if args.check:
        if target.read_text() != serialized:
            raise ValueError('groundTiles.json is out of date')
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
