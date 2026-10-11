# Representative tests

Tests sample distinct behavior rather than every prefab or cosmetic variation. The retained cases cover animation timing and cancellation, merged sprite layers and facing, inventory transactions, save validation/restoration, resource cleanup, and actual browser input/rendering. Asset import scripts with `--check` verify complete source catalogs, mirrored paths and bytes.

Run the suites from the repository root:

```sh
pnpm --filter @dontstarve-web/animation test
pnpm --filter @dontstarve-web/inventory test
pnpm --filter @dontstarve-web/stategraphs test
pnpm --filter @dontstarve-web/ui test
```

Use ordinary skins for the common build replacement path, plus a small number of cases for symbol overrides, additional animation layers and invisible equipment. For shared state machines, choose representative timelines and one or two cancellation mechanisms instead of testing every action against every interruption. Add a browser case when a behavior depends on real DOM events, layout, workers, WebGL or browser audio.

When replacing an old test with a broader representative case, remove its unused setup, imports and fixture code. Test runners continue discovering the remaining suites normally; no tests are skipped or hidden by an allowlist.
