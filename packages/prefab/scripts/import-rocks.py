#!/usr/bin/env python3
"""Mirror source rock, cave hole, pillar, moon fissure and water tree pillar world art, retaining split animation/build archives and original bytes."""
import argparse
import runpy
from pathlib import Path


ASSETS = {
    'rocks': ['rock.zip', 'rock2.zip', 'rock_flintless.zip', 'rock7.zip', 'moonrock_shell.zip',
              'moonglass_rock.zip', 'moonglass_rock2.zip', 'moonglass_rock3.zip', 'moonglass_rock4.zip'],
    'cave_hole': ['cave_hole.zip'],
    'pillar': ['pillar_ruins.zip', 'pillar_cave.zip', 'pillar_cave_flintless.zip', 'pillar_cave_rock.zip', 'pillar_algae.zip'],
    'atrium_pillar': ['pillar_atrium.zip'],
    'archive_pillar': ['pillar_archive.zip', 'pillar_archive_broken.zip'],
    'vault_pillar': ['pillar_vault_deep.zip'],
    'monkeypillar': ['pillar_monkey.zip'],
    'cavein_boulder': ['cavein_boulder.zip', 'swap_cavein_boulder.zip'],
    'moonrockseed': ['moonrock_seed.zip'],
    'stalagmite': ['rock_stalagmite.zip'],
    'stalagmite_tall': ['rock_stalagmite_tall.zip'],
    # moon_fissure.lua also lists moon_fissure_fx.zip, the bank of its unported moon_fissure_fx child.
    'moon_fissure': ['moon_fissure.zip'],
    # watertree_pillar.lua: the bank, its build and the override build all three of its prefabs add.
    'watertree_pillar': ['oceantree_pillar.zip', 'oceantree_pillar_build1.zip', 'oceantree_pillar_build2.zip'],
    # oceantree.lua: one bank and build per growth stage, and MakeEnriched's build.
    'oceantree': ['oceantree_short.zip', 'oceantree_normal.zip', 'oceantree_tall.zip', 'oceantree_tall_jammed_build.zip'],
    # oceantree_pillar.lua: the bank, the build and the override build its four prefabs set.
    'oceantree_pillar': ['oceantree_pillar_small.zip', 'oceantree_pillar_small_build1.zip', 'oceantree_pillar_small_build2.zip'],
    'oceanvine': ['oceanvine.zip'],
    # oceanvine_deco.lua: the vine_rainforest_border bank and its waterforest_vines build share one archive.
    'oceanvine_deco': ['waterforest_vines.zip'],
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    target = Path(__file__).resolve().parents[3] / 'public/dst/data'
    for prefab, archives in ASSETS.items():
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
    # moon_fissure.lua fn's loop and delayed_transition's clip.
    art |= {f'moon_fissure/{clip}': {'animationArchive': 'moon_fissure.zip', 'bank': 'moon_fissure', 'animation': clip}
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
    check_clips(art, {}, args.source)
    print(f'{"Checked" if args.check else "Imported"} {sum(map(len, ASSETS.values()))} animation/build archives')


if __name__ == '__main__':
    main()
