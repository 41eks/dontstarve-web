#!/usr/bin/env python3
"""Mirror PCM audio for the livingtree.lua events from the original FEV and FSB banks."""
import argparse
from pathlib import Path
import runpy
import subprocess
from tempfile import TemporaryDirectory

SCRIPT = Path(__file__).resolve()
DESTINATION = SCRIPT.parents[3] / 'public/dst/data/sound'
SOURCE = Path('/data/copy/AssetArchive-Dev/data/DST/data/sound')
EVENTS = (
    'creatures/leif/livingtree_hit', 'creatures/leif/livingtree_die',
    'characters/woodie/beaver_chop_tree', 'wilson/use_axe_tree',
    'forest/treeCrumble', 'forest/treeFall',
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    parse = runpy.run_path(str(SCRIPT.with_name('fev-events.py')))['parse']
    definitions = parse(args.source / 'dontstarve.fev')
    streams = sorted({
        (bank, index + 1) for event in EVENTS for _, files in definitions[event]
        for _, bank, index, _ in files
    })
    with TemporaryDirectory() as temporary:
        wav = Path(temporary) / 'stream.wav'
        for bank, index in streams:
            stem = f'{bank}.fsb'
            subprocess.run(
                ['/usr/bin/vgmstream-cli', '-i', '-s', str(index), '-o', str(wav), str(args.source / stem)],
                check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
            )
            decoded = wav.read_bytes()
            original = args.source / f'{stem}#{index}.wav'
            if original.is_file() and original.read_bytes() != decoded:
                raise SystemExit(f'{original} differs from its decoded source stream')
            target = DESTINATION / f'{stem}-{index}.wav'
            if args.check:
                if not target.is_file() or target.read_bytes() != decoded:
                    raise SystemExit(f'{target} differs from its decoded source stream')
            elif not target.is_file() or target.read_bytes() != decoded:
                target.write_bytes(decoded)
    print(f'{"Checked" if args.check else "Imported"} {len(streams)} livingtree WAVs')


if __name__ == '__main__':
    main()
