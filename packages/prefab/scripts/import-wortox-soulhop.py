#!/usr/bin/env python3
"""Import and byte-check Wortox soul-hop art and FEV-resolved, unlooped sounds."""
import argparse
from pathlib import Path
import runpy
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    destination = Path(__file__).resolve().parents[3] / 'public/dst/data'
    source_art = args.source / 'anim/wortox_portal.zip'
    target_art = destination / 'anim/wortox_portal.zip'
    if args.check:
        if target_art.read_bytes() != source_art.read_bytes():
            raise ValueError('Different wortox_portal.zip')
    else:
        target_art.write_bytes(source_art.read_bytes())
    parse = runpy.run_path(str(Path(__file__).with_name('fev-events.py')))['parse']
    events = parse(args.source / 'sound/dontstarve.fev')
    # SGwilson portal_jumpin / portal_jumpout; each file_index converts from zero-based FEV to one-based CLI.
    event_paths = ['creatures/together/toad_stool/infection_post', 'characters/wortox/soul/spawn',
                   'characters/wortox/soul/hop_out', 'movement/bodyfall_dirt']
    streams = {(bank, index + 1) for event in event_paths for _, files in events[event]
               for _, bank, index, _ in files}
    with tempfile.TemporaryDirectory(prefix='wortox-audio-') as temporary:
        for bank, index in sorted(streams):
            source = args.source / f'sound/{bank}.fsb'
            subprocess.run(['/usr/bin/vgmstream-cli', '-m', '-s', str(index), str(source)],
                           check=True, stdout=subprocess.DEVNULL)
            decoded = Path(temporary) / f'{bank}.fsb-{index}.wav'
            subprocess.run(['/usr/bin/vgmstream-cli', '-i', '-s', str(index), '-o', str(decoded), str(source)],
                           check=True, stdout=subprocess.DEVNULL)
            data = decoded.read_bytes()
            existing = args.source / f'sound/{bank}.fsb#{index}.wav'
            if existing.is_file() and existing.read_bytes() != data:
                raise ValueError(f'Different existing source WAV: {existing}')
            target = destination / f'sound/{bank}.fsb-{index}.wav'
            if args.check:
                if target.read_bytes() != data:
                    raise ValueError(f'Different exported WAV: {target}')
            else:
                target.write_bytes(data)
    print(f'{"Checked" if args.check else "Imported"} wortox_portal.zip and {len(streams)} FEV-resolved WAVs')


if __name__ == '__main__':
    main()
