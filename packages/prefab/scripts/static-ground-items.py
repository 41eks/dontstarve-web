"""Source art for loose items in the imported cluster; deliberately no gameplay specs."""


def read_static_items(add, items, read):
    preserve_catalog_tags(items, read)
    result = {}

    def art(item, bank, build, clip, source, *, archive=None, tags=(), scale=1, icon=None, loop=False):
        add(item, bank, build, clip, source, animation_archive=archive, icon_name=icon, loop=loop)
        entry = result[item] = items.pop(item)
        entry['tags'] = list(tags)
        if scale != 1:
            entry['scale'] = scale
        return entry

    # Literal constructor values, including split animation/build archives.
    for item, source, bank, build in [
        ('bedroll_straw', 'bedroll', 'swap_bedroll_straw', 'swap_bedroll_straw'),
        ('chum', 'chum', 'chum_pouch', 'chum_pouch'),
        ('cookiecuttershell', 'cookiecuttershell', 'cookiecutter_shell', 'cookiecuttershell'),
        ('coontail', 'coontail', 'coontail', 'coontail'),
        ('driftwood_log', 'driftwood', 'driftwood_log', 'driftwood_log'),
        ('glasscutter', 'glasscutter', 'glasscutter', 'glasscutter'),
        ('glommerflower', 'glommerflower', 'glommer_flower', 'glommer_flower'),
        ('lureplantbulb', 'lureplant_bulb', 'eyeplant_bulb', 'eyeplant_bulb'),
        ('oceanfishingrod', 'oceanfishingrod', 'fishingrod_ocean', 'fishingrod_ocean'),
        ('palmcone_scale', 'palmcone_scale', 'palmcone_scale', 'palmcone_scale'),
        ('palmcone_seed', 'pinecone', 'palmcone_seed', 'palmcone_seed'),
        ('pig_token', 'pig_token', 'pig_token', 'pig_token'),
        ('saltrock', 'saltrock', 'salt', 'salt'),
        ('sewing_kit', 'sewingkit', 'sewing_kit', 'sewing_kit'),
        ('shadowheart', 'shadowheart', 'shadowheart', 'shadowheart'),
        ('shroom_skin', 'shroom_skin', 'shroom_skin', 'shroom_skin'),
        ('sketch', 'sketch', 'blueprint_sketch', 'blueprint_sketch'),
        ('tentaclespike', 'tentaclespike', 'spike', 'tentacle_spike'),
        ('twiggy_nut', 'pinecone', 'twiggy_nut', 'twiggy_nut'),
        ('waxpaper', 'waxpaper', 'wax_paper', 'wax_paper'),
    ]:
        # Read tags in the constructor, excluding callbacks (e.g. thrown NOCLICK).
        text = read(source)
        if source not in ('bedroll', 'pinecone'):
            import re
            start = text.index('local function fn(') if 'local function fn(' in text else text.index('MakeInventoryPhysics(inst)')
            constructor = text[start:text.index('SetPristine', start)]
            tags = re.findall(r'inst:AddTag\("([^"]+)"\)', constructor)
        else:
            tags = ['deployedplant', 'cattoy', 'treeseed'] if source == 'pinecone' else []
        art(item, bank, build, 'idle', source, tags=tags,
            archive='tentacle_spike.zip' if item == 'tentaclespike' else None)

    art('beef_bell', 'cowbell', 'cowbell', 'idle1', 'beef_bell', tags=['bell', 'donotautopick'])
    art('blowdart_pipe', 'blow_dart', 'blow_dart', 'dart_pipe', 'blowdart',
        tags=['blowdart', 'sharp', 'weapon', 'projectile'])
    art('chester_eyebone', 'eyebone', 'chester_eyebone_build', 'idle_loop', 'chester_eyebone',
        archive='chester_eyebone.zip', tags=['chester_eyebone', 'irreplaceable', 'nonpotatable'], loop=True)
    art('hutch_fishbowl', 'fishbowl', 'hutch_fishbowl', 'idle_loop', 'hutch_fishbowl',
        tags=['hutch_fishbowl', 'irreplaceable', 'nonpotatable'], loop=True)
    for number in range(1, 4):
        art(f'deer_antler{number}', 'deer_antler', 'deer_antler', f'idle{number}', 'deer_antler',
            tags=['deerantler', 'klaussackkey'])
    art('dug_berrybush_juicy', 'berrybush_juicy', 'berrybush_juicy', 'dropped', 'plantables', tags=['deployedplant'])
    art('dug_trap_starfish', 'star_trap', 'star_trap', 'inactive', 'trap_starfish', loop=True)
    for colour in ['green', 'orange']:
        art(colour + 'amulet', 'amulets', 'amulets', colour + 'amulet', 'amulet',
            tags=['shadowlevel', 'repairshortaction'] if colour == 'orange' else ['shadowlevel'])
    # staff.lua commonfn computes colour.."staff"..suffix, not the colour alone.
    for item, clip, tags in [('icestaff', 'bluestaff', ['icestaff', 'weapon', 'rangedweapon', 'extinguisher']),
                             ('telestaff', 'purplestaff', ['nopunch'])]:
        art(item, 'staffs', 'staffs', clip, 'staff', tags=tags + ['shadowlevel'])
    art('horrorfuel', 'horrorfuel', 'horrorfuel', 'idle_loop', 'horrorfuel',
        loop=True, tags=['waterproofer', 'purehorror', 'mermbuffcast'])['multColour'] = [1, 1, 1, .5]
    art('lavae_egg', 'lavae_egg', 'lavae_egg', 'idle', 'lavae_egg', scale=.75)
    art('tallbirdegg', 'egg', 'tallbird_egg', 'egg', 'tallbirdegg', tags=['cattoy', 'tallbirdegg', 'cookable'])
    art('messagebottle', 'bottle', 'bottle', 'idle', 'messagebottle', tags=['waterproofer', 'mapspotrevealer'])
    for item in ['oar', 'oar_driftwood', 'malbatross_beak']:
        art(item, item, item, 'idle', 'oar',
            tags=['allow_action_on_impassable'] + (['waterproofer'] if item == 'oar_driftwood' else []))
    for piece in ['bishophead', 'knighthead']:
        art('sculpture_' + piece, 'sculpture_pieces', 'swap_sculpture_' + piece, 'anim', 'sculpture_pieces',
            archive='sculpture_pieces.zip', tags=['irreplaceable', 'nonpotatable', 'heavy'])
    art('spoiled_fish_small', 'spoiled_fish_small', 'spoiled_fish_small', 'idle', 'spoiledfood', scale=1.3,
        tags=['icebox_valid', 'saltbox_valid', 'show_spoiled', 'fertilizerresearchable', 'selfstacker', 'spoiledfood', 'spoiled_fish'])
    art('tacklecontainer', 'tacklecontainer', 'tacklecontainer', 'closed', 'tacklecontainer', tags=['portablestorage'])
    art('terrarium', 'terrarium', 'terrarium', 'idle', 'terrarium', tags=['irreplaceable', 'trader', 'alltrader'])
    art('trap', 'trap', 'trap', 'idle', 'trap', tags=['trap'])
    # The source's INV_IMAGE is misspelled kullkelp_root; this world-only replacement has no usable icon.
    art('bullkelp_beachedroot', 'bullkelp', 'bullkelp', 'dropped_beached', 'bullkelp_beached', icon=False)
    art('bundle', 'bundle', 'bundle', 'idle_small', 'bundle', icon='bundle_small', tags=['bundle', 'unwrappable', 'canpeek'])
    art('hermit_bundle', 'hermit_bundle', 'hermit_bundle', 'idle_onesize', 'bundle', tags=['bundle', 'unwrappable'])
    art('playbill_the_doll', 'playbill', 'playbill', 'idle', 'playbill', icon='playbill', tags=['playbill', 'furnituredecor'])
    # Card icons are replica OverrideImage assets, outside inventoryimages*.xml; no inventory UI is ported here.
    art('playing_card', 'deck_of_cards', 'deck_of_cards', 'single', 'deck_of_cards', icon=False)['ground'] = True
    for octave in [3, 4, 5]:
        art(f'singingshell_octave{octave}', 'singingshell', 'singingshell', 'idle', 'singingshell',
            icon=f'singingshell_octave{octave}_1', tags=['singingshell'])['symbolOverrides'] = {
                'shell_placeholder': {'archive': 'singingshell.zip', 'symbol': f'octave{octave}_1'}}
    # hats.lua simple(): name.."hat", hat_<name>, anim. Only the cluster's ground hats are needed.
    import json
    from pathlib import Path
    hats = json.loads((Path(__file__).resolve().parent.parent / 'src/hats.json').read_text())['hats']
    for item in ['strawhat', 'beefalohat', 'cookiecutterhat', 'dreadstonehat', 'footballhat', 'ruinshat',
                 'mask_ancient_architecthat', 'mask_ancient_handmaidhat', 'mask_ancient_masonhat']:
        hat = hats[item]
        tags = ['hat']
        if item in ['strawhat', 'beefalohat', 'cookiecutterhat', 'footballhat']:
            tags.append('waterproofer')
        elif item == 'dreadstonehat':
            tags.extend(['dreadstone', 'hardarmor', 'shadow_item', 'waterproofer', 'shadowlevel'])
        elif item == 'ruinshat':
            tags.extend(['open_top_hat', 'metal', 'hardarmor', 'shadowlevel'])
        else:
            tags.append('ancient_reader')
        art(item, item, Path(hat['archive']).stem, 'anim', 'hats', tags=tags)
    return result


