#!/usr/bin/env python3
"""Mirror DST building archives, skin build archives and their companion atlas packages.

--check compares every mirrored file byte for byte and audits the clips of the banks listed in BANK_CLIPS.
"""

import argparse
import json
from pathlib import Path
import struct
import sys
import zipfile

SKINNED_PREFABS = ["cookpot", "researchlab", "researchlab2", "researchlab3", "researchlab4", "sculptingtable", "winterometer", "lightning_rod", "birdcage", "moondial", "bookstation", "dragonflyfurnace", "wood_chair"]
# Buildings whose base Asset("ANIM", ...) archives this script mirrors from data/anim, by prefab.
BASE_ARCHIVES = {
    # furniture_chairs.lua AddChair("wood_chair", "wood_chair", "wood_chair_chair", ...): the build, then the bank.
    "wood_chair": ["anim/wood_chair_chair.zip", "anim/wood_chair.zip"],
}
# Clip audit: archive -> the clips the prefab's Lua plays and the facing mask each must cover. Every other clip in the
# bank is listed, so a clip no current branch selects is still seen.
FOUR_FACED = 0b1111  # right, up, left, down
BANK_CLIPS = {
    # OnHit hit -> idle, OnBuilt place -> idle, DefaultBurntStructureFn burnt (looping), back's OnChairBurnt burnt.
    "anim/wood_chair.zip": {"idle": FOUR_FACED, "hit": FOUR_FACED, "place": FOUR_FACED, "burnt": FOUR_FACED},
}


def bank_clips(data):
    """anim.bin: each clip's name with the union of its facing masks."""
    if data[:4] != b"ANIM":
        raise ValueError("Invalid animation archive")
    offset = 20

    def read(fmt):
        nonlocal offset
        result = struct.unpack_from("<" + fmt, data, offset)
        offset += struct.calcsize("<" + fmt)
        return result[0] if len(result) == 1 else result

    clips = {}
    for _ in range(read("I")):
        length = read("I")
        name = data[offset:offset + length].decode("utf-8")
        offset += length
        facing, _bank, _rate, frames = read("BIfI")
        clips[name] = clips.get(name, 0) | facing
        for _ in range(frames):
            offset += 16
            events = read("I")
            offset += events * 4
            elements = read("I")
            offset += elements * 40
    return clips


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path,
        default=Path("/data/copy/AssetArchive-Dev/data/DST/data"),
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    package = Path(__file__).resolve().parent.parent
    destination = package.parent.parent / "public/dst/data"
    definitions = json.loads((package / "src/definitions.json").read_text())
    archives = sorted({
        f"anim/{archive}"
        for prefab in SKINNED_PREFABS
        for archive in definitions["animatedBuildings"][prefab]["skinArchives"].values()
    })
    files = {}
    with zipfile.ZipFile(args.source / "databundles/anim_dynamic.zip") as bundle:
        for archive in archives:
            files[archive] = bundle.read(archive)
            atlas = str(Path(archive).with_suffix(".dyn"))
            files[atlas] = (args.source / atlas).read_bytes()
    for prefab, paths in BASE_ARCHIVES.items():
        entry = definitions["animatedBuildings"][prefab]
        declared = {f"anim/{entry['archive']}", f"anim/{entry.get('buildArchive', entry['archive'])}"}
        if declared != set(paths):
            raise SystemExit(f"{prefab}: definitions.json declares {sorted(declared)}, not {sorted(paths)}")
        for path in paths:
            files[path] = (args.source / path).read_bytes()

    if args.check:
        stale = [path for path, data in files.items()
                 if not (destination / path).is_file() or (destination / path).read_bytes() != data]
        problems = [f"{path} differs from the source" for path in stale]
        for archive, required in BANK_CLIPS.items():
            with zipfile.ZipFile(args.source / archive) as bundle:
                clips = bank_clips(bundle.read("anim.bin"))
            for clip, mask in required.items():
                if clips.get(clip, 0) & mask != mask:
                    problems.append(f"{archive}: {clip} does not cover facings {mask:#06b}")
            listed = ", ".join(f"{name} {facings:#010b}" for name, facings in clips.items())
            print(f"{archive}: {len(clips)} clips ({listed})")
        if problems:
            print("\n".join(problems), file=sys.stderr)
            raise SystemExit(1)
        print(f"Checked {len(files)} building archives and atlas packages")
        return
    for path, data in files.items():
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f"Imported {len(files)} building archives and atlas packages into {destination}")


if __name__ == "__main__":
    main()
