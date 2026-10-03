#!/usr/bin/env python3
"""Import hats.lua inventory/equipment art and recipe metadata, without FX assets."""
import argparse
import json
from pathlib import Path
import re
import zipfile
import xml.etree.ElementTree as ET

OPEN_TOP = {'earmuffs', 'ruins', 'flower', 'goggles', 'eyebrella', 'merm', 'kelp',
            'alterguardian', 'scrap_monocle', 'roseglasses', 'ghostflower'}
FULL_HELM = {'lunarplant', 'voidcloth', 'pumpkin'}
# Some hat bodies are drawn by FollowSymbol in DST. Keep their physical art;
# omit glow, particles, blink effects, lights, sounds and separate FX entities.
FOLLOW = {
    'lunarplant': {'animation': 'idle', 'symbols': ['hat01', 'float_top']},
    'voidcloth': {'animation': 'idle', 'symbols': ['hat01']},
    'wagpunk': {'animation': 'idle'},
    'inspectacles': {'animation': 'off'},
    'rabbit': {'animation': 'idle', 'extraBuilds': ['rabbit_build.zip']},
}


def read_po(path):
    messages = {}
    for block in path.read_text().split('\n\n'):
        fields = {}
        active = None
        for line in block.splitlines():
            match = re.match(r'(msgctxt|msgid|msgstr) (".*")', line)
            if match:
                active = match[1]
                fields[active] = json.loads(match[2], strict=False)
            elif active and line.startswith('"'):
                fields[active] += json.loads(line, strict=False)
        if fields.get('msgctxt'):
            messages[fields['msgctxt']] = fields.get('msgstr') or fields.get('msgid')
    return messages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true', help='Check catalog and mirrored assets without writing')
    args = parser.parse_args()
    package = Path(__file__).resolve().parent.parent
    repo = package.parent.parent
    scripts = args.source / 'databundles/scripts_unpacked/scripts'
    source = (scripts / 'prefabs/hats.lua').read_text()
    names = re.findall(r'MakeHat\("([^"]+)"\)', source[source.rfind('return  MakeHat'):])
    # This NPC-only entity is not an inventory item in this application.
    names = [name for name in names if name != 'shadow_thrall_parasite']
    messages = read_po(scripts / 'languages/chinese_s.po')
    ids = {name + 'hat' for name in names}
    atlas_by_icon = {}
    with zipfile.ZipFile(args.source / 'databundles/images.zip') as images:
        for atlas in sorted(images.namelist()):
            if re.fullmatch(r'images/inventoryimages\d*\.xml', atlas):
                for element in ET.fromstring(images.read(atlas)).iter('Element'):
                    atlas_by_icon.setdefault(element.attrib['name'], atlas)
    hats = {}
    assets = set()
    for name in names:
        item_id = name + 'hat'
        icon = item_id + '.tex'
        if icon not in atlas_by_icon:
            raise ValueError(f'Missing inventory icon: {icon}')
        hat = {
            'name': messages.get('STRINGS.NAMES.' + item_id.upper(), item_id),
            'icon': icon, 'atlas': atlas_by_icon[icon],
            'archive': f'hat_{name}.zip',
            'equip': {
                'mode': 'fullhelm' if name in FULL_HELM else 'opentop' if name in OPEN_TOP else 'normal',
                'symbol': 'swap_hat_large' if name == 'walter' else 'swap_hat_off' if name == 'miner' else 'swap_hat',
            },
            'skinArchives': {}, 'skinEquipModes': {},
        }
        if name in FOLLOW:
            hat['equip']['follow'] = FOLLOW[name]
            assets.update('anim/' + archive for archive in FOLLOW[name].get('extraBuilds', []))
        hats[item_id] = hat
        assets.add('anim/' + hat['archive'])
    skin_specs = {}
    skins = (scripts / 'prefabs/skinprefabs.lua').read_text()
    for match in re.finditer(r'CreatePrefabSkin\("([^"]+)",\s*\{(.*?)\}\)\)', skins, re.S):
        base = re.search(r'base_prefab\s*=\s*"([^"]+)"', match[2])
        if not base or base[1] not in ids:
            continue
        override = re.search(r'build_name_override\s*=\s*"([^"]+)"', match[2])
        build = override[1] if override else match[1]
        archive = f'dynamic/{build}.zip'
        hats[base[1]]['skinArchives'][match[1]] = archive
        if re.search(r'(?:footballhat|wathgrithrhat|wathgrithr_improvedhat|molehat)_init_fn\(inst,\s*"[^"]+",\s*true\)', match[2]):
            hats[base[1]]['skinEquipModes'][match[1]] = 'opentop'
        icon = match[1] + '.tex'
        skin_specs[match[1]] = {
            'itemId': base[1], 'name': messages.get('STRINGS.SKIN_NAMES.' + match[1], match[1]),
            'icon': icon, 'atlas': atlas_by_icon[icon],
        }
        assets.update(['anim/' + archive, 'anim/' + str(Path(archive).with_suffix('.dyn'))])
    recipes = json.loads((repo / 'packages/animation/recipes.json').read_text())['recipes']
    # Drop recipe FX config; keep original tech, character/skill/station restrictions.
    recipes = [{**recipe, 'config': {k: v for k, v in recipe['config'].items() if k not in {'fxover', 'fxunder'}}}
               for recipe in recipes if recipe['config'].get('product', recipe['name']) in ids]
    catalog = {'source': 'databundles/scripts_unpacked/scripts/prefabs/hats.lua', 'hats': hats, 'skinSpecs': skin_specs, 'recipes': recipes}
    serialized = json.dumps(catalog, ensure_ascii=False, indent=2) + '\n'
    output = package / 'src/hats.json'
    if args.check:
        if output.read_text() != serialized:
            raise ValueError('hats.json is out of date')
    else:
        output.write_text(serialized)
    with zipfile.ZipFile(args.source / 'databundles/anim_dynamic.zip') as dynamic:
        for relative in sorted(assets):
            target = repo / 'public/dst/data' / relative
            data = dynamic.read(relative) if relative.startswith('anim/dynamic/') and relative.endswith('.zip') else (args.source / relative).read_bytes()
            if args.check:
                if not target.exists() or target.read_bytes() != data:
                    raise ValueError(f'Missing or different asset: {relative}')
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    print(f'{"Checked" if args.check else "Imported"} {len(hats)} hats, {len(recipes)} source recipes, {len(assets)} animation/build assets')


if __name__ == '__main__':
    main()
