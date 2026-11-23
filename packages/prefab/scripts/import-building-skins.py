#!/usr/bin/env python3
"""Mirror DST building archives, skin build archives and their companion atlas packages.

--check compares every mirrored file byte for byte. The clips a prefab's Lua plays are checked against the mirrored
bank by `pnpm extract:lua --prefab <id> --check`, which generates the schema's clip table from the bank's anim.bin.
"""

import argparse
import json
from pathlib import Path
import sys
import zipfile

SKINNED_PREFABS = ["cookpot", "researchlab", "researchlab2", "researchlab3", "researchlab4", "sculptingtable", "winterometer", "lightning_rod", "birdcage", "moondial", "bookstation", "dragonflyfurnace", "wood_chair", "stagehand"]
# Buildings whose base Asset("ANIM", ...) archives this script mirrors from data/anim, by prefab.
BASE_ARCHIVES = {
    "stagehand": ["anim/stagehand.zip"],
    # furniture_chairs.lua AddChair("wood_chair", "wood_chair", "wood_chair_chair", ...): the build, then the bank.
    "wood_chair": ["anim/wood_chair_chair.zip", "anim/wood_chair.zip"],
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path,
        default=Path("/data/copy/AssetArchive-Dev/data/DST/data"),
    )
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--prefab", choices=SKINNED_PREFABS)
    parser.add_argument("--base-only", action="store_true", help="mirror base art before generating the skin catalog")
    args = parser.parse_args()
    package = Path(__file__).resolve().parent.parent
    destination = package.parent.parent / "public/dst/data"
    definitions = json.loads((package / "src/definitions.json").read_text())
    archives = sorted({
        f"anim/{archive}"
        for prefab in (SKINNED_PREFABS if args.prefab is None else [args.prefab])
        if not args.base_only
        for archive in definitions["animatedBuildings"][prefab]["skinArchives"].values()
    })
    files = {}
    with zipfile.ZipFile(args.source / "databundles/anim_dynamic.zip") as bundle:
        for archive in archives:
            files[archive] = bundle.read(archive)
            atlas = str(Path(archive).with_suffix(".dyn"))
            files[atlas] = (args.source / atlas).read_bytes()
    for prefab, paths in BASE_ARCHIVES.items():
        if args.prefab is not None and prefab != args.prefab:
            continue
        if not args.base_only:
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
