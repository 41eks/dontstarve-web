# DST Lua prefab extraction pilot

Run these commands from the repository root. Set `DST_LUA_ROOT` to the directory containing the original `tuning.lua` and `prefabs/`, or pass it via `--source-root`.

```sh
pnpm extract:lua
pnpm extract:lua --check
node tools/lua-extractor/pighead.mjs --callback-source
```

Wasmoon runs the original `prefabs/stickheads.lua` for `pighead` and `mermhead` in fresh client, MasterSim, and full-moon MasterSim states. Both load the original tuning and standard component helpers. The MasterSim scenarios use different fixed seeds to expose values that vary with randomness. The checked-in pighead trace preserves call and assignment order, nil arguments, the pristine boundary, and callback registration and definition locations. Add `--callback-source` to print the callback slices to stdout.

The generated `stickheads.schema.ts` supplies the archive, animation bank, initial and full-moon clips, constructor tags, child prefab, hammer action and work count, and burn duration and FX level. The shared handwritten prefab uses these defaults for both variants through the existing sprite, component, and child attachment APIs. The CLI also syncs the two archive and initial clip fields in the building catalog for save archive selection.

The recorded child is a reference. Child and component constructors are outside the recording scope. World watchers and gameplay callbacks are captured at registration, and the trace includes the full-moon callback the Lua constructor itself invokes. The generator emits the `OnFullMoon` callback type with parameter names from the Lua AST and the argument types from the `WatchWorldState("isfullmoon")` mapping. The `SetOnWorkCallback` mapping also emits the `OnWorked` signature with the Lua declaration’s arity. Additional declared arguments take their types by position from `WorkableOnWorkFn`. The TypeScript prefab owns the runtime effects and callbacks. Random propagator values remain in the snapshot.

`--check` compares the snapshot, generated TypeScript, and the two catalog rows. Unsupported mappings report an error before writing generated files.
