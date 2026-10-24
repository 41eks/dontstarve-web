#!/usr/bin/env python3
"""Mirror Wortox's default living and ghost builds, preserving source bytes."""

import argparse
from pathlib import Path
from zipfile import ZipFile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path,
                        default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    destination = Path(__file__).resolve().parents[3] / 'public/dst/data'
    # skinprefabs.lua wortox_none.skins; ZIP holds build.bin, DYN holds KTEX atlases.
    with ZipFile(args.source / 'databundles/anim_dynamic.zip') as bundle:
        for build in ('wortox', 'ghost_wortox_build'):
            for extension in ('zip', 'dyn'):
                relative = Path(f'anim/dynamic/{build}.{extension}')
                data = (bundle.read(str(relative)) if extension == 'zip'
                        else (args.source / relative).read_bytes())
                target = destination / relative
                if args.check:
                    if not target.is_file() or target.read_bytes() != data:
                        raise ValueError(f'Missing or different source asset: {relative}')
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(data)
    print(f'{"Checked" if args.check else "Imported"} 4 Wortox player art assets')


if __name__ == '__main__':
    main()
