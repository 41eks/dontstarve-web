# Prefab sound

移植声音、解码 FSB 或改动 `src/sound.ts` 时适用。总则见 [prefab](../AGENTS.md)。

- Decode DST FSB banks with `/usr/bin/vgmstream-cli`; read [the extraction guide](../../../docs/vgmstream-cli-guide.md) and check the installed CLI's `-h` before extracting. Inspect metadata without creating WAVs beside source banks; export unextended samples with `-i` and implement looping in the browser.
- Verify source Lua event → FEV event → sound definition → bank/file mapping; do not choose streams by name similarity. Convert zero-based FEV `file_index` to one-based extraction indices. Distinguish prefab appearance audio from player casting audio.
- Decoded WAVs are the filename exception: preserve the bank's relative directory and use `<bank>.fsb-<index>.wav` with `-`, not `#`. Compare exported bytes with an existing decoded source WAV when available.
- Centralize event mappings and playback in `packages/prefab/src/sound.ts` using `PlaySound`, `PreloadSounds`, and `DisposeSounds`; do not add a separate audio class/file per prefab or special Vite sound middleware.
- Port `inst.entity:AddSoundEmitter()` and `inst.SoundEmitter:*` to `instance.AddSoundEmitter()` and the same method names on `instance.SoundEmitter`, keeping the source's slot names. Removal stops the entity's named and looping sounds; an unnamed one-shot plays on, as the source's sound-only entities rely on.
- Preload/decode before spawning or timed actions, resume audio during a user gesture, give each entity an independent looping source, and stop/disconnect its sounds on removal. Dispose all sounds on explicit game shutdown within the running page; do not trigger this cleanup on `pagehide`.
