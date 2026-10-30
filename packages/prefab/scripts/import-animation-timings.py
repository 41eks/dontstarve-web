#!/usr/bin/env python3
"""Import logical animation durations without making gameplay wait for sprite assets."""
import argparse
import json
import pathlib
import struct
import zipfile

ARCHIVES = (
    'mole_basic.zip', 'lightflier.zip', 'bulb_plant_single.zip', 'bulb_plant_springy.zip',
    'bernie.zip', 'bernie_big.zip', 'butterfly_basic.zip',
    'player_idles.zip', 'player_basic.zip', 'player_jump.zip', 'player_actions_item.zip',
    'player_actions_eat.zip', 'player_staff.zip', 'player_actions_bugnet.zip', 'player_actions_pickaxe.zip',
    'player_actions_shovel.zip', 'player_attacks.zip', 'player_actions_till.zip', 'player_actions_axe.zip',
    'player_actions.zip', 'player_slip.zip', 'player_strum.zip', 'player_actions_fishing.zip',
    'player_slurtle_armor.zip', 'wortox_portal.zip', 'player_actions_uniqueitem.zip',
    'player_ghost_withhat.zip', 'player_amulet_resurrect.zip', 'player_emotesxl.zip',
    'player_emotes_dance0.zip', 'player_emotes_sit.zip', 'player_emotes.zip', 'player_emote_extra.zip',
    'book_fx_wicker.zip', 'fx_books.zip', 'broken_tool.zip',
    'mushroom_tree_med.zip', 'mushroom_tree_tall.zip',
)
OUTPUT = pathlib.Path(__file__).resolve().parents[1] / 'src/animationTimings.json'


def timings(path):
    with zipfile.ZipFile(path) as archive:
        data = archive.read('anim.bin')
    if data[:4] != b'ANIM':
        raise ValueError(f'Invalid animation archive: {path}')
    offset = 20

    def read(fmt):
        nonlocal offset
        result = struct.unpack_from('<' + fmt, data, offset)
        offset += struct.calcsize('<' + fmt)
        return result[0] if len(result) == 1 else result

    clips = {}
    for _ in range(read('I')):
        length = read('I')
        name = data[offset:offset + length].decode('utf-8')
        offset += length
        _facing, bank, rate, count = read('BIfI')
        key = f'{bank}:{name}'
        timing = {'name': name, 'bank': bank, 'frameRate': rate, 'frames': count}
        if key in clips and clips[key] != timing:
            raise ValueError(f'Facing-dependent timing in {path}:{name}')
        clips[key] = timing
        for _ in range(count):
            offset += 16
            events = read('I')
            offset += events * 4
            elements = read('I')
            offset += elements * 40
    return list(clips.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=pathlib.Path, default=pathlib.Path('/data/copy/AssetArchive-Dev/data/DST/data'))
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    content = json.dumps({name: timings(args.source_root / 'anim' / name) for name in ARCHIVES}, indent=2) + '\n'
    if args.check:
        if OUTPUT.read_text() != content:
            raise SystemExit('Animation timings differ; rerun import-animation-timings.py')
        print(f'Checked {len(ARCHIVES)} animation timing archives')
    else:
        OUTPUT.write_text(content)


if __name__ == '__main__':
    main()
