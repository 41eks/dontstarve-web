# DST Lua prefab extraction pilot

Run these commands from the repository root. Set `DST_LUA_ROOT` to the directory containing the original `tuning.lua` and `prefabs/`, or pass it via `--source-root`.

```sh
pnpm extract:lua
pnpm extract:lua --check
node tools/lua-extractor/pighead.mjs --callback-source
```

The pilot runs the original `prefabs/stickheads.lua` in fresh Wasmoon states for client, MasterSim, and full-moon MasterSim. It loads the original tuning and standard component helpers and uses seed 42 for each run. Each trace preserves call and assignment order, nil arguments, the pristine boundary, and callback registration and definition locations. Add `--callback-source` to print the callback slices to stdout.

The mock covers the constructor interfaces exercised by this pilot. A child spawn records a reference. The child prefab and attached component constructors are outside the recording scope. Watchers are recorded at registration. The trace includes any callbacks explicitly invoked by the original constructor, including its full-moon initialization. Engine and component calls without a modeled method fail with the Lua source location.

`--check` compares the snapshot and generated TypeScript on disk and reports source hash or recorded field changes. The snapshot lists the Lua input files and hashes. The TypeScript maps the stable `components.workable:SetWorkLeft` call to the existing `Workable` API through the handwritten stick head prefab. Other recorded fields remain available for review in the snapshot.
