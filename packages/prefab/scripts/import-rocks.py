#!/usr/bin/env python3
"""Mirror source rock, cave hole, pillar, moon fissure, water tree pillar, atrium overgrowth, reeds, malbatross mast, rope bridge, support pillar, oasis lake and hive world art, retaining split animation/build archives and original bytes."""
import argparse
import runpy
import zipfile
from pathlib import Path


ASSETS = {
    'livingtree': ['evergreen_living_wood.zip'],
    'rocks': ['rock.zip', 'rock2.zip', 'rock_flintless.zip', 'rock7.zip', 'moonrock_shell.zip',
              'moonglass_rock.zip', 'moonglass_rock2.zip', 'moonglass_rock3.zip', 'moonglass_rock4.zip'],
    'cave_hole': ['cave_hole.zip'],
    'pillar': ['pillar_ruins.zip', 'pillar_cave.zip', 'pillar_cave_flintless.zip', 'pillar_cave_rock.zip', 'pillar_algae.zip'],
    'atrium_pillar': ['pillar_atrium.zip'],
    'archive_pillar': ['pillar_archive.zip', 'pillar_archive_broken.zip'],
    'vault_pillar': ['pillar_vault_deep.zip'],
    'monkeypillar': ['pillar_monkey.zip'],
    # tentacle_pillar.lua: one archive holds the tentaclepillar bank and the tentacle_pillar build.
    'tentacle_pillar': ['tentacle_pillar.zip'],
    'cavein_boulder': ['cavein_boulder.zip', 'swap_cavein_boulder.zip'],
    'moonrockseed': ['moonrock_seed.zip'],
    'stalagmite': ['rock_stalagmite.zip'],
    'stalagmite_tall': ['rock_stalagmite_tall.zip'],
    # moon_fissure.lua: the fissure's bank and the moon_fissure_fx child's bank.
    'moon_fissure': ['moon_fissure.zip', 'moon_fissure_fx.zip'],
    # watertree_pillar.lua: the bank, its build and the override build all three of its prefabs add.
    'watertree_pillar': ['oceantree_pillar.zip', 'oceantree_pillar_build1.zip', 'oceantree_pillar_build2.zip'],
    # oceantree.lua: one bank and build per growth stage, and MakeEnriched's build.
    'oceantree': ['oceantree_short.zip', 'oceantree_normal.zip', 'oceantree_tall.zip', 'oceantree_tall_jammed_build.zip'],
    # oceantree_pillar.lua: the bank, the build and the override build its four prefabs set.
    'oceantree_pillar': ['oceantree_pillar_small.zip', 'oceantree_pillar_small_build1.zip', 'oceantree_pillar_small_build2.zip'],
    'oceanvine': ['oceanvine.zip'],
    # reeds.lua: the grass bank's archive and the reeds build.
    'reeds': ['grass.zip', 'reeds.zip'],
    # atrium_overgrowth.lua: one archive holds the bank and the build.
    'atrium_overgrowth': ['atrium_overgrowth.zip'],
    # oceanvine_deco.lua: the vine_rainforest_border bank and its waterforest_vines build share one archive.
    'oceanvine_deco': ['waterforest_vines.zip'],
    # mast.lua malbatross_assets: the mast_malbatross bank's three archives and its build; the item's
    # seafarer_mast_malbatross.zip is not ported.
    'mast': ['boat_mast_malbatross_wip.zip', 'boat_mast_malbatross_knots_wip.zip', 'boat_mast_malbatross_opens_wip.zip',
             'boat_mast_malbatross_build.zip'],
    # rope_bridge.lua: rope_bridge_fx, its ropes and the kit share the rope_bridge bank and build.
    'rope_bridge': ['rope_bridge.zip'],
    # support_pillar.lua MakePillar("support_pillar", "support_pillar", "support_pillar"): one archive holds the bank and
    # build; the dreadstone pillar's archive is not ported.
    'support_pillar': ['support_pillar.zip'],
    # oasislake.lua: the oasis_tile bank and build, and splash.zip, which oasislake.lua itself never plays.
    'oasislake': ['oasis_tile.zip', 'splash.zip'],
    # beehive.lua / wasphive.lua: one archive each for the bank and build; snow.zip is mirrored elsewhere.
    'beehive': ['beehive.zip'],
    'wasphive': ['wasphive.zip'],
    # shadow_forge.lua: one archive holds the bank and the build; snow.zip is mirrored elsewhere.
    'shadow_forge': ['shadow_forge.zip'],
    # spiderden.lua: spider_cocoon.zip holds the spider_cocoon bank and build; frozen.zip is mirrored elsewhere.
    'spiderden': ['spider_cocoon.zip'],
    # seastack.lua: water_rock_01.zip holds the water_rock01 bank and the water_rock_01 build.
    'seastack': ['water_rock_01.zip'],
    # lightninggoat.lua: the lightning_goat bank's basic and actions archives, the build and the charged (shocked) build.
    'lightninggoat': ['lightning_goat_basic.zip', 'lightning_goat_actions.zip', 'lightning_goat_build.zip',
                      'lightning_goat_shocked_build.zip'],
}
# skinprefabs.lua: mast_malbatross's PREFAB_SKINS, each a dynamic build with its .dyn atlas package.
SKINS = ['mast_malbatross_tesla', 'mast_malbatross_wagstaff']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    parser.add_argument("--prefab", choices=['livingtree'])
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[3] / 'public/dst/data'
    selected = ASSETS if args.prefab is None else {args.prefab: ASSETS[args.prefab]}
    for prefab, archives in selected.items():
        lua = (args.source / f'databundles/scripts_unpacked/scripts/prefabs/{prefab}.lua').read_text()
        for archive in archives:
            relative = Path('anim') / archive
            # pillar.lua's makeassetlist builds each path from the name its pillar() call passes.
            templated = '"anim/"..name..".zip"' in lua and f'"{relative.stem}"' in lua
            if f'"{relative.as_posix()}"' not in lua and not templated:
                raise ValueError(f'{relative} is not declared by {prefab}.lua')
            data = (args.source / relative).read_bytes()
            output = target / relative
            if args.check:
                if not output.is_file() or output.read_bytes() != data:
                    raise ValueError(f'{output} differs from source')
            else:
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(data)
    if args.prefab == 'livingtree':
        # MakeSnowCoveredPristine and MakeLarge/MediumBurnable reuse these source archives.
        for path in ('anim/snow.zip', 'anim/fire.zip'):
            data = (args.source / path).read_bytes()
            output = target / path
            if args.check:
                if not output.is_file() or output.read_bytes() != data:
                    raise ValueError(f'{output} differs from source')
            else:
                output.write_bytes(data)
        print(f'{"Checked" if args.check else "Imported"} 3 livingtree animation archives')
        return
    skin_lua = (args.source / 'databundles/scripts_unpacked/scripts/prefabs/skinprefabs.lua').read_text()
    with zipfile.ZipFile(args.source / 'databundles/anim_dynamic.zip') as bundle:
        for skin in SKINS:
            if f'CreatePrefabSkin("{skin}",' not in skin_lua:
                raise ValueError(f'{skin} is not a source skin')
            for relative, data in ((Path(f'anim/dynamic/{skin}.zip'), bundle.read(f'anim/dynamic/{skin}.zip')),
                                   (Path(f'anim/dynamic/{skin}.dyn'), (args.source / f'anim/dynamic/{skin}.dyn').read_bytes())):
                output = target / relative
                if args.check:
                    if not output.is_file() or output.read_bytes() != data:
                        raise ValueError(f'{output} differs from source')
                else:
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(data)
    # Audit every source stalagmite and moon glass bank/pose without rendering every prefab ID and rock_type.
    check_clips = runpy.run_path(str(Path(__file__).with_name('static-ground-items.py')))['check_animation_clips']
    art = {f'{bank}/{clip}': {'animationArchive': f'{bank}.zip', 'bank': bank, 'animation': clip}
           for bank, clips in [('cave_hole', ['idle']), ('pillar_ruins', ['idle', 'hit']), ('rock_stalagmite', ['full', 'med', 'low']),
                               *((bank, ['full', 'med', 'low']) for bank in
                                 ('moonglass_rock', 'moonglass_rock2', 'moonglass_rock3', 'moonglass_rock4')),
                               ('rock_stalagmite_tall', [stage + suffix for stage in ['full', 'med', 'low']
                                                       for suffix in ['_1', '_2']])]
           for clip in clips}
    # Every bank and clip the ported pillars' Lua names. pillar_vault's bank is in an archive of another name.
    art |= {f'{bank}/{clip}': {'animationArchive': f'{bank}.zip', 'bank': bank, 'animation': clip}
            for bank, clips in [*((bank, ['idle'])
                                  for bank in ('pillar_cave', 'pillar_cave_flintless', 'pillar_cave_rock', 'pillar_algae',
                                               'pillar_archive', 'pillar_archive_broken')),
                                ('pillar_atrium', ['idle', 'idle_active']),
                                ('pillar_monkey', [f'idle{id}{move}' for id in range(1, 5) for move in ('', '_move')])]
            for clip in clips}
    art |= {f'pillar_vault/{clip}': {'animationArchive': 'pillar_vault_deep.zip', 'bank': 'pillar_vault', 'animation': clip}
            for clip in ['idle_upper', 'idle_lower', 'idle_upper_capped', 'idle_upper_capped_2', 'idle_upper_broken']}
    # tentacle_pillar.lua: the clips its fn, OnHit, OnEmerge and OnDeath play; hit_hole and idle_hole are the hole's.
    art |= {f'tentaclepillar/{clip}': {'animationArchive': 'tentacle_pillar.zip', 'bank': 'tentaclepillar', 'animation': clip}
            for clip in ['idle', 'hit', 'emerge', 'retract']}
    # moon_fissure.lua fn's loop and delayed_transition's clip, and its moon_fissure_fx child's.
    art |= {f'moon_fissure/{clip}': {'animationArchive': 'moon_fissure.zip', 'bank': 'moon_fissure', 'animation': clip}
            for clip in ['crack_idle', 'transition']}
    art |= {f'moon_fissure_fx/{clip}': {'animationArchive': 'moon_fissure_fx.zip', 'bank': 'moon_fissure_fx', 'animation': clip}
            for clip in ['crack_idle', 'transition']}
    # watertree_pillar.lua: fn's idle loop, and root_ripple / root_shadow of its unported ripples and roots children.
    art |= {f'oceantree_pillar/{clip}': {'animationArchive': 'oceantree_pillar.zip', 'bank': 'oceantree_pillar', 'animation': clip}
            for clip in ['idle', 'root_ripple', 'root_shadow']}
    # oceantree.lua: every stage bank's anims table and its ripples / roots children, each stage's grow clip, and
    # the tall bank's enrichment and pillar clips.
    oceantree_clips = ['sway1_loop', 'sway2_loop', 'chop', 'fallleft', 'fallright', 'stump', 'burning_loop', 'burnt',
                       'chop_burnt', 'idle_chop_burnt', 'root_ripple', 'root_shadow']
    art |= {f'oceantree_{stage}/{clip}': {'animationArchive': f'oceantree_{stage}.zip', 'bank': f'oceantree_{stage}', 'animation': clip}
            for stage, clips in [('short', [*oceantree_clips, 'grow_seed_to_short', 'grow_tall_to_short']),
                                 ('normal', [*oceantree_clips, 'grow_short_to_normal']),
                                 ('tall', [*oceantree_clips, 'grow_normal_to_tall', 'gooped', 'ungooped', 'grow_tall_to_pillar'])]
            for clip in clips}
    # oceantree_pillar.lua: every clip it plays: fn's idle, the ripples' root_ripple, the roots' root_shadow, the leaves'
    # leaf_fall_ground and leaf_fall_water, and those of the unported OnSprout, chop_tree, chop_down_tree and OnBurnt.
    art |= {f'oceantree_pillar_small/{clip}': {'animationArchive': 'oceantree_pillar_small.zip',
                                               'bank': 'oceantree_pillar_small', 'animation': clip}
            for clip in ['idle', 'grow_tall_to_pillar', 'chop', 'fall', 'burnt', 'root_ripple', 'root_shadow',
                         'leaf_fall_ground', 'leaf_fall_water']}
    # oceanvine.lua: every clip it plays.
    art |= {f'oceanvine/{clip}': {'animationArchive': 'oceanvine.zip', 'bank': 'oceanvine', 'animation': clip}
            for clip in ['idle_fruit', 'idle_nofruit', 'fruit_grow', 'harvest', 'spawn', 'burn', 'fall_land', 'fall_ocean']}
    # oceanvine_deco.lua: idle_1..idle_6 by animnum.
    art |= {f'vine_rainforest_border/idle_{n}': {'animationArchive': 'waterforest_vines.zip', 'bank': 'vine_rainforest_border',
                                                 'animation': f'idle_{n}'} for n in range(1, 7)}
    # atrium_overgrowth.lua: fn's only clip.
    art |= {'atrium_overgrowth/idle': {'animationArchive': 'atrium_overgrowth.zip', 'bank': 'atrium_overgrowth', 'animation': 'idle'}}
    # reeds.lua: fn's idle loop and the picking / picked / grow clips of its pickable callbacks.
    art |= {f'grass/{clip}': {'animationArchive': 'grass.zip', 'bank': 'grass', 'animation': clip}
            for clip in ['idle', 'picking', 'picked', 'grow']}
    # mast.lua: every clip the mast_malbatross bank plays: fn's closed, on_hit's open2_hit / open_loop / closed_hit,
    # onbuilt's place, and mast.lua's SailFurled / SailUnfurled / UnfurlSail / OnUpdate knots and opens.
    for archive, clips in [('boat_mast_malbatross_wip.zip', ['closed', 'closed_hit', 'open2_hit', 'place']),
                           ('boat_mast_malbatross_knots_wip.zip', ['knot_tie', 'knot_release']),
                           ('boat_mast_malbatross_opens_wip.zip', ['open_loop', 'open_pre', 'open_pst'])]:
        art |= {f'mast_malbatross/{clip}': {'animationArchive': archive, 'bank': 'mast_malbatross', 'animation': clip} for clip in clips}
    # rope_bridge.lua: every clip rope_bridge_fx and its ropes play, including the unported shake and break branches.
    art |= {f'rope_bridge/{clip}': {'animationArchive': 'rope_bridge.zip', 'bank': 'rope_bridge', 'animation': clip}
            for clip in ['bridge_place', 'bridge_idle', 'bridge_shake', *(f'break_{n}' for n in range(1, 4)),
                         *(f'rope_{state}_{n}' for state in ('place', 'support', 'shake', 'break') for n in range(1, 5))]}
    # support_pillar.lua: every clip of the support_pillar bank, the pillar's levelled idle / hit / quake / repair clips,
    # build and collapse, the scaffold's scaffold / place / scaffold_hit and the debris fx's collapse_top / hit_debris /
    # quake_debris, though only the pillar is ported.
    art |= {f'support_pillar/{clip}': {'animationArchive': 'support_pillar.zip', 'bank': 'support_pillar', 'animation': clip}
            for clip in [*(f'idle{state}{suffix}' for state in ('', '_hit', '_quake', '_repair') for suffix in ('', '_1', '_2', '_3')),
                         'idle_4', 'build', 'collapse', 'scaffold', 'place', 'scaffold_hit', 'collapse_top', 'hit_debris', 'quake_debris']}
    # oasislake.lua: fn's idle, OnIsWetChanged's wet / dry_pre / dry_idle and TryFillLake's dry_pst, and splash.zip's clip.
    art |= {f'oasis_tile/{clip}': {'animationArchive': 'oasis_tile.zip', 'bank': 'oasis_tile', 'animation': clip}
            for clip in ['idle', 'wet', 'dry_pre', 'dry_idle', 'dry_pst']}
    art |= {'splash/splash': {'animationArchive': 'splash.zip', 'bank': 'splash', 'animation': 'splash'}}
    # beehive.lua / wasphive.lua: fn's cocoon_small, OnHit's cocoon_small_hit, OnKilled's cocoon_dead and
    # OnFreeze / OnThaw's frozen / frozen_loop_pst (the wasp hive's bank holds them too, though it never freezes).
    art |= {f'{bank}/{clip}': {'animationArchive': f'{bank}.zip', 'bank': bank, 'animation': clip}
            for bank in ('beehive', 'wasphive')
            for clip in ['cocoon_small', 'cocoon_small_hit', 'cocoon_dead', 'frozen', 'frozen_loop_pst']}
    # SGlightninggoat.lua: every clip its states play, from the basic archive (idle, walk, frozen) and the actions archive.
    art |= {f'lightning_goat/{clip}': {'animationArchive': archive, 'bank': 'lightning_goat', 'animation': clip}
            for archive, clips in [('lightning_goat_basic.zip', ['idle_loop', 'walk_pre', 'walk', 'walk_pst', 'frozen',
                                                                 'frozen_loop_pst']),
                                   ('lightning_goat_actions.zip', ['bleet', 'taunt_pre', 'taunt', 'taunt_pst', 'trans', 'shock',
                                                                   'shock_pst', 'atk', 'hit', 'death', 'death_2', 'sleep_pre',
                                                                   'sleep_loop', 'sleep_pst'])]
            for clip in clips}
    # shadow_forge.lua: every clip of the shadow_forge bank. onhit's PlayAnimation("hit_close") names no clip the bank has
    # (it holds hit_closed), so the audit lists the bank's own clips.
    art |= {f'shadow_forge/{clip}': {'animationArchive': 'shadow_forge.zip', 'bank': 'shadow_forge', 'animation': clip}
            for clip in ['idle', 'place', 'use', 'kit', 'hit_open', 'hit_closed', 'proximity_pre', 'proximity_loop',
                         'proximity_pst']}
    # spiderden.lua: every clip of the spider_cocoon bank, including the unported queen, hit, death, freeze, shave and
    # bedazzle branches.
    art |= {f'spider_cocoon/{clip}': {'animationArchive': 'spider_cocoon.zip', 'bank': 'spider_cocoon', 'animation': clip}
            for clip in ['cocoon_dead', 'cocoon_enter', 'cocoon_large', 'cocoon_large_bedazzled', 'cocoon_large_burst',
                         'cocoon_large_burst_pst', 'cocoon_large_hit', 'cocoon_large_hit_combat', 'cocoon_medium',
                         'cocoon_medium_bedazzled', 'cocoon_medium_hit', 'cocoon_medium_hit_combat', 'cocoon_sleep_loop',
                         'cocoon_small', 'cocoon_small_bedazzled', 'cocoon_small_hit', 'cocoon_small_hit_combat',
                         'frozen_large', 'frozen_loop_pst_large', 'frozen_loop_pst_medium', 'frozen_loop_pst_small',
                         'frozen_medium', 'frozen_small', 'grow_medium_to_large', 'grow_sac_to_small',
                         'grow_small_to_medium', 'shave_large_to_medium', 'shave_medium_to_small']}
    # seastack.lua: every clip of the water_rock01 bank; UpdateArt plays <stackid>_full / _low, and _med is kept although
    # no source sets has_medium_state.
    art |= {f'water_rock01/{clip}': {'animationArchive': 'water_rock_01.zip', 'bank': 'water_rock01', 'animation': clip}
            for clip in [*(f'{stack}_{part}' for stack in range(1, 6) for part in ('emerge', 'full', 'low')),
                         '1_med', '2_med', '4_med', 'hit_fx']}
    check_clips(art, {}, args.source)
    print(f'{"Checked" if args.check else "Imported"} {sum(map(len, ASSETS.values()))} animation/build archives and {len(SKINS)} skin builds')


if __name__ == '__main__':
    main()
