# Item art and skins

移植物品、地面美术、物品栏图标或皮肤时适用。总则见 [prefab](../AGENTS.md)。

- Resolve inventory UI icons, ground/world art, and equipped art separately from source Lua and metadata, including the actual atlas, bank/build/clip, and skin overrides. Use animation/build assets for available ground art, including single-frame poses; do not substitute inventory icons or infer assets from item IDs.
- Prefabs with source-defined skins must support the existing `reskin_tool` workflow, including skin assets, symbol overrides, and inventory icons where applicable. Preserve identity, position, component state, and selected skins through reskinning, dropping, pickup, equipment changes, and save/load. Do not invent skins for prefabs without them.
- Resolve each inventory icon's actual `images/inventoryimages*.xml` atlas in `databundles/images.zip`, including skin overrides; do not assume all icons belong to `inventoryimages.xml`.
- Inventory icons are only a ground-art fallback for items outside the ground prefab/catalog system. Keep NPC-only `shadow_thrall_parasitehat` excluded from hat imports, inventory metadata, recipes, and fallbacks.
- Regenerate and verify catalogued ground assets with `packages/prefab/scripts/import-ground-items.py` and `--check`, preserving source paths and bytes. See [item asset examples and import workflow](../../../docs/dst-item-assets.md).
