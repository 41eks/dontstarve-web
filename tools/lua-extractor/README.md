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

The command reads the Lua source and the checked-in snapshot, and prints TypeScript. The AST preserves the `if`/`elseif`/`else` structure and returns. Each condition, statement, or return value has a numbered `TODO` and its Lua source above it. A multiline Lua statement gets a single placeholder with the full line range. Other compound statements get one placeholder for the block.

The scaffold imports the generated signature from `./stickheads.schema`. When using the output as a file, place it beside that schema or adjust the import. Run the normal generation command first when the Lua declaration has changed. The placeholders throw with the Lua location so incomplete code fails immediately if invoked.

## Lua no scenario ran

```sh
pnpm extract:lua --prefab wood_chair --unexecuted
```

Recording sets a Lua line hook and call hook on the prefab file. Across all the profile's scenarios, the snapshot's `unexecuted` list holds what never ran:

- each function that was never entered, listed once without its inner branches. These are usually the callbacks that only run after construction, such as `OnHit`, `OnSave` or event handlers;
- each `if`/`elseif`/`else` body and `for`/`while` body in a function that did run, when none of its own lines executed. The lines of closures declared inside the body don't count.

A body that sits on its condition's line (`if x then y() end`) is marked `indeterminate`, because line coverage cannot separate it from the condition. An `if` without `else` whose body always ran is not listed, nor is a short-circuit `and`/`or` operand.

The list shows up in three places:

- the generation summary prints the counts and `--unexecuted` prints each region with its Lua lines;
- the generated signature of a function no scenario runs says so in its doc comment;
- the scaffold lists the unexecuted regions inside the function in its header and marks each unexecuted branch where its body starts.

`--scaffold` and `--unexecuted` read the checked-in snapshot and fail when it was recorded from a different Lua file, so regenerate after the source changes. Everything listed comes from the Lua source alone and has to be ported by reading it. The pighead profile marks a signature only when neither `pighead` nor `mermhead` runs the function. Its scaffold and `--unexecuted` read the pighead snapshot.

## Clips

Every snapshot carries `clipPlays`, a static scan (`clip-scan.mjs`) of each `AnimState:PlayAnimation` / `PushAnimation`. It covers three sources:

- the prefab file;
- every callback a recording registered from another file, such as `standardcomponents.lua`'s `DefaultBurntStructureFn`;
- the stategraph each recording sets with `inst:SetStateGraph("SGx")`, from `stategraphs/SGx.lua`.

For each play it records:

