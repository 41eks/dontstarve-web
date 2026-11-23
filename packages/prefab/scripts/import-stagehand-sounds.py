#!/usr/bin/env python3
"""Decode the stagehand FEV events and compare the mirrored PCM WAVs byte for byte."""

import argparse
from pathlib import Path
import runpy
import subprocess
from tempfile import TemporaryDirectory

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[3]
DESTINATION = ROOT / 'public/dst/data/sound'
SOURCE = Path('/data/copy/AssetArchive-Dev/data/DST/data/sound')
EVENT = 'creatures/together/stagehand/'
EVENTS = ('hit', 'awake_pre', 'footstep')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    parse = runpy.run_path(str(SCRIPT.with_name('fev-events.py')))['parse']
    definitions = parse(args.source / 'dontstarve.fev')
    streams = sorted({
        (bank, index + 1) for event in EVENTS for _, files in definitions[EVENT + event]
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
            source_wav = args.source / f'{stem}#{index}.wav'
            if source_wav.is_file() and source_wav.read_bytes() != decoded:
                raise SystemExit(f'{source_wav} differs from the decoded stream')
            target = DESTINATION / f'{stem}-{index}.wav'
            if args.check:
                if not target.is_file() or target.read_bytes() != decoded:
                    raise SystemExit(f'{target} differs from the decoded stream')
            else:
                target.write_bytes(decoded)
    print(f'{"Checked" if args.check else "Imported"} {len(streams)} stagehand WAVs')


if __name__ == '__main__':
    main()
