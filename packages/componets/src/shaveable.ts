/**
 * components/shaveable.lua: the component SHAVE checks on its target. Only the constructor signature is ported; the
 * prize, `can_shave_test` / `on_shaved` callbacks, the `bearded` tag its prize_count keeps and its OnSave / OnLoad are
 * not implemented yet, so a prefab adds the component without calling SetPrize.
 */
export class Shaveable {
  constructor(_inst: object) {}
}