def preserve_catalog_tags(items, read):
    """The reused ground-art constructors still declare their source tags on static instances."""
    import re
    # These constructors' literal tags apply to every item using that source branch.
    common = set('''acorn axe backpack bathbomb beefalowool blueprint boards boneshard charcoal
        cookingrecipecard cutgrass cutreeds cutstone dragon_scales dreadstone plantables feathers
        fishingrod flint gears glommerfuel pickaxe shovel goldnugget guano gunpowder hammer heatrock
        honey houndstooth inv_rocks_ice mininglantern livinglog log inv_marble moontree_blossom moonglass
        moonrocknugget nightmarefuel nitre panflute papyrus petals_evil pigskin pinecone poop razor
        inv_rocks rope seeds silk spidergland stinger tentaclespots thulecite torch turfs twigs
        pitchfork thulecite_pieces'''.split())
    for item, definition in items.items():
        source = definition['source'].rsplit('/', 1)[1][:-4]
        if source in common:
            text = read(source)
            start = text.index('MakeInventoryPhysics(inst)')
            definition['tags'] = re.findall(r'inst:AddTag\("([^"]+)"\)', text[start:text.index('SetPristine', start)])
        if source == 'amulet':
            definition['tags'] = ['shadowlevel']
        elif source == 'staff':
            definition['tags'] = ([] if item == 'opalstaff' else ['shadowlevel']) + (
                ['firestaff', 'weapon', 'rangedweapon', 'rangedlighter'] if item == 'firestaff' else
                ['nopunch', 'allow_action_on_impassable'] if item in ('yellowstaff', 'opalstaff') else ['nopunch'])
        elif item == 'bird_egg':
            definition['tags'] = ['catfood', 'cookable']
        elif item == 'rottenegg':
            text = read('egg').split('local function rottenfn()', 1)[1]
            definition['tags'] = re.findall(r'inst:AddTag\("([^"]+)"\)', text)
        elif source == 'gem':
            definition['tags'] = ['molebait', 'quakedebris', 'gem']
        elif item == 'carrot':
            definition['tags'] = ['cookable', 'weighable_OVERSIZEDVEGGIES']
        elif item == 'monstermeat':
            definition['tags'] = ['meat', 'dryable', 'lureplant_bait', 'cookable']
        elif item == 'rock_avocado_fruit':
            definition['tags'] = ['molebait', 'quakedebris']
        elif item == 'rock_avocado_fruit_sprout':
            definition['tags'] = ['deployedplant']
        elif item == 'trinket_6':
            definition['tags'] = ['molebait', 'cattoy']


