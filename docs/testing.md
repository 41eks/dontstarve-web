# Repository tests

Place Vitest tests for a package's behavior in `packages/<package>/tests`. Use `tests/integration` for application wiring, debug commands, save/load and workflows that have no single package owner. Put fixtures used across packages in `tests/fixtures` and keep package-specific fixtures beside their tests.

Run Vitest from the repository root:

```sh
pnpm test
pnpm test packages/prefab/tests
pnpm test tests/integration
pnpm typecheck:tests
```

Playwright's game suite and its Vite fixtures live in `tests/browser`. For new coverage, use Playwright for startup, loading and performance. Drive input, game actions, UI events, debug commands and save/load directly in Vitest. The production asset-cache suite lives in `tests/asset-cache` and runs against a fresh build.

```sh
pnpm exec playwright install chromium
PLAYWRIGHT_PORT=4199 pnpm test:browser default-save-load
pnpm test:asset-cache
```

When running browser tests in a worktree, choose a free port for `PLAYWRIGHT_PORT`. The test runner starts and owns its Vite server on that port.

Sample normal behavior, meaningful boundaries or cancellations, and state or resource preservation. Use a small number of tests for distinct asset and rendering paths. The asset import scripts' `--check` modes verify full catalogs, mirrored paths and bytes.
