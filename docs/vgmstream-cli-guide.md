# vgmstream-cli 使用指南

[vgmstream](https://github.com/vgmstream/vgmstream) 是一个开源的流式音频解码库，支持数百种游戏音频格式。本项目用它从 Don't Starve Together 的 FMOD 音频包（`.fsb`）中提取并解码音效为标准 WAV 文件。

---

## 常用命令

### 查看文件信息

显示 FSB 文件中第一个子音频流的详细信息（采样率、声道数、编码格式、流数量等）：

```bash
vgmstream-cli -m -s 1 <file.fsb>
```

`-m` 表示只显示信息、不解码，`-s 1` 选择第一个子音频。输出中的 `stream count` 字段即为该 FSB 包含的子音频总数。`-F` 用于禁用循环后的淡出，不是只输出信息。

### 搜索子音频流

按关键词搜索 FSB 中的子音频名称，并输出每个匹配流的信息：

```bash
vgmstream-cli -m -s 1 -S 0 <file.fsb> > /tmp/fsb-metadata.txt
rg -B 10 -A 3 'stream name:.*<keyword>' /tmp/fsb-metadata.txt
```

`-S 0` 表示遍历全部子音频流，配合 `-m` 只输出信息。搜索由 `rg` 完成，匹配流的内部名称（如 `HUD_craft_up_v2`），上下文包含流索引。

> **注意**：`-S` 接受结束索引，不接受关键词；不加 `-m` 会实际解码并写出文件。可以直接过滤 metadata：

```bash
vgmstream-cli -m -s 1 -S 0 <file.fsb> | rg -B 10 -A 3 'stream name:.*craft_up'
```

### 提取指定子音频

通过流索引号提取单个子音频为 WAV 文件：

```bash
vgmstream-cli -i -s <index> -o <output.wav> <file.fsb>
```

- `<index>`：流的编号（从 1 开始，对应 `-m` 输出中的 `stream index`）
- `-o`：输出文件路径
- `-i`：忽略解码器的循环扩展，只导出原始音频一次；浏览器循环播放使用该文件，避免默认重复及淡出。

### 提取全部子音频

不指定 `-s` 时默认提取第一个流。要批量提取，可以循环调用：

```bash
for i in $(seq 1 <count>); do
  vgmstream-cli -i -s $i -o "output_$i.wav" <file.fsb>
done
```

---

## DST 实战示例

### 从 sfx.fsb 提取 `dontstarve/HUD/craft_up`

1. 确认目标流的索引号：

```bash
vgmstream-cli -m -s 1 -S 0 /data/copy/AssetArchive-Dev/data/DST/data/sound/sfx.fsb | rg -B 10 -A 3 'stream name:.*craft_up'
```

输出中会看到类似：

```
stream index: 64
stream name: HUD_craft_up_v2
```

2. 按索引提取为 WAV：

```bash
mkdir -p public/dst/data/sound
vgmstream-cli -i -s 64 -o 'public/dst/data/sound/sfx.fsb-64.wav' /data/copy/AssetArchive-Dev/data/DST/data/sound/sfx.fsb
```

输出确认：

```
sample rate: 44100 Hz
channels: 1
encoding: Custom Vorbis
stream name: HUD_craft_up_v2
play duration: 4399 samples (0:00.100 seconds)
```

生成的 `sound/sfx.fsb-64.wav` 为 PCM 16-bit mono 44100 Hz 标准 WAV，可直接被浏览器播放。解码生成的 WAV 保留源 bank 的相对目录，文件名统一用 `<bank>.fsb-<index>.wav`；运行时在 `${import.meta.env.BASE_URL}dst/data/` 下加载。`#` 只是资源目录中已有解码文件的命名方式，不是格式要求；这里改用 `-`，可直接通过普通静态服务加载。原始 DST 文件仍保留原路径和文件名。

---

## DST 音频资源位置

| 文件 | 说明 |
|---|---|
| `data/DST/data/sound/*.fsb` | FMOD 音频包（FSB5 格式），包含实际的音频数据 |
| `data/DST/data/sound/*.fev` | FMOD 事件定义文件，描述事件名到 FSB 流的映射关系 |

完整的事件路径（如 `dontstarve/HUD/craft_up`）由 FEV 文件定义，其中 `dontstarve` 是项目名，`HUD` 是事件组，`craft_up` 是事件名。FSB 流名称可能与事件名不同；必须结合源 Lua、FEV 和 FSB metadata 确认映射。

矮星的 `dontstarve/common/staff_star_create` 使用 `common.fsb` 流 273（`staff_star_create`），`dontstarve/common/staff_star_LP` 使用流 274（`staff_star_fireLP`）。导出为 `public/dst/data/sound/common.fsb-273.wav` 和 `public/dst/data/sound/common.fsb-274.wav`；若源目录中有 `common.fsb#273.wav`、`common.fsb#274.wav`，核对对应文件字节一致。

### 矮星与施法声音的源码映射

不能只按相似名称挑选流。需要从 Lua 事件路径追踪 FEV 的 sound definition，再读取引用的 bank 和 `file_index`。FEV 的 `file_index` 从 **0** 开始，vgmstream 的 `-s` 从 **1** 开始，因此提取索引是 `file_index + 1`。

下表由 DST 的 `sound/dontstarve.fev` 核对，均引用 `common.fsb`：

| Lua 事件 | FEV 引用文件 | FEV file_index | vgmstream -s | 原始时长 |
| --- | --- | --- | --- | --- |
| `dontstarve/common/staff_star_create` | `sfx/objects/staff_star_create.wav` | 272 | 273 | 1.404 秒 |
| `dontstarve/common/staff_star_LP` | `sfx/objects/staff_star_fireLP.wav` | 273 | 274 | 1.140 秒 |
| `dontstarve/wilson/use_gemstaff` | `sfx/objects/teleportstaff.wav` | 283 | 284 | 2.936 秒 |

`databundles/scripts_unpacked/scripts/prefabs/stafflight.lua` 的第 180 行播放矮星出现声，第 130 行启动循环声。`databundles/scripts_unpacked/scripts/stategraphs/SGwilson.lua` 的 `castspell` 状态在第 13 帧播放独立的魔杖施法声 `use_gemstaff`（物品或皮肤可覆盖），第 53 帧执行召唤。这两段一次性声音用途不同；流 284 不能替换流 273。

FEV 映射解析可以参考 AssetArchive 的 `src-tauri/src/fmodparse.rs`（`FmodEvent::resolve_def()`、`FmodSoundDefFile.file_index`），零基 FSB 索引的链接见 `src-tauri/src/scripts/assetloader.lua` 的 `Fev:GetEventByPath()` 和 `FsbLoader:GetSampleInfoByIndex()`。

### 矮星 metadata 与导出命令

先用 `/usr/bin/vgmstream-cli -h` 核对安装版本的参数，再列出 metadata。以下命令只读取源 bank，不在其旁边生成 WAV：

```bash
/usr/bin/vgmstream-cli -m -s 1 -S 0 /data/copy/AssetArchive-Dev/data/DST/data/sound/common.fsb > /tmp/three-roaming-common-metadata.txt
rg -B 10 -A 3 'stream name:.*staff_star' /tmp/three-roaming-common-metadata.txt
```

在仓库根目录导出矮星出现声、循环声和独立的魔杖施法声：

```bash
mkdir -p public/dst/data/sound
/usr/bin/vgmstream-cli -i -s 273 -o 'public/dst/data/sound/common.fsb-273.wav' /data/copy/AssetArchive-Dev/data/DST/data/sound/common.fsb
/usr/bin/vgmstream-cli -i -s 274 -o 'public/dst/data/sound/common.fsb-274.wav' /data/copy/AssetArchive-Dev/data/DST/data/sound/common.fsb
/usr/bin/vgmstream-cli -i -s 284 -o 'public/dst/data/sound/common.fsb-284.wav' /data/copy/AssetArchive-Dev/data/DST/data/sound/common.fsb
```

源目录已有对应解码 WAV 时，可用 `cmp` 核对字节，例如：

```bash
cmp 'public/dst/data/sound/common.fsb-273.wav' '/data/copy/AssetArchive-Dev/data/DST/data/sound/common.fsb#273.wav'
```

### 锤子与鹤嘴锄声音的源码映射

`SGwilson.lua` 的 `hammer` 状态在 `pickaxe_loop` 第 7 帧播放 `dontstarve/wilson/hit`。
`mine` 状态在同一帧调用 `commonstates.lua` 的 `PlayMiningFX()`，普通岩石使用
`dontstarve/wilson/use_pick_rock`。以下映射由 `dontstarve.fev` 确认：

| 事件 | bank | FEV file_index | vgmstream -s | 样本 |
| --- | --- | --- | --- | --- |
| `dontstarve/wilson/hit` | `sfx.fsb` | 422 / 423 | 423 / 424 | `batHit1` / `batHit2`，等权随机 |
| `dontstarve/wilson/use_pick_rock` | `wilson.fsb` | 123 | 124 | `pickaxe_hitrock_v2` |

导出为 `public/dst/data/sound/sfx.fsb-423.wav`、`sfx.fsb-424.wav` 和 `wilson.fsb-124.wav`。
多样本事件预加载全部样本，每次 `PlaySound()` 按事件映射选择一个样本；不要将普通锤击误配为熔炉活动的雷神锤音效。

### 冰箱与木箱开关声音的源码映射

`prefabs/icebox.lua` 的 `onopen` / `onclose` 直接播放冰箱开关事件。
`prefabs/treasurechest.lua` 的 `SOUNDS.open` / `SOUNDS.close` 指定木箱的默认开关事件。
以下映射由 `dontstarve.fev` 确认，均为一次性音效，在开关动画开始时播放：

| 事件 | bank | FEV file_index | vgmstream -s | 样本 |
| --- | --- | --- | --- | --- |
| `dontstarve/common/icebox_open` | `sfx.fsb` | 382 | 383 | `ice_box_open_v2` |
| `dontstarve/common/icebox_close` | `sfx.fsb` | 381 | 382 | `ice_box_close_v2` |
| `dontstarve/wilson/chest_open` | `wilson.fsb` | 14 | 15 | `Chest_open` |
| `dontstarve/wilson/chest_close` | `wilson.fsb` | 13 | 14 | `Chest_close` |

沿用 `vgmstream-cli -i -s <index> -o public/dst/data/sound/<bank>.fsb-<index>.wav <source.fsb>` 导出。
木箱 Lua 的皮肤可通过 `skin_open_sound` / `skin_close_sound` 覆盖默认事件；当前接入的是上述默认声音。

### 木质建筑坍塌声音

`structure_collapse_fx.lua` 的 `SetMaterial("wood")` 同时播放
`dontstarve/common/destroy_smoke` 和 `dontstarve/common/destroy_wood`。
经 `dontstarve.fev` 的事件 → sound definition → bank/file_index 核对：

| 事件/层 | bank | FEV file_index（零基） | vgmstream -s | 引用样本 |
| --- | --- | --- | --- | --- |
| `destroy_smoke` 第一层（随机选一个） | `common.fsb` | 55–58 | 56–59 | `Destroy_Smoke_v2_01.wav` 至 `_04.wav` |
| `destroy_smoke` 第二层 | `common.fsb` | 61 | 62 | `Destroy_smoke.wav` |
| `destroy_smoke` 第三层 | `common.fsb` | 186 | 187 | `deathpoof.wav` |
| `destroy_wood` | `common.fsb` | 63 | 64 | `Destroy_wood.wav` |

使用 `vgmstream-cli -i -s <index>` 导出至 `public/dst/data/sound/common.fsb-<index>.wav`。
映射集中在 `packages/prefab/src/sound.ts`，科技建筑创建时预加载，第四次成功锤击时播放。

### 常用 FSB 文件

- `sfx.fsb` — HUD 音效、脚步声、攻击音效等（约 1287 个流）
- `common.fsb` — 通用音效
- `together.fsb` — DST 联机版特有音效
- `music_frontend.fsb` — 前端音乐
- `forest.fsb` / `cave_AMB.fsb` — 环境音效

### 清洁扫把的施法与换肤声音

`SGwilson.lua` 的 `veryquickcastspell` 状态开始时播放 `dontstarve/wilson/attack_weapon`，
播放 `atk_pre → atk`，第 9 帧执行换肤。`prefabs/explode_small.lua` 的 `extras.reskin`
在结果特效出现时播放 `dontstarve/common/together/reskin_tool`；幽灵画笔皮肤的
`extras.reskin_brush` 改用 `terraria1/skins/spectrepaintbrush`。其他三种扫把皮肤沿用普通结果声。
这些是一次性样本；同一事件内的多样本按 FEV 权重等概率选择一个。

| 事件 | FEV | bank | file_index（零基） | vgmstream -s（从 1 开始） |
| --- | --- | --- | --- | --- |
| `dontstarve/wilson/attack_weapon` | `dontstarve.fev` | `sfx.fsb` | 1229–1232 | 1230–1233 |
| `dontstarve/common/together/reskin_tool` | `dontstarve.fev` | `sfx.fsb` | 826–831 | 827–832 |
| `terraria1/skins/spectrepaintbrush` | `terraria1.fev` | `terraria1.fsb` | 240–242 | 241–243 |

FEV 引用分别为 `sfx/wilson/attack_whoosh_weapon_1.wav` 至 `_4.wav`、
`sfx/together/reskin_tool/reskin_tool_DST-001.wav` 至 `-006.wav`，以及
`sfx/together/terraria/reskin_spectrepaintbrush_DST_-001.wav` 至 `-003.wav`。
导出时对上表每个索引使用 `vgmstream-cli -i -s <index>`，目标放到
`public/dst/data/sound/<bank>.fsb-<index>.wav`。施法开始后取消会保留已经播放的挥动声，
但不播放换肤结果声；结果声仅在第 9 帧成功提交时触发。

## 浏览器播放与生命周期

源事件与静态 WAV URL 的映射集中在 `packages/prefab/src/sound.ts`。例如矮星出现声通过普通 URL `${import.meta.env.BASE_URL}dst/data/sound/common.fsb-273.wav` 加载；无需特殊 Vite 中间件或每个 prefab 单独的音频类。

生成实体或安排定时动作之前调用 `PreloadSounds(...eventPaths)` 完成预加载和解码，再通过 `PlaySound('dontstarve/…')` 播放源事件。解码只导出一个未延长的样本，持续循环由浏览器实现。

每个实体保留自己的循环播放句柄，移除实体时调用句柄的 `stop()` 停止并断开音源。音频上下文需要在用户手势期间恢复；关闭整个游戏时调用 `DisposeSounds()`。这些流程避免多个实体共享同一循环源，或实体移除后仍有声音。
