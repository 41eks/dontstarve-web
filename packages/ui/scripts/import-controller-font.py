#!/usr/bin/env python3
"""Mirror the original nested DST controllers font archive, byte for byte."""
import argparse
from pathlib import Path
from zipfile import ZipFile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--check', action='store_true')
parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
args = parser.parse_args()
relative = Path('fonts/controllers.zip')
destination = Path(__file__).resolve().parents[3] / 'public/dst/data' / relative
with ZipFile(args.source / 'databundles/fonts.zip') as archive:
    original = archive.read(relative.as_posix())
if args.check:
    if not destination.exists() or destination.read_bytes() != original:
        raise SystemExit(f'Font archive differs from source: {destination}')
    print('controllers.zip matches original DST asset')
else:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(original)
    print(f'Imported {destination}')
