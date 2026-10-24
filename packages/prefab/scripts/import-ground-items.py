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
petals petals_evil ash beefalowool boneshard butterflywings butter honey honeycomb
thulecite thulecite_pieces guano tentaclespots spidergland slurtleslime
slurtle_shellpieces walrus_tusk deerclops_eyeball bearger_fur dragon_scales
glommerfuel acorn marblebean dreadstone wagpunk_bits moonrocknugget dock_kit papyrus featherpencil
foliage beardhair cookingrecipecard scrapbook_page blueprint'''.split()


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

    # turfs.lua constructs every item from tiledefs.lua's sixth AddTile argument.
    read_tiles = runpy.run_path(str(Path(__file__).with_name('turf-source.py')))['read_tiles']

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
        source_text = read(source)
        if 'AddTag("molebait")' in source_text and 'AddComponent("bait")' in source_text:
            if source != 'rock_avocado_fruit' or item in ('rock_avocado_fruit', 'rock_avocado_fruit_ripe'):
                definition['moleBait'] = True
        if 'foodtype = FOODTYPE.ELEMENTAL' in source_text and (source != 'rock_avocado_fruit' or item == 'rock_avocado_fruit'):
            hunger = re.search(r'edible.hungervalue\s*=\s*(\d+(?:\.\d+)?)', source_text)
            definition['elementalFoodHunger'] = float(hunger[1]) if hunger else 10
        items[item] = definition
        assets.update('anim/' + path for path in [animation_archive, *builds])

    for tile in read_tiles(scripts):
        turf = tile['turf']
        if not turf:
            continue
        bank_build = turf.get('bank_build', 'turf')
        add('turf_' + turf['name'], turf.get('bank_override', bank_build),
            turf.get('build_override', bank_build), turf.get('anim', turf['name']), 'turfs',
            animation_archive=turf.get('animzip_override', bank_build) + '.zip',
            icon_name='turf_' + turf.get('invicon_override', turf['name']))
        items['turf_' + turf['name']]['groundTile'] = tile['name']

    # These constructors have literal bank/build/clip values before SetPristine.
    for item in SIMPLE:
        source = read(item)
        constructor = source[source.index('MakeInventoryPhysics(inst)'):]
        constructor = constructor[:constructor.index('SetPristine')]
        bank = re.search(r'SetBank\("([^"]+)"\)', constructor)[1]
        build = re.search(r'SetBuild\("([^"]+)"\)', constructor)[1]
        clip = re.search(r'PlayAnimation\("([^"]+)"(?:,\s*(true|false))?\)', constructor)
        add(item, bank, build, clip[1], item, loop=clip[2] == 'true' or item == 'nightmarefuel')
        # cookingrecipecard.lua names each card after a random recipe; without one the name keeps no placeholder.
        if item == 'cookingrecipecard':
            items[item]['name'] = items[item]['name'].replace('{item}', '')
        # Preserve source render settings separately from the texture's alpha.
        mult_colour = re.search(r'SetMultColour\(([^)]+)\)', constructor)
        if mult_colour:
            values = [float(value.strip()) for value in mult_colour[1].split(',')]
            if len(values) != 4:
                raise ValueError(f'Invalid SetMultColour for {item}')
            items[item]['multColour'] = values
        point_filtering = re.search(r'UsePointFiltering\((true|false)\)', constructor)
        if point_filtering:
            items[item]['pointFiltering'] = point_filtering[1] == 'true'

    # Shared constructors use arguments or select an idle pose after SetPristine.
    add('rocks', 'rocks', 'rocks', 'f1', 'inv_rocks')
    add('ice', 'ice', 'ice', 'f1', 'inv_rocks_ice')
    add('marble', 'marble', 'marble', 'anim', 'inv_marble')
    # heatrock.lua initializes UpdateImages(inst, 3); the five source images
    # belong to one nonstackable prefab, not five inventory item IDs.
    heatrock_lua = read('heatrock')
    heatrock_range = re.search(r'UpdateImages\(inst, (\d)\)', heatrock_lua)[1]
    add('heatrock', 'heat_rock', 'heat_rock', heatrock_range, 'heatrock',
        loop=True, icon_name='heat_rock' + heatrock_range)
    items['heatrock']['inventoryImageVariants'] = {}

    def heatrock_images(prefix):
        for range_ in range(1, 6):
            icon = prefix + str(range_) + '.tex'
            if icon not in icons:
                raise ValueError(f'No inventory icon for {icon}')
            items['heatrock']['inventoryImageVariants'][icon] = {'icon': icon, 'atlas': icons[icon]}

    heatrock_images('heat_rock')
    # razor.lua: bank razor from razor.zip with the swap_razor build; the cursor-held shaver has no equipped art.
    add('razor', 'razor', 'swap_razor', 'idle', 'razor', animation_archive='razor.zip')
    # panflute.lua: bank/build pan_flute from pan_flute.zip; SGwilson's play_flute overrides pan_flute01 from the same build.
    add('panflute', 'pan_flute', 'pan_flute', 'idle', 'panflute', animation_archive='pan_flute.zip')
    # moonbutterfly.lua uses the butterfly bank from butterfly_basic.zip with its own build.
    add('moonbutterfly', 'butterfly', 'butterfly_moon', 'idle', 'moonbutterfly', animation_archive='butterfly_basic.zip', loop=True)
    add('moonbutterflywings', 'moonbutterfly_wings', 'moonbutterfly_wings', 'idle', 'moonbutterflywings')
    # moontree_blossom.lua: the loot of chopped moon trees.
    add('moon_tree_blossom', 'moon_tree_petal', 'moon_tree_petal', 'idle', 'moontree_blossom')
    # axe.lua: held swap builds, player_actions_axe's chop clips, and moontree.lua's chop petals.
    assets.update('anim/' + name + '.zip' for name in ['swap_axe', 'swap_goldenaxe', 'swap_glassaxe', 'player_actions_axe', 'tree_petal_fx', 'moon_tree'])
    # evergreens.lua normal build: split short/normal and tall/old banks, plus pine_needles_chop.
    assets.update('anim/' + name + '.zip' for name in ['evergreen_new', 'evergreen_short_normal', 'evergreen_tall_old', 'pine_needles'])
    # deciduoustrees.lua / fx.lua: trunk, three size banks, seasonal swap_leaves builds and leaf FX.
    assets.update('anim/' + name + '.zip' for name in [
        'tree_leaf_trunk_build', 'tree_leaf_short', 'tree_leaf_normal', 'tree_leaf_tall',
        *['tree_leaf_' + colour + '_build' for colour in ['green', 'red', 'orange', 'yellow']],
        *['tree_leaf_fx_' + colour for colour in ['green', 'red', 'orange', 'yellow']],
    ])
    # sculptingtable.lua: the station's cutstone01 symbol is replaced by the marble/cutstone builds.
    assets.add('anim/sculpting_station.zip')
    # lava_pond.lua: ground-oriented pool plus separately sorted scorched rock children.
    assets.update(['anim/lava_tile.zip', 'anim/scorched_rock.zip'])
    # trinkets.lua MakeTrinket: bank/build `trinkets` from trinkets.zip, one numbered clip per trinket.
    num_trinkets = int(re.search(r'NUM_TRINKETS\s*=\s*(\d+)', (scripts / 'constants.lua').read_text())[1])
    for number in range(1, num_trinkets + 1):
        add(f'trinket_{number}', 'trinkets', 'trinkets', str(number), 'trinkets', animation_archive='trinkets.zip')
    # blueprint.lua: a rare blueprint switches to bank/build blueprint_rare and the blueprint_rare inventory image.
    assets.add('anim/blueprint_rare.zip')
    if 'blueprint_rare.tex' not in icons:
        raise ValueError('No inventory icon for blueprint_rare')
    items['blueprint']['inventoryImageVariants'] = {'blueprint_rare.tex': {'icon': 'blueprint_rare.tex', 'atlas': icons['blueprint_rare.tex']}}
    # hotspring.lua: crater_pool bank/build; bathbomb.lua: bath_bomb bank/build, the item that lights it.
    assets.add('anim/crater_pool.zip')
    add('bathbomb', 'bath_bomb', 'bath_bomb', 'idle', 'bathbomb')
    # tumbleweed.lua: four-faced bank/build tumbleweed (move_pre/move_loop/move_pst/idle) and the break fx.
    assets.add('anim/tumbleweed.zip')
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
    # poop.lua spawns flies as a NOCLICK/DECOR child, not as an inventory item.
    assets.add('anim/flies.zip')
    add('spoiled_food', 'spoiled', 'spoiled_food', 'idle', 'spoiledfood')
    # gunpowder.lua ground art; explode_small.lua plays anim/explode.zip (bank/build explode, clip small) as its fx.
    add('gunpowder', 'gunpowder', 'gunpowder', 'idle', 'gunpowder')
    # fence.lua MakeInvItem: bank/build `fence`, clip `inventory`. The placed `fence` uses bank `fence` (wide) and
    # `fence_thin` (narrow) with build `fence`.
    add('fence_item', 'fence', 'fence', 'inventory', 'fence')
    assets.add('anim/fence_thin.zip')
    assets.add('anim/explode.zip')
    for colour in ['red', 'blue', 'purple', 'green', 'orange', 'yellow']:
        add(colour + 'gem', 'gems', 'gems', colour + 'gem_idle', 'gem', loop=True)
    add('opalpreciousgem', 'gems', 'gems', 'opalgem_idle', 'gem', loop=True)
    for colour in ['crow', 'robin', 'robin_winter', 'canary']:
        item = 'feather_' + colour
        add(item, item, item, 'idle', 'feathers')

    # birds.lua makebird: a dropped bird shows SGbird's stunned_loop pose (crow bank, <name>_build).
    for item in ['crow', 'robin', 'robin_winter', 'canary']:
        add(item, 'crow', item + '_build', 'stunned_loop', 'birds', animation_archive='crow.zip', loop=True)
        # The shared crow bank animates bird_gem for the rift-possessed birds; plain birds' builds have no such symbol.
        items[item]['hiddenSymbols'] = ['bird_gem']
    # egg.lua: bird_egg and rottenegg share the birdegg bank and bird_eggs build; birdcage.lua lays them.
    add('bird_egg', 'birdegg', 'bird_eggs', 'idle', 'egg')
    add('rottenegg', 'birdegg', 'bird_eggs', 'rotten', 'egg')

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
    # plantables.lua: dug grass uses the grass bank, grass1 build and dropped pose.
    add('rock_avocado_fruit', 'rock_avo_fruit_master', 'rock_avocado_fruit_build', 'idle', 'rock_avocado_fruit', animation_archive='rock_avocado_fruit.zip', icon_name='rock_avocado_fruit_rockhard')
    for item, clip in [('rock_avocado_fruit_ripe', 'idle_split_open'), ('rock_avocado_fruit_ripe_cooked', 'cooked'), ('rock_avocado_fruit_sprout', 'idle_seed')]:
        add(item, 'rock_avo_fruit_master', 'rock_avocado_fruit_build', clip, 'rock_avocado_fruit', animation_archive='rock_avocado_fruit.zip')
    add('dug_rock_avocado_bush', 'rock_avocado', 'rock_avocado_build', 'dropped', 'plantables', animation_archive='rock_avocado.zip')
    add('dug_berrybush', 'berrybush', 'berrybush', 'dropped', 'plantables')
    assets.add('anim/snow.zip')
    add('dug_monkeytail', 'grass', 'reeds_monkeytails', 'dropped', 'plantables', animation_archive='grass.zip')
    add('dug_grass', 'grass', 'grass1', 'dropped', 'plantables', animation_archive='grass.zip')
    # plantables.lua: dug saplings use their own bank/build and dropped pose.
    for item in ['sapling', 'sapling_moon']:
        add('dug_' + item, item, item, 'dropped', 'plantables')
    assets.add('anim/mole_move_fx.zip')

    # mole.lua uses a split animation bank/build; the live prefab selects SGmole clips.
    add('mole', 'mole', 'mole_build', 'idle_under', 'mole', animation_archive='mole_basic.zip', loop=True)

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
    add('greenstaff', 'staffs', 'staffs', 'greenstaff', 'staff')
    # staff.lua commonfn: anim = colour .. 'staff'; red is registered as `firestaff`.
    add('firestaff', 'staffs', 'staffs', 'redstaff', 'staff')
    assets.update(['anim/swap_staffs.zip', 'anim/player_staff.zip', 'anim/star_hot.zip', 'anim/star_cold.zip', 'anim/moonbase_fx.zip'])
    # trident.lua: ground bank/build trident from trident.zip, held swap_trident; SGwilson play_strum uses player_strum.zip.
    # fx.lua crab_king_waterspout (bank Bubble_fx) is the spell's water-column fx.
    add('trident', 'trident', 'trident', 'idle', 'trident')
    assets.update(['anim/swap_trident.zip', 'anim/player_strum.zip', 'anim/crab_king_bubble_fx.zip'])
    # reskin_tool.lua uses its idle ground pose and a separate held build.
    add('reskin_tool', 'reskin_tool', 'reskin_tool', 'idle', 'reskin_tool')
    assets.add('anim/swap_reskin_tool.zip')
    assets.update(['anim/reskin_tool_fx.zip', 'anim/player_attacks.zip'])
    # books.lua MakeBook: bank/build books with PlayAnimation(def.name). SGwilson's
    # book/book2 states use player_actions_uniqueitem, swap_books symbols, book_fx
    # (book_fx_wicker) and the def.fx_under roots from fx_books.
    add('book_silviculture', 'books', 'books', 'book_silviculture', 'books')
    # fx.lua fx_book_rain is spawned by components/book.lua at the reader on a successful read.
    add('book_rain', 'books', 'books', 'book_rain', 'books')
    # fx.lua fx_book_moon: bank/build fx_book_moon, play_fx.
    add('book_moon', 'books', 'books', 'book_moon', 'books')
    assets.update(['anim/player_actions_uniqueitem.zip', 'anim/swap_books.zip',
                   'anim/book_fx_wicker.zip', 'anim/fx_books.zip', 'anim/fx_book_rain.zip', 'anim/fx_book_moon.zip'])
    add('hammer', 'hammer', 'swap_hammer', 'idle', 'hammer', animation_archive='hammer.zip')
    # nightsword.lua: ground nightmaresword bank/build; equip uses swap_nightmaresword.
    add('nightsword', 'nightmaresword', 'nightmaresword', 'idle', 'nightsword')
    assets.add('anim/swap_nightmaresword.zip')
    # armor_snurtleshell.lua: ground and worn art share armor_slurtleshell (swap_body_tall);
    # SGwilson's shell states use the hideshell/hitshell clips from player_slurtle_armor.
    add('armorsnurtleshell', 'armor_slurtleshell', 'armor_slurtleshell', 'anim', 'armor_snurtleshell')
    assets.add('anim/player_slurtle_armor.zip')
    # amulet.lua: the red amulet's ground pose is amulets/redamulet; worn art is torso_amulets' redamulet swap_body symbol.
    # SGwilson's amulet_rebirth overrides FX from player_amulet_resurrect.
    add('amulet', 'amulets', 'amulets', 'redamulet', 'amulet', icon_name='amulet')
    assets.update(['anim/torso_amulets.zip', 'anim/player_amulet_resurrect.zip'])
    add('bugnet', 'bugnet', 'swap_bugnet', 'idle', 'bugnet', animation_archive='bugnet.zip')
    assets.add('anim/player_actions_bugnet.zip')
    # fishingrod.lua: ground idle from fishingrod, held swap_fishingrod; SGwilson fishing states use player_actions_fishing.
    add('fishingrod', 'fishingrod', 'fishingrod', 'idle', 'fishingrod')
    # catchfish swaps the landed fish's build (pondfish: fish01) into the fish01 symbol.
    assets.update(['anim/swap_fishingrod.zip', 'anim/player_actions_fishing.zip', 'anim/fish01.zip'])
    # burnable structure FX from fire.lua; LIGHT uses player_actions_item.zip.
    assets.add('anim/fire.zip')
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

    # pondfish.lua commonfn("fish", "fish", ...) plays the one-frame idle; mermhead's deconstruct loot returns it.
    add('pondfish', 'fish', 'fish', 'idle', 'pondfish')

    # veggies.lua uses each vegetable's bank/build with idle and cooked clips.
    for item in re.findall(r'^\s+(\w+)\s*=\s*MakeVegStats\(', read('veggies'), re.M):
        icon = 'quagmire_' + item if item in {'tomato', 'onion'} else item
        add(item, item, item, 'idle', 'veggies', icon_name=icon)
        add(item + '_cooked', item, item, 'cooked', 'veggies', icon_name=icon + '_cooked')

    # veggies.lua fn_seeds: every non-SEEDLESS veggie shares the farm_plant_seeds bank/build and
    # selects its clip by name; farmplantable then sows farm_plant_<name> (farm_plant_defs.lua
    # supplies each plant's bank/build, with farm_soil's soil01 overriding the ground symbol).
    veggies_lua = read('veggies')
    seedless = set(re.findall(r'(\w+)\s*=\s*true', re.search(r'local SEEDLESS =\s*\{(.*?)\}', veggies_lua, re.S)[1]))
    plant_defs = read('farm_plant_defs')
    for item in re.findall(r'^\s+(\w+)\s*=\s*MakeVegStats\(', veggies_lua, re.M):
        if item in seedless:
            continue
        add(item + '_seeds', 'farm_plant_seeds', 'farm_plant_seeds', item, 'veggies')
        entry = re.search(r'PLANT_DEFS\.' + item + r'\s*=\s*\{([^}]*)\}', plant_defs)[1]
        bank = re.search(r'bank\s*=\s*"([^"]+)"', entry)
        build = re.search(r'build\s*=\s*"([^"]+)"', entry)
        assets.update('anim/' + name + '.zip' for name in {(bank or [0, 'farm_plant_' + item])[1], (build or [0, 'farm_plant_' + item])[1]})
    # veggies.lua fn_dried: the dryable table's build is both bank and build, clip dried_<name>.
    entries = list(re.finditer(r'^\s+(\w+)\s*=\s*MakeVegStats\(', veggies_lua, re.M))
    for index, entry in enumerate(entries):
        body = veggies_lua[entry.end():entries[index + 1].start() if index + 1 < len(entries) else len(veggies_lua)]
        dried = re.search(r'\{\s*build = "([^"]+)",\s*hunger', body)
        if dried:
            add(entry[1] + '_dried', dried[1], dried[1], 'dried_' + entry[1], 'veggies')

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
    staff_morph_skins = {}
    skins = read('skinprefabs')
    for match in re.finditer(r'CreatePrefabSkin\("([^"]+)",\s*\{(.*?)\}\)\)', skins, re.S):
        base = re.search(r'base_prefab\s*=\s*"([^"]+)"', match[2])
        if not base or base[1] not in items:
            continue
        override = re.search(r'build_name_override\s*=\s*"([^"]+)"', match[2])
        build = override[1] if override else match[1]
        path = f'dynamic/{build}.zip'
        items[base[1]]['skinArchives'][match[1]] = path
        icon = match[1] + (heatrock_range if base[1] == 'heatrock' else '') + '.tex'
        if base[1] == 'heatrock':
            heatrock_images(match[1])
        if icon not in icons:
            raise ValueError(f'No inventory icon for skin {match[1]}')
        if base[1] == 'yellowstaff':
            granted = re.search(r'granted_items\s*=\s*\{\s*"([^"]+)"', match[2])
            if not granted:
                raise ValueError(f'Missing morph skin for {match[1]}')
            staff_morph_skins[match[1]] = granted[1]
        skin_specs[match[1]] = {'itemId': base[1], 'name': messages.get('STRINGS.SKIN_NAMES.' + match[1], match[1]),
                                 'icon': icon, 'atlas': icons[icon]}
        assets.update(['anim/' + path, 'anim/' + str(Path(path).with_suffix('.dyn'))])

    output = package / 'src/groundItems.json'
    serialized = json.dumps({'items': items, 'skinSpecs': skin_specs, 'staffMorphSkins': staff_morph_skins}, ensure_ascii=False, indent=2) + '\n'
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
