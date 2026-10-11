# UI package instructions

## Crafting grid layout

- The crafting category grid (`.craft-categories`) must display 11 equal-width slots per row.
- The crafting recipe grid (`.craft-recipes`) must display 7 equal-width slots per row.
- Keep visible horizontal and vertical gaps between crafting recipe slots.

- All inventory-related slots (inventory, equipment, chest, and cook pot / prepared food) must have the same final on-screen width and height as the `inventory-bar` slots. Adjust spacing and panel/background size independently, and compensate for panel scaling so it does not change slot sizes.