def read_static_variants():
    """Saved visual branches only; there are no timers or component transitions."""
    variants = {item: {f'f{n}': {'animation': f'f{n}'} for n in range(1, 4)}
                for item in ['rocks', 'ice', 'moonglass']}
    variants['blueprint'] = {'rare': {'animationArchive': 'blueprint_rare.zip',
                                     'buildArchives': ['blueprint_rare.zip'], 'bank': 'blueprint_rare'}}
    variants['bundle'] = {size: {'animation': 'idle_' + size} for size in ['small', 'medium', 'large']}
    for octave in [3, 4, 5]:
        variants[f'singingshell_octave{octave}'] = {
            str(n): {'symbolOverrides': {'shell_placeholder': {'archive': 'singingshell.zip', 'symbol': f'octave{octave}_{n}'}}}
            for n in range(1, 4)}
    variants['trap'] = {'full': {'animation': 'trap_loop'}, 'empty': {'animation': 'side'}}
    # Face-up cards restore playingcard:GetID(); no flip action is exposed.
    variants['playing_card'] = {str(suit * 100 + pip): {'symbolOverrides': {
        'swap_card': {'archive': 'deck_of_cards.zip', 'symbol': f'card{suit * 100 + pip}'}}}
        for suit in range(1, 5) for pip in range(1, 14)}
    return variants


def check_animation_clips(items, variants, source):
    """Audit bank/clip references without constructing sprites or rendering cosmetic variants."""
    import struct
    import zipfile
    cache = {}

    def bank_hash(name):
        value = 0
        for char in name.lower():
            value = (value * 65599 + ord(char)) & 0xffffffff
        return value

    def clips(archive):
        if archive in cache:
            return cache[archive]
        with zipfile.ZipFile(source / 'anim' / archive) as package:
            data = package.read('anim.bin')
        if data[:4] != b'ANIM':
            raise ValueError(f'Invalid animation archive: {archive}')
        offset, result = 20, set()

        def u32():
            nonlocal offset
            value = struct.unpack_from('<I', data, offset)[0]
            offset += 4
            return value

        for _ in range(u32()):
            length = u32()
            name = data[offset:offset + length].decode()
            offset += length + 1  # name followed by one-byte facing mask
            bank = u32()
            offset += 4  # frame rate
            frame_count = u32()
            if frame_count:
                result.add((bank, name))
            for _ in range(frame_count):
                offset += 16  # frame bounds
                event_count = u32()
                offset += event_count * 4
                element_count = u32()
                offset += element_count * 40
        cache[archive] = result
        return result

    errors = []
    for item, definition in items.items():
        for variant, art in [('default', definition), *[(name, definition | override) for name, override in variants.get(item, {}).items()]]:
            available = set().union(*(clips(archive) for archive in [art['animationArchive'], *art.get('extraAnimationArchives', [])]))
            if (bank_hash(art['bank']), art['animation']) not in available:
                errors.append(f'{item}/{variant}: {art["animationArchive"]} missing {art["bank"]}:{art["animation"]}')
    if errors:
        raise ValueError('\n'.join(errors))
