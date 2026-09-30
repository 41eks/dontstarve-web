#!/usr/bin/env python3
"""Mirror DST skin build archives and their companion atlas packages."""

import argparse
import json
from pathlib import Path
import shutil
import zipfile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source", type=Path,
        default=Path("/data/copy/AssetArchive-Dev/data/DST/data"),
    )
    args = parser.parse_args()
    package = Path(__file__).resolve().parent.parent
    destination = package.parent.parent / "public/dst/data"
    definitions = json.loads((package / "src/definitions.json").read_text())
    prefabs = ["cookpot", "researchlab", "researchlab2", "researchlab3", "researchlab4"]
    archives = sorted({
        f"anim/{archive}"
        for prefab in prefabs
        for archive in definitions["animatedBuildings"][prefab]["skinArchives"].values()
    })
    with zipfile.ZipFile(args.source / "databundles/anim_dynamic.zip") as bundle:
        for archive in archives:
            target = destination / archive
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(bundle.read(archive))
            atlas = Path(archive).with_suffix(".dyn")
            shutil.copyfile(args.source / atlas, destination / atlas)
    print(f"Imported {len(archives)} skin builds and atlas packages into {destination}")


if __name__ == "__main__":
    main()
