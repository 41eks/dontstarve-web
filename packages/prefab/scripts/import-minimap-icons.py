"""Mirror the native minimap icon atlases registered by prefabs/minimap.lua."""
import argparse
from pathlib import Path
import re
import xml.etree.ElementTree as ET


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    lua = (args.source / 'databundles/scripts_unpacked/scripts/prefabs/minimap.lua').read_text()
    atlases = set(re.findall(r'Asset\("ATLAS",\s*"(minimap/minimap_data[12]\.xml)"\)', lua))
    if len(atlases) != 2:
        raise ValueError('Unexpected native minimap icon atlas registrations')
    assets = set(atlases)
    icons = set()
    for relative in atlases:
        atlas = ET.parse(args.source / relative)
        assets.add(str(Path(relative).parent / atlas.find('Texture').attrib['filename']))
        icons.update(element.attrib['name'] for element in atlas.iter('Element'))
    if not {'wilson.png', 'willow.png', 'waxwell.png', 'pigking.png', 'backpack.png',
            'evergreen.png', 'evergreen_stump.png', 'evergreen_burnt.png',
            'tree_leaf.png', 'tree_leaf_stump.png', 'tree_leaf_burnt.png',
            'moon_tree.png', 'moon_tree_stump.png', 'moon_tree_burnt.png',
            'mushtree_moon.png', 'mushroom_tree_med.png', 'mushroom_tree.png', 'mushroom_tree_stump.png'} <= icons:
        raise ValueError('Missing supported native minimap icons')
    destination = Path(__file__).resolve().parents[3] / 'public/dst/data'
    for relative in sorted(assets):
        data = (args.source / relative).read_bytes()
        target = destination / relative
        if args.check:
            if not target.exists() or target.read_bytes() != data:
                raise ValueError(f'Missing or different asset: {relative}')
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    print(f'{"Checked" if args.check else "Imported"} {len(assets)} minimap atlas assets, {len(icons)} icons')


if __name__ == '__main__':
    main()
