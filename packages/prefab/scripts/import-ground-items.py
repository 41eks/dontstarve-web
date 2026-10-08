#!/usr/bin/env python3
"""Import source ground art for materials, tools and food, preserving DST paths."""
import argparse
import json
from pathlib import Path
import re
import runpy
import zipfile
import xml.etree.ElementTree as ET


SIMPLE = '''cutgrass twigs log cutreeds boards rope cutstone flint goldnugget
gears charcoal pigskin silk stinger houndstooth nitre livinglog nightmarefuel
petals petals_evil ash beefalowool boneshard butterflywings honey honeycomb
thulecite thulecite_pieces guano tentaclespots spidergland slurtleslime
slurtle_shellpieces walrus_tusk deerclops_eyeball bearger_fur dragon_scales
glommerfuel acorn'''.split()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    package = Path(__file__).resolve().parent.parent
    repo = package.parent.parent
    scripts = args.source / 'databundles/scripts_unpacked/scripts'
    read_po = runpy.run_path(str(Path(__file__).with_name('import-hats.py')))['read_po']
    messages = read_po(scripts / 'languages/chinese_s.po')
    icons = {}
    with zipfile.ZipFile(args.source / 'databundles/images.zip') as archive:
        for path in sorted(archive.namelist()):
            if re.fullmatch(r'images/inventoryimages\d*\.xml', path):
                for element in ET.fromstring(archive.read(path)).iter('Element'):
                    icons.setdefault(element.attrib['name'], path)
    items = {}
    assets = set()

    def read(name):
        return (scripts / 'prefabs' / (name + '.lua')).read_text()

    def add(item, bank, build, animation, source, animation_archive=None, overrides=None, loop=False, icon_name=None):
        animation_archive = animation_archive or build + '.zip'
        builds = [build + '.zip']
        for override in (overrides or {}).values():
            if override['archive'] not in builds:
                builds.append(override['archive'])
        icon = (icon_name or item) + '.tex'
        if icon not in icons:
            raise ValueError(f'No inventory icon for {item}')
        definition = {
            'source': 'databundles/scripts_unpacked/scripts/prefabs/' + source + '.lua',
            'name': messages.get('STRINGS.NAMES.' + item.upper(), item),
            'icon': icon, 'atlas': icons[icon],
            'animationArchive': animation_archive, 'buildArchives': builds,
            'bank': bank, 'animation': animation, 'loop': loop,
            'symbolOverrides': overrides or {}, 'skinArchives': {},
        }
        items[item] = definition
        assets.update('anim/' + path for path in [animation_archive, *builds])

    # These constructors have literal bank/build/clip values before SetPristine.
    for item in SIMPLE:
        source = read(item)
        constructor = source[source.index('MakeInventoryPhysics(inst)'):]
        constructor = constructor[:constructor.index('SetPristine')]
        bank = re.search(r'SetBank\("([^"]+)"\)', constructor)[1]
        build = re.search(r'SetBuild\("([^"]+)"\)', constructor)[1]
        clip = re.search(r'PlayAnimation\("([^"]+)"(?:,\s*(true|false))?\)', constructor)
        add(item, bank, build, clip[1], item, loop=clip[2] == 'true' or item == 'nightmarefuel')

    # Shared constructors use arguments or select an idle pose after SetPristine.
    add('rocks', 'rocks', 'rocks', 'f1', 'inv_rocks')
    add('ice', 'ice', 'ice', 'f1', 'inv_rocks_ice')
    add('seeds', 'seeds', 'seeds', 'idle', 'seeds')
    add('seeds_cooked', 'seeds', 'seeds', 'cooked', 'seeds')
    # mushrooms.lua's capcommonfn/cookedcommonfn share mushrooms bank/build;
    # data.animname and data.pickloot select the distinct raw/cooked poses.
    mushroom_data = read('mushrooms').split('local data =', 1)[1]
    mushrooms = re.findall(r'animname\s*=\s*"([^"]+)",\s*pickloot\s*=\s*"([^"]+)"', mushroom_data)
    if len(mushrooms) != 3:
        raise ValueError('Expected the three source mushroom colour definitions')
    for colour, item in mushrooms:
        add(item, 'mushrooms', 'mushrooms', colour + '_cap', 'mushrooms')
        add(item + '_cooked', 'mushrooms', 'mushrooms', item + '_cooked', 'mushrooms')
    add('pinecone', 'pinecone', 'pinecone', 'idle', 'pinecone')
    add('acorn_cooked', 'acorn', 'acorn', 'cooked', 'acorn')
    add('poop', 'poop', 'poop', 'dump', 'poop')
    add('spoiled_food', 'spoiled', 'spoiled_food', 'idle', 'spoiledfood')
    for colour in ['red', 'blue', 'purple', 'green', 'orange', 'yellow']:
        add(colour + 'gem', 'gems', 'gems', colour + 'gem_idle', 'gem', loop=True)
    for colour in ['crow', 'robin', 'robin_winter', 'canary']:
        item = 'feather_' + colour
        add(item, item, item, 'idle', 'feathers')

    # torch.lua and hammer.lua deliberately split their bank and build archives.
    add('torch', 'torch', 'swap_torch', 'idle', 'torch', animation_archive='torch.zip')
    # backpack.lua: world bank backpack1/anim comes from backpack.zip, while
    # both ground and worn swap_body images come from swap_backpack.zip.
    add('backpack', 'backpack1', 'swap_backpack', 'anim', 'backpack', animation_archive='backpack.zip')
    # Inventory Bernie rests in bernie.zip; both animated ground forms share
    # bernie_build.zip, with the large bank supplied by bernie_big.zip.
    add('bernie_inactive', 'bernie', 'bernie_build', 'inactive', 'bernie_inactive', animation_archive='bernie.zip')
    # farm_plow.lua: inventory item is packed; deployed machinery overrides soil01.
    add('farm_plow_item', 'farm_plow', 'farm_plow', 'idle_packed', 'farm_plow')
    assets.update('anim/' + name + '.zip' for name in ['farm_soil', 'farm_soil_debris', 'smoke_puff_small', 'gridplacer'])
    assets.add('anim/bernie_big.zip')
    # mininglantern.lua registers lantern, with separate ground and worn builds.
    add('lantern', 'lantern', 'lantern', 'idle_off', 'mininglantern')
    assets.add('anim/swap_lantern.zip')
    # phonograph.lua and records.lua: source world poses, with independent inventory atlases.
    add('phonograph', 'phonograph', 'phonograph', 'idle', 'phonograph')
    # anim.bin's snow placeholder has no build art; seasonal engine snow is hidden.
    items['phonograph']['hiddenSymbols'] = ['snow']
    assets.add('anim/structure_collapse_fx.zip')
    add('record', 'records', 'records', 'idle', 'records')
    add('lightbulb', 'bulb', 'bulb', 'idle', 'lightbulb')
    # Live butterflies use this bank/build; SGbutterfly selects the flight clips
    # after OnDropped switches the stategraph to idle.
    add('butterfly', 'butterfly', 'butterfly_basic', 'idle', 'butterfly', loop=True)
    # fireflies.lua switches between swarm_pre/loop/pst rather than an item pose.
    add('fireflies', 'fireflies', 'fireflies', 'swarm_loop', 'fireflies', loop=True)
    # butterfly.lua's OnDeploy spawns planted_flower from flower.lua.
    assets.add('anim/flowers.zip')
    # flower_cave.lua and lightflier_flower.lua share these world plant builds.
    assets.update('anim/bulb_plant_' + variant + '.zip' for variant in ['single', 'springy', 'double', 'triple'])
    add('yellowstaff', 'staffs', 'staffs', 'yellowstaff', 'staff')
    add('opalstaff', 'staffs', 'staffs', 'opalstaff', 'staff')
    assets.update(['anim/swap_staffs.zip', 'anim/player_staff.zip', 'anim/star_hot.zip', 'anim/star_cold.zip'])
    # reskin_tool.lua uses its idle ground pose and a separate held build.
    add('reskin_tool', 'reskin_tool', 'reskin_tool', 'idle', 'reskin_tool')
    assets.add('anim/swap_reskin_tool.zip')
    assets.update(['anim/reskin_tool_fx.zip', 'anim/player_attacks.zip'])
    add('hammer', 'hammer', 'swap_hammer', 'idle', 'hammer', animation_archive='hammer.zip')
    add('bugnet', 'bugnet', 'swap_bugnet', 'idle', 'bugnet', animation_archive='bugnet.zip')
    assets.add('anim/player_actions_bugnet.zip')
    # pitchfork.lua: idle ground bank/build and separate held swap symbols.
    for item in ['pitchfork', 'goldenpitchfork']:
        add(item, item, item, 'idle', 'pitchfork')
        assets.add('anim/swap_' + item + '.zip')
    assets.add('anim/player_actions_shovel.zip')
    # farm_hoe.lua: ground builds differ from the golden held swap build.
    add('farm_hoe', 'quagmire_hoe', 'quagmire_hoe', 'idle', 'farm_hoe')
    add('golden_farm_hoe', 'goldenhoe', 'goldenhoe', 'idle', 'farm_hoe')
    assets.update(['anim/swap_goldenhoe.zip', 'anim/player_actions_till.zip'])
    assets.add('levels/textures/Ground_noise_dirt.tex')
    for item in ['axe', 'goldenaxe', 'pickaxe', 'goldenpickaxe', 'shovel', 'goldenshovel']:
        source = 'pickaxe' if 'pickaxe' in item else 'shovel' if 'shovel' in item else 'axe'
        add(item, item, item, 'idle', source)
    # shovel.lua's worn symbols come from swap builds, independently of idle art.
    assets.update(['anim/swap_shovel.zip', 'anim/swap_goldenshovel.zip'])
    add('moonglassaxe', 'glassaxe', 'glassaxe', 'idle', 'axe')
    # walls.lua gives every wall item the shared wall bank and its own build.
    # wall_stone_2_item and wall_ruins_2_item ship no inventory icon in DST.
    for item, bank, animation_archive in [
        ('wall_stone_item', 'wall', 'wall.zip'),
        ('wall_wood_item', 'wall', 'wall.zip'),
        ('wall_hay_item', 'wall', 'wall.zip'),
        ('wall_ruins_item', 'wall', 'wall.zip'),
        ('wall_moonrock_item', 'wall', 'wall.zip'),
        ('wall_scrap_item', 'wall', 'wall.zip'),
        ('wall_dreadstone_item', 'wall_dreadstone', 'wall_dreadstone.zip'),
    ]:
        add(item, bank, item.removesuffix('_item'), 'idle', 'walls', animation_archive=animation_archive)

    # meats.lua passes bank/build/animation to common() for every edible form.
    meat_source = read('meats')
    constructors = {}
    for match in re.finditer(r'local function (\w+)\(\)\n(.*?)(?=\nlocal function|\nreturn Prefab)', meat_source, re.S):
        common = re.search(r'common\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"', match[2])
        if common:
            constructors[match[1]] = common.groups()
    for item, constructor in re.findall(r'Prefab\("([^"]+)",\s*(\w+)', meat_source):
        if constructor in constructors and not item.startswith('quagmire_'):
            add(item, *constructors[constructor], 'meats')

    # veggies.lua uses each vegetable's bank/build with idle and cooked clips.
    for item in re.findall(r'^\s+(\w+)\s*=\s*MakeVegStats\(', read('veggies'), re.M):
        icon = 'quagmire_' + item if item in {'tomato', 'onion'} else item
        add(item, item, item, 'idle', 'veggies', icon_name=icon)
        add(item + '_cooked', item, item, 'cooked', 'veggies', icon_name=icon + '_cooked')

    # preparedfoods.lua overrides swap_food; later foods use additional builds.
    foods = (scripts / 'preparedfoods.lua').read_text()
    entries = list(re.finditer(r'^(?:\t| {4})(\w+)\s*=\s*\n(?:\t| {4})\{', foods, re.M))
    for index, entry in enumerate(entries):
        body = foods[entry.end():entries[index + 1].start() if index + 1 < len(entries) else len(foods)]
        override = re.search(r'overridebuild\s*=\s*"([^"]+)"', body)
        basename = re.search(r'basename\s*=\s*"([^"]+)"', body)
        build = override[1] if override else 'cook_pot_food'
        add(entry[1], 'cook_pot_food', build, 'idle', 'preparedfoods',
            animation_archive='cook_pot_food.zip',
            overrides={'swap_food': {'archive': build + '.zip', 'symbol': basename[1] if basename else entry[1]}})

    # Skin builds replace matching symbols while the original bank keeps its pose.
    skin_specs = {}
    skins = read('skinprefabs')
    for match in re.finditer(r'CreatePrefabSkin\("([^"]+)",\s*\{(.*?)\}\)\)', skins, re.S):
        base = re.search(r'base_prefab\s*=\s*"([^"]+)"', match[2])
        if not base or base[1] not in items:
            continue
        override = re.search(r'build_name_override\s*=\s*"([^"]+)"', match[2])
        build = override[1] if override else match[1]
        path = f'dynamic/{build}.zip'
        items[base[1]]['skinArchives'][match[1]] = path
        icon = match[1] + '.tex'
        if icon not in icons:
            raise ValueError(f'No inventory icon for skin {match[1]}')
        skin_specs[match[1]] = {'itemId': base[1], 'name': messages.get('STRINGS.SKIN_NAMES.' + match[1], match[1]),
                                 'icon': icon, 'atlas': icons[icon]}
        assets.update(['anim/' + path, 'anim/' + str(Path(path).with_suffix('.dyn'))])

    output = package / 'src/groundItems.json'
    serialized = json.dumps({'items': items, 'skinSpecs': skin_specs}, ensure_ascii=False, indent=2) + '\n'
    if args.check:
        if output.read_text() != serialized:
            raise ValueError('groundItems.json is out of date')
    else:
        output.write_text(serialized)
    with zipfile.ZipFile(args.source / 'databundles/anim_dynamic.zip') as dynamic:
        for relative in sorted(assets):
            data = dynamic.read(relative) if relative.startswith('anim/dynamic/') and relative.endswith('.zip') else (args.source / relative).read_bytes()
            target = repo / 'public/dst/data' / relative
            if args.check:
                if not target.exists() or target.read_bytes() != data:
                    raise ValueError(f'Missing or different asset: {relative}')
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
    print(f'{"Checked" if args.check else "Imported"} {len(items)} ground items, {len(skin_specs)} skins, {len(assets)} assets')


if __name__ == '__main__':
    main()
