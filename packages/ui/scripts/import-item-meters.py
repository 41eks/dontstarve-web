#!/usr/bin/env python3
"""Mirror the original itemtile.lua meter assets, or verify paths and bytes."""
import argparse
import shutil
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
parser.add_argument('--check', action='store_true')
args = parser.parse_args()
target = Path(__file__).resolve().parents[3] / 'public' / 'dst' / 'data'
for relative in ('anim/spoiled_meter.zip', 'anim/wet_meter.zip'):
    source, output = args.source / relative, target / relative
    if args.check:
        if not output.is_file() or source.read_bytes() != output.read_bytes():
            raise SystemExit(f'Missing or changed item meter: {relative}')
    else:
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, output)
print(f'{"Checked" if args.check else "Imported"} 2 original item meter assets')
