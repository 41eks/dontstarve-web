#!/usr/bin/env python3
"""Mirror source rock world art, retaining split animation/build archives and original bytes."""
import argparse
import runpy
from pathlib import Path


ASSETS = {
    'rocks': ['rock.zip', 'rock2.zip', 'rock_flintless.zip', 'rock7.zip', 'moonrock_shell.zip',
              'moonglass_rock.zip', 'moonglass_rock2.zip', 'moonglass_rock3.zip', 'moonglass_rock4.zip'],
    'cavein_boulder': ['cavein_boulder.zip', 'swap_cavein_boulder.zip'],
    'moonrockseed': ['moonrock_seed.zip'],
    'stalagmite': ['rock_stalagmite.zip'],
    'stalagmite_tall': ['rock_stalagmite_tall.zip'],
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
            if f'"{relative.as_posix()}"' not in lua:
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
           for bank, clips in [('rock_stalagmite', ['full', 'med', 'low']),
                               *((bank, ['full', 'med', 'low']) for bank in
                                 ('moonglass_rock', 'moonglass_rock2', 'moonglass_rock3', 'moonglass_rock4')),
                               ('rock_stalagmite_tall', [stage + suffix for stage in ['full', 'med', 'low']
                                                       for suffix in ['_1', '_2']])]
           for clip in clips}
    check_clips(art, {}, args.source)
    print(f'{"Checked" if args.check else "Imported"} {sum(map(len, ASSETS.values()))} rock animation/build archives')


if __name__ == '__main__':
    main()
