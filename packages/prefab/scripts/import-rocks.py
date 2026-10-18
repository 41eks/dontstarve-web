#!/usr/bin/env python3
"""Mirror source rock world art, retaining split animation/build archives and original bytes."""
import argparse
from pathlib import Path


ASSETS = {
    'rocks': ['rock.zip', 'rock2.zip', 'rock_flintless.zip', 'rock7.zip', 'moonrock_shell.zip'],
    'cavein_boulder': ['cavein_boulder.zip', 'swap_cavein_boulder.zip'],
    'moonrockseed': ['moonrock_seed.zip'],
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
    print(f'{"Checked" if args.check else "Imported"} {sum(map(len, ASSETS.values()))} rock animation/build archives')


if __name__ == '__main__':
    main()
