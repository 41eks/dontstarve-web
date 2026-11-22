# DST Lua prefab extraction pilot

Run these commands from the repository root. Set `DST_LUA_ROOT` to the directory containing the original `tuning.lua` and `prefabs/`, or pass it via `--source-root`.

```sh
pnpm extract:lua
pnpm extract:lua --check
node tools/lua-extractor/pighead.mjs --callback-source
```

Wasmoon runs the original `prefabs/stickheads.lua` for `pighead` and `mermhead` in fresh client, MasterSim, and full-moon MasterSim states. Both load the original tuning and standard component helpers. The MasterSim scenarios use different fixed seeds to expose values that vary with randomness. The checked-in pighead trace preserves call and assignment order, nil arguments, the pristine boundary, and callback registration and definition locations. Add `--callback-source` to print the callback slices to stdout.

The generated `stickheads.schema.ts` supplies the archive, animation bank, initial and full-moon clips, constructor tags, child prefab, hammer action and work count, and burn duration and FX level. The shared handwritten prefab uses these defaults for both variants through the existing sprite, component, and child attachment APIs. The CLI also syncs the two archive and initial clip fields in the building catalog for save archive selection.

The recorded child is a reference. Child and component constructors are outside the recording scope. The construction trace captures watcher registration and the full-moon callback that the Lua constructor invokes. Random propagator values remain in the snapshot.

The AST scan emits a TypeScript signature for every `local function`, including nested and uncalled declarations. Parameter names, arity, and source locations come from the Lua source. Types come from recorded callback contracts, the statically visible `Prefab` and `DoTaskInTime` sites, and the `create_common` helper's known contract. Unmapped arguments and value returns use `unknown`. Functions without value returns use `void` when no mapped return type applies. The generated signatures are type declarations.

`--check` compares the snapshot, generated TypeScript, and the two catalog rows. Unsupported runtime configuration mappings and conflicting callback contracts report an error before writing generated files.


## Generate a fill-in scaffold

```sh
node tools/lua-extractor/pighead.mjs --scaffold OnFullMoon
```

The command only reads the Lua source and prints TypeScript. The AST preserves the `if`/`elseif`/`else` structure and returns. Each condition, statement, or return value has a numbered `TODO` and its Lua source above it. A multiline Lua statement gets a single placeholder with the full line range. Other compound statements get one placeholder for the block.

The scaffold imports the generated signature from `./stickheads.schema`. When using the output as a file, place it beside that schema or adjust the import. Run the normal generation command first when the Lua declaration has changed. The placeholders throw with the Lua location so incomplete code fails immediately if invoked.
