# Repository instructions

## DST asset paths

- Assets sourced from `/data/copy/AssetArchive-Dev/data` must be placed under `public/dst/data`.
- Preserve each asset's relative path below the source `data` directory. For example, `/data/copy/AssetArchive-Dev/data/anim/wilson.zip` maps to `public/dst/data/anim/wilson.zip`.
- Runtime URLs must follow the same mirrored path below `${import.meta.env.BASE_URL}dst/data/`; do not flatten or rename DST asset files.