- the clip;
- play or push;
- the loop argument: `true`, `false`, `omitted` or `dynamic`;
- the entity expression it plays on;
- the line and enclosing function (a stategraph state's functions are named `<state>.onenter` and the like);
- for the prefab file, whether a scenario ran that line.

A local function that forwards a parameter as the clip, such as furniture_chairs.lua's `_PlayAnimation(inst, anim, loop)`, is followed to its call sites. Each site then reports one play per target, in the caller's terms (`inst`, `inst.back`).

The clip argument is enumerated where it can be:

- a literal;
- `a .. b`, every combination;
- `cond and "a" or "b"`, and `a or b`, both sides;
- a call of a local function declared once in the file, such as SGmoondial's `CalcPhaseAnimName("idle")`, the union of its returns with its arguments bound;
- `TheWorld.state.<key>`, each value the profile's scenarios give that key. The moondial scenarios cover all five moon phases.

This can list combinations the Lua never builds, such as SGmoondial's `wax_to_new`, which `CalcTransitionAnimName` handles first. Those show up under `clipsNotInBank`. Any other computed clip is kept as its expression.

The evaluator (`lua-eval.mjs`) tracks what each value can be: strings, `nil`, booleans, functions, and tables with their fields. It uses that to settle conditions:

- `x == nil` and `type(x) ~= "function"`, decided wherever the possible values allow;
- `and`, `or` and `not`;
- a function's locals, bound flow-insensitively;
- util.lua's `FunctionOrValue`.

A `CommonStates.AddX(...)` call in a stategraph is expanded through `stategraphs/commonstates.lua`. The builder is evaluated with the stategraph's arguments bound, so `anims = { walk = "stroll" }` gives `stroll`, and no `anims` gives the builder's default `walk_loop`. The local functions its states reference (`onenter = onentersleeping`) are scanned too, and so are the builders it calls in turn. These plays carry `via` (the builder) and `source` (the commonstates.lua line).

Across the game's stategraphs, the 807 builder calls give about 2450 named plays and 445 computed ones. The computed ones mostly come from:

- a function passed as the override;
- a loop over a table of anims;
- an argument the engine passes at runtime, such as AddIdle's `pushanim`.

The values of separate parameters are not correlated, and a component's plays are not scanned. Lua's default for an omitted `PushAnimation` loop is not settled (see `packages/prefab/docs/lua-api-map.md`), so it stays `omitted`.

A profile turns the plays into a schema clip table with `clipCatalog`, which reads the bank's `anim.bin` from the mirrored archive under `public/dst/data` (`anim-bin.mjs`):

- `clips`: every clip of the bank, with the facings it covers and its frame count;
- `clipsNotInBank`: clips the Lua plays that the bank lacks, with where;
- `dynamicClips`: computed clips.

Generation and `--check` fail when a clip the Lua plays lacks a facing that the Transform face mode needs. TS reads clip names from the table, so a clip missing from the bank does not compile. Two ways do this:

- `CONFIG.clips.hit.name` in `furniture_chairs.ts`;
- the clip type `keyof typeof MOONDIAL_CONFIG.clips`, which `SGmoondial.ts`'s template-built names must match.

## Moondial

```sh
pnpm extract:lua --prefab moondial
pnpm extract:lua --prefab moondial --check
node tools/lua-extractor/pighead.mjs --prefab moondial --scaffold onmoonphasechagned
```

The moondial profile records the constructor on the client and in each of the five master moon phases. Its schema supplies the split bank/build assets, initial animation, tags, collider and deploy radii, minimap settings, hammer work, reflection symbols, phase light, and the clip table of fn and SGmoondial: the 31 clips of the moondial bank, with `wax_to_new` and `wane_to_full` listed as not in the bank. The trace includes the altar and ghost gestalter registrations for later ports.

## Wood chair

```sh
pnpm extract:lua --prefab wood_chair
pnpm extract:lua --prefab wood_chair --check
pnpm extract:lua --prefab wood_chair --scaffold OnChairBurnt
```

The profile runs `prefabs/furniture_chairs.lua` with `util.lua` and `prefabutil.lua` loaded, because the file calls `shallowcopy`, `MakePlacer` and `MakeDeployableKitItem` while it builds its list. It records the client and two MasterSim seeds. The sandbox's `SpawnPrefab` runs the constructor of a prefab the same file returns, so the trace includes `wood_chair_back` and its `entity:SetParent`. The two seeds draw different `MakeSmallPropagator` values. The config checks that both fall in the `small` preset's ranges instead of copying them.

The first MasterSim scenario also records skins (`skins: true` on a scenario). The sandbox loads `prefabskin.lua` and `prefabs/skinprefabs.lua`. For each skin whose `base_prefab` is the recorded prefab, it constructs a fresh entity and runs the skin's own `init_fn`, as the engine applies a skin after `fn`. The recording keeps only the operations from `init_fn` in `recording.skins`, together with the children that construction spawned, so the main trace stays the same. For `wood_chair`, each init_fn must:

- `SetSkin(<skin build>, "wood_chair_chair")` the chair;
- `OverrideItemSkinSymbol` the back's symbols from the same build, passing the chair's GUID.

Every skin must override the same back symbols, and any other operation is an error. Each skin build is mirrored as `anim/dynamic/<build>.zip`.

`wood_chair.schema.ts` supplies the bank/build archives of the chair and its back, the idle clip, the four facings, the final offsets and hidden layers of the chair and its back, the skins and the back's skin symbols, the bank's clips (`idle`, `hit`, `place` in four facings, `burnt` in eight), with `rocking_pre` / `rocking_loop` / `rocking_pst` listed as played only by the rocking-chair branches and absent from this bank, the tags, collider and deploy radii, `inspectable.nameoverride`, `savedrotation.dodelayedpostpassapply`, hammer work, haunt cooldown and burn settings. `localContracts` types the animation helpers and the nested `fn` / `backfn`, which no registration records. The rocking-chair branches (`OnSyncChairRocking`, `OnBecomeSittable`) and the back's client-only `OnEntityReplicated` are not recorded for this ID.

The CLI writes the recorded skins into `animatedBuildings.wood_chair.skinArchives` in `packages/prefab/src/definitions.json`. The skin import, the save converter and the building placer all read that row, and `--check` fails when the row and the recording differ. The skins' `clear_fn` (`wood_chair_clear_fn`) is not recorded.

## Stagehand

`stagehand` records the pristine client constructor and three MasterSim seeds. The MasterSim profiles include skins,
snow and lunar hail buildup symbols, and the standing collision declaration. `SGstagehand` and the default
`CommonStates.AddWalkStates` branch are scanned for the same bank. The schema also records clip durations for the
stategraph's game-time queue and the five skin IDs with their shared base-build overrides. To regenerate the art and
recording, run the following commands from the repository root.

```sh
python3 packages/prefab/scripts/import-building-skins.py --prefab stagehand --base-only
pnpm extract:lua --prefab stagehand
python3 packages/prefab/scripts/import-building-skins.py --prefab stagehand
python3 packages/prefab/scripts/import-stagehand-sounds.py
```


## Livingtree

The livingtree profile records the client and MasterSim constructors, snow and lunar hail appearance, standing and
stump fire and propagator presets, chop and fall callbacks, and the Hallowed Nights task registration. The schema
contains all clips in `evergreen_living_wood.zip`, their masks and frame counts, and the burnt chop duration used by the
game-time completion event. The factory and callbacks read this schema directly. Run the following commands in the
repository root with `DST_LUA_ROOT` set.

```sh
python3 packages/prefab/scripts/import-rocks.py --prefab livingtree
pnpm extract:lua --prefab livingtree
pnpm extract:lua --prefab livingtree --check
python3 packages/prefab/scripts/import-livingtree-sounds.py
```
