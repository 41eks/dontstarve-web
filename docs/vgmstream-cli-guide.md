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

### 火把点燃与熄灭

`prefabs/torch.lua` 的 `DoIgniteSound()` 使用 `dontstarve/wilson/torch_swing`，`DoExtinguishSound()` 使用 `dontstarve/common/fireOut`。以当前 `sound/dontstarve.fev` 解析事件路径和 sound definition，映射如下：

| 事件 | sound definition | 源样本 | bank | FEV file_index | `vgmstream -s` |
| --- | --- | --- | --- | --- | --- |
| `dontstarve/wilson/torch_swing` | 42 | `sfx/wilson/Torch_swing_1.wav` / `Torch_swing_2.wav` | `wilson.fsb` | 94 / 95 | 95 / 96 |
| `dontstarve/common/fireOut` | 44 | `sfx/objects/fire_out.wav` | `common.fsb` | 197 | 198 |

用 `-m -s` 检查 metadata，再用 `-i` 导出 `public/dst/data/sound/wilson.fsb-95.wav`、`wilson.fsb-96.wav` 和 `common.fsb-198.wav`。三份导出均与源目录已有的对应 `<bank>.fsb#<index>.wav` 比较，字节一致。两个事件均为非循环声音；播放映射统一位于 `packages/prefab/src/sound.ts`。

### 开采碎石声

`rocks.lua:OnWork` 完成时生成 `rock_break_fx`，其 `PlayRockBreak` 播放 `dontstarve/wilson/rock_break`。核对 `dontstarve.fev` 的事件 → sound definition 84（`use_pick_rock Copy_108`）→ `sfx/objects/Stone_break.wav`，bank 为 `wilson`，零基 `file_index` 为 24，对应提取索引 25。已检查安装 CLI 的 `-h` 和 `-m -s 25`，以 `-i -s 25` 导出 `public/dst/data/sound/wilson.fsb-25.wav`，与源目录已有 `wilson.fsb#25.wav` 字节一致；统一 `sound.ts` 预加载，完成开采时播放。

### 月亮石魔杖 / 陶轮材料放置声

`prefabs/moonbase.lua:346,366` 在 `OnStaffGiven` / `OnStaffTaken` 播放 `dontstarve/common/together/moonbase/moonstaff_place`；`prefabs/sculptingtable.lua:25,90,110` 在 `AddSketch` / `onitemtaken` / `giveitem` 复用此事件。陶轮 `onload` 调用 `giveitem`，因此恢复已有材料也播放声音；换肤只恢复符号覆盖，不播放。

核对 `sound/dontstarve.fev`，该事件有两个有效声音层：sound definition 2381（`/other/place_structure_wood`）使用 `sfx/objects/place_structure_wood.wav`，bank `common`、零基 `file_index` 232；sound definition 2355（`/other/Medium_rock_impact_2`）在 `sfx/together/rock impact/Medium_rock_impact_*.wav` 中等权选择一个，bank `sfx`。另一个空层不产生声音。

导出索引为 `common:233` 与 `sfx:857,859,861,862,863,864,865,847,848,849,850,851,852,853,854,855,856,858`（不包括 860）。先检查 CLI `-h`，用 `-m -s` 核对 metadata，再用 `-i -s <index> -o public/dst/data/sound/<bank>.fsb-<index>.wav` 导出；19 份 WAV 均与源目录已有 `<bank>.fsb#<index>.wav` 字节一致。`sound.ts` 统一预加载全部候选，每次播放木质层与一个随机石块层，均不循环。

`moonbase.lua:OnRepaired` 使用独立事件 `dontstarve/common/together/moonbase/repair`。FEV 有三层：sounddef 2380 使用 `sfx/wilson/pickaxe_hitrock_v2.wav`，bank `wilson`、零基索引 123（提取 124）；sounddef 2354 等权选择 20 个 `Medium_rock_impact_1..20`，bank `sfx`、提取索引 846–865（包括放杖事件没有的 846、860）；sounddef 2319 使用 `sfx/wilson/hit_unbreakablerock.wav`，bank `sfx`、零基索引 1273（提取 1274）。复用已有 124 和石块样本，按 `-m -s` 核对新增的 846、860、1274，再用 `-i` 导出；三份新增 WAV 均与源目录已有解码 WAV 字节一致。修复导致姿态变化时三层同时播放，实体释放时停止其音源。

### 月亮石充能声和音乐

`positronbeam.lua` 定义 `positronbeam_front/back` 和 `positronpulse`。FEV `moonbase/beam` 的 sounddefs 2154–2156 使用同一 `sfx/together/moonbase/Beam_2v3.wav`、`sfx` 零基索引 789（提取 790），处于相邻的 0–1/3、1/3–2/3、2/3–1 强度区间；另一个层 sounddef 2344 使用 `lasernotlaser_LP.wav`、零基索引 793（提取 794）。两层在浏览器独立循环，Lua 设置强度为 0、0.6、0.9；第二层音量使用 FEV EPRP 357–359 的强度包络。

`beam_level_up` → sounddef 1363 → `beam_level_3.wav` → sfx 792；`beam_stop` → 1360 → `moon_beam_stop_DST.wav` → sfx 795；`beam_stop_fail` → 1364 → `beam_stop_fail.wav` → sfx 793。三个事件不循环。完成时 pulse 播放 `beam_stop`，随后 front 的退出仍按源码播放 `beam_stop_fail`；后者不是仅由取消触发。

`dynamicmusic.lua` 的 moonbase 阶段 1/2 使用 `music_epicfight_moonbase` / `music_epicfight_moonbase_b`，对应 sounddefs 2266/2267、`music/DST_Triggered_event_Fight_A_V2.wav` / `Fight_B_V2.wav`、music 零基索引 24/25（提取 25/26）。Wilson 不开启参数控制的 Wigfrid 歌剧层（2948/2949）。转化后的 `staffcoldlightfx` 使用已有 `staff_coldlight_LP` 三层映射，不播放玩家施法声。

检查 CLI `-h` 和所有新样本 `-m -s` metadata 后，用 `-i` 新增导出 `sfx.fsb-790/792/793/794/795.wav` 和 `music.fsb-25/26.wav`；7 份 WAV 均与源目录已有解码 WAV 字节一致。全部事件统一预加载和播放，退出／移除停止各实体循环音源。

### 雨声

`components/weather.lua:StartAmbientRainSound` 播放 `dontstarve/AMB/rain`（雨罩、树下和雨伞的 `rain/rain_on_umbrella` 等事件未接入），随后只用 `SetParameter("rain", "intensity", rate)` 更新强度。`fev-events.py` 显示该事件有三个同时循环的层，均在 `forest_stream.fsb`：

| sound definition | 源样本 | FEV file_index | `vgmstream -s` | `-m` 流名 | 层 |
| --- | --- | --- | --- | --- | --- |
| 2019 | `sfx/ambience/amb_rain_heavy_LP.wav` | 73 | 74 | `amb_rain_heavy_LP` | 重雨 |
| 2018 | `sfx/ambience/amb_rain_medium_LP.wav` | 75 | 76 | `amb_rain_medium_LP` | 中雨 |
| 2017 | `sfx/ambience/amb_rain_light_LP.wav` | 74 | 75 | `amb_rain_light_LP` | 轻雨 |

`fev-events.py` 不解析包络；各层的 `intensity` 音量曲线来自 FEV 事件层的包络点索引和 `EPRP` 点表。`EPRP` 头为 `'EPRP'`、块长度 u32、点数 u32，之后每点 12 字节：`x` float、`y` float、曲线形状 u32；包络点索引（月基地光束的 357–359 同理）直接指向该表。`AMB/rain` 三个包络依次为点 `6,14,15`（重雨：0→0.404 为 0，0.404→0.697 升到 1）、`6,16,17`（中雨：0→0.343 升到 1，其后保持）、`3,18,9`（轻雨：恒为 1）。包络在端点外保持端点值。三份样本用 `-i` 导出到 `public/dst/data/sound/forest_stream.fsb-74/75/76.wav`，均与源目录已有的 `forest_stream.fsb#<index>.wav` 字节一致。`sound.ts` 的 `intensity` 字段按层保存包络，`SoundHandle.setParameter('intensity', value)` 在各层独立增益节点上求值；月基地光束共用同一机制。

### 求雨书特效声

`fx.lua` 的 `fx_book_rain` 在成功阅读 `book_rain` 时播放 `wickerbottom_rework/book_spells/rain`。`wickerbottom_rework.fev` 有两个同时播放的 sound definition：9（`book_rain_DST.wav`，file_index 9，`-s 10`）和 20（`book_rain_sparkle.wav`，file_index 10，`-s 11`），均为单声道 44100 Hz。两份样本用 `-m -s` 核对流名后以 `-i` 导出为 `wickerbottom_rework.fsb-10.wav`、`wickerbottom_rework.fsb-11.wav`，与源目录已有的解码 WAV 字节一致；`sound.ts` 映射为两层一次性播放。

### 帐篷睡眠与拆除声

`prefabs/tent.lua` 使用三个事件：`dontstarve/common/tent_sleep`（睡觉时每个 `sleep_loop` 周期的第 33、47 帧各播一次）、`tent_dis_pre` 和 `tent_dis_twirl`（耐久用尽时的 `destroy`，后者延迟 16 帧）。`dontstarve.fev` 解析：`tent_sleep` 的 sounddef 1334 在 `sfx.fsb` 的 11 个 `tent_sleep_loop1..11.wav` 中等权选一个（file_index 394–404，`-s 395..405`，其中 `loop10`/`loop11` 排在 `loop2` 之前）；`tent_dis_pre` 的 sounddef 171 是 `common.fsb` 的 `Tent_dissappear_pre.wav`（file_index 102，`-s 103`）；`tent_dis_twirl` 的 sounddef 172 是 `Tent_dissappear_twirl.wav`（file_index 103，`-s 104`）。13 份样本均用 `-m -s` 核对流名，再以 `-i` 导出，与源目录已有的 `<bank>.fsb#<index>.wav` 字节一致；三个事件在 `sound.ts` 中均为一次性播放。

### 建筑燃烧声

建筑燃烧声来自 `prefabs/fire.lua` 的 `dontstarve/common/campfire`，不是火把的拿出声。`dontstarve.fev` 对应三个同时播放的 sound definition：1762 使用 common 的零基索引 148–151，1765 使用 152–155，1766 使用 157–160；分别以 `vgmstream -i -s 149..152 / 153..156 / 158..161` 导出。实际提取使用单个数值索引，输出 `sound/common.fsb-<index>.wav`；所有 12 份 WAV 均与资源目录现有解码 WAV 字节一致。三个循环层由 `packages/prefab/src/sound.ts` 统一映射，建筑各自创建音源，熄灭、烧毁及移除时停止。熄火声复用上面的 `fireOut` 映射。

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

### FEV 事件解析命令行工具

`packages/prefab/scripts/fev-events.py` 是 `fmodparse.rs` 的 Python 移植版，只读 `.fev`，不写任何文件。它解析事件路径 → sound definition → bank / `file_index`，输出对应的 `vgmstream -s` 索引（`file_index + 1`）。事件路径不含工程名前缀：`dontstarve/wilson/use_break` 写作 `wilson/use_break`。

```bash
# 精确事件路径
python3 -I packages/prefab/scripts/fev-events.py \
  /data/copy/AssetArchive-Dev/data/DST/data/sound/dontstarve.fev wilson/use_break wilson/hit
# 按子串搜索事件
python3 -I packages/prefab/scripts/fev-events.py \
  /data/copy/AssetArchive-Dev/data/DST/data/sound/dontstarve.fev --substring use_break
```

输出示例：

```
wilson/use_break
  sounddef 65: sfx/wilson/Tool_Break.wav bank=wilson file_index=93 vgmstream -s 94 (555 ms)
```

多层事件会列出所有 sound definition 引用的样本。拿到索引后，先用 `vgmstream-cli -m -s <index> <bank>.fsb` 核对 `stream name` 与 FEV 引用文件名一致，再按本文的 `-i` 方式导出。已用 `wilson/hit`（sfx 零基 422、423，对应 `sound.ts` 的 423、424）验证过解析结果。

`SGwilson.lua` 的 `toolbroke` 状态播放 `dontstarve/wilson/use_break`：sounddef 65、`sfx/wilson/Tool_Break.wav`、`wilson` bank 零基 93，提取索引 94；`-i -s 94` 导出的 `public/dst/data/sound/wilson.fsb-94.wav` 与源已解码 `wilson.fsb#94.wav` 字节一致。


黄／蓝法杖的 `staff.lua` 配置 `castsound = "dontstarve/common/staffteleport"`，事件引用 sound definition 909，仍是 `common.fsb` 的零基 283／提取 284；`use_gemstaff` 是状态图的默认回退。耗尽的 `onfinished` 使用 `dontstarve/common/gem_shatter`，引用 sound definition 917、`sfx/objects/gem_shatter.wav`、`common.fsb` 零基 202／提取 203。按 `-i -s 203` 导出 `public/dst/data/sound/common.fsb-203.wav`，与源已解码 `common.fsb#203.wav` 字节一致。两者沿用 `sound.ts` 的统一映射，在准备 CASTSPELL 前预加载。

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

### 留声机歌曲与停止声

`phonograph.lua` 插片时播放 `records.lua` 的默认歌曲或 `skinprefabs.lua:record_init_fn` 的皮肤歌曲，64 秒后关闭并播放 `gramaphone_end`。源 bank 拼写为 `gramaphone`，与 prefab `phonograph` 不同。通过 `dontstarve.fev` 的事件 → sound definition → bank/file_index 核对：

| `dontstarve/music/` 事件后缀 | bank | file_index（零基） | vgmstream -s | FEV 文件引用 |
| --- | --- | --- | --- | --- |
| `gramaphone_ragtime` | `gramaphone` | 9 | 10 | `music/gramaphone/Ragtime_vinyl_mastered.wav` |
| `gramaphone_creepyforest` | `gramaphone` | 3 | 4 | `music/gramaphone/CreepyForest_vinyl_mastered.wav` |
| `gramaphone_drstyle` | `gramaphone` | 6 | 7 | `music/gramaphone/DjangoStyleWeirder_vinyl_mastered.wav` |
| `gramaphone_efs` | `gramaphone` | 8 | 9 | `music/gramaphone/EFS_vinyl_mastered.wav` |
| `gramaphone_hallowednights` | `music_frontend_hallowednights2024` | 0 | 1 | `music/DST_HalloweenBook_80bpm_V8.wav` |
| `gramaphone_end` | `gramaphone` | 11 | 12 | `sfx/objects/gramophoneEnd.wav` |

使用 `/usr/bin/vgmstream-cli -i -s <index> -o public/dst/data/sound/<bank>.fsb-<index>.wav <source bank>` 导出，不延长样本。歌曲由浏览器独立循环，结束声为一次性声音；恢复播放按 `64 - remainingSeconds` 偏移到歌曲进度。已有源 WAV 的导出字节已比较一致。

### 种子进食与坑内播种

`SGwilson.lua` 的 `quickeat` 在第 10 帧播放 `dontstarve/wilson/eat`，第 12 帧执行 EAT。`components/farmplantable.lua` 在成功替换农田坑后播放 `dontstarve/common/plant`；`farm_plant_defs.lua` 的 randomseed.sounds 为空，不额外播放播种外观声。核对 `dontstarve.fev` 的事件 → sound definition → bank/file_index 后：

| 事件 | bank | file_index（零基） | vgmstream -s | 样本 |
| --- | --- | --- | --- | --- |
| `dontstarve/wilson/eat` | `wilson` | 111–113 | 112–114 | `sfx/wilson/eat_1.wav` 至 `eat_3.wav` |
| `dontstarve/common/plant` | `common` | 169–173 | 170–174 | `sfx/objects/craftable/Plant_1.wav` 至 `Plant_5.wav` |

用 `vgmstream-cli -i -s <index>` 导出至 `public/dst/data/sound/<bank>.fsb-<index>.wav`，与已有源解码 WAV 的字节一致。每个事件随机播放一个样本，均不循环；进食开始前、播种动作准备阶段完成预加载。

### 园艺锄耕坑

`SGwilson.lua` 的 `till` 在 `till_loop` 第 4 帧播放 `dontstarve/wilson/dig`，第 11 帧执行 TILL，第 12 帧播放 `dontstarve_DLC001/creatures/mole/emerge`。分别核对 `dontstarve.fev` 和 `dontstarve_DLC001.fev` 的事件 → sound definition → bank/file_index：

| 事件 | bank | file_index（零基） | vgmstream -s | 引用样本 |
| --- | --- | --- | --- | --- |
| `dontstarve/wilson/dig` | `wilson` | 63–65 | 64–66 | `sfx/wilson/Dig_1.wav` 至 `Dig_3.wav` |
| `dontstarve_DLC001/creatures/mole/emerge` | `mole` | 1–3 | 2–4 | `sfx/creatures/mole_dig_1.wav` 至 `mole_dig_3.wav` |

用 `vgmstream-cli -i -s <index>` 导出至 `public/dst/data/sound/<bank>.fsb-<index>.wav`；六个 WAV 与已有源解码样本字节一致。每个事件随机播放一个未扩展样本，不循环；装备园艺锄时预加载，播放与映射集中在 `sound.ts`。

### 铲子装备与农田垃圾挖掘

`shovel.lua` 的黄金铲子 `equipped` 事件播放 `dontstarve/wilson/equip_item_gold`；`SGwilson.lua` 的 `dig` 在 `shovel_loop` 第 15 帧播放 `dontstarve/wilson/dig` 并执行 DIG。后者沿用园艺锄已核对的 `wilson.fsb` 流 64–66；`farm_soil_debris.lua` 的 `dirt_puff` 对应 `fx.lua` 的 bank `small_puff`、build `smoke_puff_small`、动画 `puff`，没有额外的尘土声音。

核对 `dontstarve.fev`：`equip_item_gold` → sound definition `/__simpleevent_sounddef__/equip_item Copy_204` → `sfx/wilson/equip_goldItem.wav`，bank `wilson`，零基 file_index 114，对应 vgmstream `-s 115`。用 `vgmstream-cli -i -s 115` 导出到 `public/dst/data/sound/wilson.fsb-115.wav`，与源解码样本字节一致；装备资源加载时完成声音预加载，当前装备请求仍有效时播放一次。声音映射和播放沿用 `sound.ts`。


### 香蕉奶昔饮用声音

`preparedfoods.lua:bananajuice` 定义 `fooddrink` 标签；`SGwilson.lua` 的 quickeat 根据该标签选择 `quick_drink_pre → quick_drink`，第 10 帧的 `DoEatSound()` 播放 `dontstarve/wilson/sip`，第 12 帧执行 EAT。动画实际在 `anim/player_actions_eat.zip` 中，不能用 `player_drink.zip` 的长饮用动画替代。

核对源 `dontstarve.fev`：sip 事件引用 sound definition 1712（`/__simpleevent_sounddef__/eat Copy_2184`），文件 `sfx/wilson/player_sip_drink_DST_002.wav`，bank `sfx`，零基 `file_index = 1286`。对应 `vgmstream-cli -m -s 1287` 为单声道 44100 Hz、15014 samples（约 0.340 秒）。按 `-i -s 1287` 导出至 `public/dst/data/sound/sfx.fsb-1287.wav`，由 `sound.ts` 的统一映射预加载、解码和播放。

### 蒸树枝烹饪声音

`prefabs/cookpot.lua:startcookfn` 播放 `dontstarve/common/cookingpot_rattle`，`components/stewer.lua:StartCooking` 关闭容器时播放 `cookingpot_close`，`donecookfn` 停止循环并播放 `cookingpot_finish`。核对源 `dontstarve.fev` 的事件 → sound definition → bank/file_index：

| 事件后缀 | sound definition | bank | file_index（零基） | vgmstream -s |
| --- | --- | --- | --- | --- |
| `cookingpot_rattle` | 246 | `common` | 48–54 | 49–55 |
| `cookingpot_close` | 353 | `common` | 339 | 340 |
| `cookingpot_finish` | 203 | `common` | 300 | 301 |

按 `-i -s <index>` 导出为 `public/dst/data/sound/common.fsb-<index>.wav`，九个 WAV 与源目录已有解码 WAV 的字节一致。七个 rattle 样本选一个，由浏览器循环；关闭和完成声播放一次。锅创建前预加载；每口锅持有独立循环句柄，完成或移除时停止，读档恢复循环，换肤继续使用同一音源。

### 玩家采收制作声

`SGwilson.lua:dolongaction` 进入时播放 `dontstarve/wilson/make_trap`（句柄 `make`），1 秒超时或退出时停止。源 `dontstarve.fev` 事件含 sound definition 1758、1759 两层，分别引用 `sfx/wilson/MakeWhoosh1_1.wav` 至 `_5.wav` 与 `MakeWhoosh2_1.wav` 至 `_5.wav`；bank 均为 `wilson`，零基 `file_index` 为 70–74 和 75–79，对应提取索引 71–75 和 76–80。用已安装 CLI 的 `-h` 核对参数、`-m -s 71 -S 80` 检查 metadata 后，按 `-i` 导出十个 `public/dst/data/sound/wilson.fsb-<index>.wav`；与源目录已有的对应 WAV 字节一致。这些是 112～181 毫秒的短样本。按用户要求让声音跟随采集动画，每个 `build_loop` 周期触发一次双层短音效，每层随机选一个原样本且 `loop=false`；不按 WAV 长度首尾循环，不在跨过多个周期的长帧中集中补播。`dolongaction` 开始／结束仍控制声音的有效区间，准备和结束姿态不重复播放，取消立即停止最近一组音源。映射、预加载和播放继续使用统一 `sound.ts`。

### 捕捉与坍塌补充事件

`butterfly.lua:OnWorked` 使用 `dontstarve/common/butterfly_trap`；`structure_collapse_fx.lua:SetMaterial` 为金属、石头和草墙分别选择 `destroy_metal`、`destroy_stone`、`destroy_straw`。在 `sound/dontstarve.fev` 中核对事件、sound definition 和文件映射：

| 事件 | sound definition | 源样本 | FEV file_index | 提取索引 |
| --- | --- | --- | --- | --- |
| `dontstarve/common/butterfly_trap` | 183 | `sfx/animals/Butterfly_death_1.wav` / `_2.wav` / `_3.wav` | 21 / 22 / 23 | 22 / 23 / 24 |
| `dontstarve/common/destroy_metal` | 264 | `sfx/objects/Destroy_metal.wav` | 59 | 60 |
| `dontstarve/common/destroy_stone` | 265 | `sfx/objects/Destroy_rock.wav` | 60 | 61 |
| `dontstarve/common/destroy_straw` | 477 | `sfx/objects/Destroy_straw.wav` | 62 | 63 |

全部位于 `sound/common.fsb`；先通过 `vgmstream-cli -h` 与 `-m -s` 检查，再以 `-i` 导出 `public/dst/data/sound/common.fsb-<index>.wav`。六份输出均与源目录已有的 `common.fsb#<index>.wav` 字节一致。事件映射仍集中在 `packages/prefab/src/sound.ts`。

### 月树砍伐声音

`moontree.lua` 的 `on_chop_tree` 播放 `dontstarve/wilson/use_axe_tree`，`on_chop_tree_down` 播放 `dontstarve/forest/treeFall`。用 `dontstarve.fev` 解析事件 → sound definition → bank/file_index（提取索引为 `file_index + 1`）：

| 事件 | sound definition | bank 与提取索引 |
| --- | --- | --- |
| `dontstarve/wilson/use_axe_tree` 第 1 层 | 1763 `/common/chop_tree`（`chop_tree_V2_1/2/3.wav`） | `common.fsb` 337、338、339 |
| `dontstarve/wilson/use_axe_tree` 第 2 层 | 1764 `/common/chop_tree_break`（`branchfoley_v2_1..13.wav`） | `sfx.fsb` 1237–1249 |
| `dontstarve/forest/treeFall` | 24 `treeFall_29`（`tree_fall_1.wav`） | `forest.fsb` 9 |

两层同时播放，每层随机选一个样本。共 17 份 WAV 均用 `vgmstream-cli -i -s <index>` 导出到 `public/dst/data/sound/<bank>.fsb-<index>.wav`，并与源目录已有 `<bank>.fsb#<index>.wav` 字节一致。

### 原生草丛采摘声音

`prefabs/grass.lua:onpickedfn` 播放 `dontstarve/wilson/pickup_reeds`。核对 `dontstarve.fev` 的事件 → sound definition 19（`/__simpleevent_sounddef__/pickup_reeds_24`）→ `sfx/wilson/gather_reeds_1.wav` 至 `_4.wav`，bank 为 `wilson`，零基 `file_index` 为 115–118，对应提取索引 116–119。已检查安装 CLI 的 `-h` 与各流 metadata，并以 `-i -s` 导出 `public/dst/data/sound/wilson.fsb-116.wav` 至 `-119.wav`；四份输出与源目录已有解码 WAV 字节一致。统一 `sound.ts` 预加载四个样本，成功采摘时随机播放其中一个，移除草丛时停止其音源。

### 读书：应用造林学

`SGwilson.lua` 的 `book2` 在第 19 帧播放 `dontstarve/common/use_book_light`，第 50 帧播放书本 `castsound`（缺省 `dontstarve/common/book_spell`）并执行 READ，第 51 帧播放 `use_book_close`；`books.lua` 的 `layer_sound` 在第 17 帧以命名句柄 `book_layer_sound` 播放 `wickerbottom_rework/book_spells/silviculture`，读书被打断时 `SetVolume(.5)`。`book_fx.lua` 的失败回调由读者播放 `wickerbottom_rework/book_spells/fail`。核对 `dontstarve.fev` 与 `wickerbottom_rework.fev` 的事件 → sound definition → bank/file_index：

| 事件 | sound definition | bank | file_index（零基） | vgmstream -s | 样本 |
| --- | --- | --- | --- | --- | --- |
| `dontstarve/common/use_book_light` | 1301 | `together` | 480–483 | 481–484 | `DS_wickerbottom_pageturn_1` 至 `_4` |
| `dontstarve/common/use_book_close` | 1280 | `sfx` | 346–349 | 347–350 | `DS_book_close1` 至 `4` |
| `dontstarve/common/book_spell` | 902 | `common` | 147 | 148 | `book_spellcast` |
| `wickerbottom_rework/book_spells/silviculture` 第一层 | 17 | `wickerbottom_rework` | 12 | 13 | `book_silviculture_DST` |
| `wickerbottom_rework/book_spells/silviculture` 第二层 | 23 | `wickerbottom_rework` | 19 | 20 | `book_web_sparkle` |
| `wickerbottom_rework/book_spells/fail` | 16 | `wickerbottom_rework` | 2 | 3 | `book_fail-002` |

按 `-i -s <index>` 导出至 `public/dst/data/sound/<bank>.fsb-<index>.wav`，12 个 WAV 与源目录已有解码样本字节一致。翻页与合书各随机选择一个样本；造林学两层同时播放。读书准备阶段统一预加载，映射集中在 `sound.ts`。

### 拆解魔杖

`prefabs/staff.lua` 的 `destroystructure` 在成功拆解时播放 `dontstarve/common/staff_dissassemble`；魔法材料、布料和树枝分别使用 `destroy_magic`、`destroy_clothing`、`destroy_tool`。核对 `dontstarve.fev` 后的映射如下，均来自 `common.fsb`：

| Lua 事件 | sound definition | FEV file_index | 提取索引 | 源文件 |
| --- | --- | --- | --- | --- |
| `staff_dissassemble` | 926 | 271 | 272 | `sfx/objects/staff_dissassemble.wav` |
| `destroy_magic` | 980 | 188 | 189 | `sfx/objects/destroy_magic_1.wav` |
| `destroy_clothing` | 981 | 187 | 188 | `sfx/objects/destroy_clothing_1.wav` |
| `destroy_tool` | 982 | 189 | 190 | `sfx/objects/destroy_tool_1.wav` |

用安装版本的 `-h` 核对参数，以 `-m -s` 检查 metadata，再以 `-i -s <索引> -o public/dst/data/sound/common.fsb-<索引>.wav` 导出；四份文件均与源目录对应 `common.fsb#<索引>.wav` 字节一致。绿法杖没有自定义 `castsound`，第 13 帧使用 `SGwilson` 的默认 `dontstarve/wilson/use_gemstaff`；提交前统一预加载施法声、材料声、拆解声及耗尽声。

### 剃毛循环声

`SGwilson.lua` 的 `shave` 状态以具名声音 `shave` 播放 `dontstarve/wilson/shave_LP`，退出时 `KillSound("shave")`。用 `fev-events.py` 解析得到 sounddef 82：`sfx/wilson/Shave_1..6.wav`，bank `wilson`，零基 `file_index` 87–92，提取索引 88–93。逐个 `-m -s` 核对 `stream name` 为 `Shave_1`…`Shave_6`，再以 `-i -s 88..93` 导出 `public/dst/data/sound/wilson.fsb-88.wav` 至 `-93.wav`，六份均与源目录已解码的 `wilson.fsb#<index>.wav` 字节一致。`sound.ts` 把它登记为循环声，状态退出和停止时停止音源。

### 温度测量仪建造声

`prefabs/winterometer.lua:onbuilt` 播放 `dontstarve/common/winter_meter_craft`。`dontstarve.fev`（`fev-events.py common/winter_meter_craft`）解析为 sounddef 1331 → `sfx/objects/craftable/Thermal_measurer_craft.wav`，bank `common`、零基 `file_index` 175（提取索引 176）。已用 `-m -s 176` 核对流名 `Thermal_measurer_craft`，以 `-i -s 176` 导出 `public/dst/data/sound/common.fsb-176.wav`，与源目录已有的 `common.fsb#176.wav` 字节一致；事件不循环，映射在 `sound.ts`。

### 灯草采摘完成声

`prefabs/flower_cave.lua:onpickedfn` 在成功采摘时播放 `dontstarve/wilson/pickup_lightbulb`，与 `picking → picked` 同时触发，和玩家的 `make_trap` 操作声分别归属。`fev-events.py sound/dontstarve.fev wilson/pickup_lightbulb` 解析为 sounddef 1023 → `sfx/wilson/Harvest_Plant.wav` → bank `wilson` / 零基 `file_index=66`，提取索引 67。检查安装 CLI 的 `-h`、`-m -s 67`（`Harvest_Plant`，9324 个 44100 Hz 样本），再用 `-i -s 67` 导出 `public/dst/data/sound/wilson.fsb-67.wav`，与源目录已有 `wilson.fsb#67.wav` 字节一致。灯草生成前预加载；每次成功采摘播放一次，取消不触发，移除停止。


### 便便的苍蝇循环声

`poop.lua` 生成、丢弃或读档恢复时拥有 `flies` 子实体；`flies.lua:onfar` 与 `OnWake` 播放 `dontstarve/common/flies`，`onnear`、`OnSleep` 和移除停止具名 `flies` 声音。核对源 `dontstarve.fev`：sound definition 56 → `sfx/objects/Flies_soothed_DST_-001.wav` 至 `_007.wav` → bank `common`，零基 file_index 74～80，提取索引 75～81。

安装 CLI 的 `-h` 已核对，`-m -s 75 -S 81` 显示七个 44100 Hz 单声道样本，长度约 0.785～0.797 秒。以 `-i -s <index> -o public/dst/data/sound/common.fsb-<index>.wav` 导出，七份均与已有源 `common.fsb#<index>.wav` 字节一致。事件映射在统一 `sound.ts`，创建前预加载，浏览器每份苍蝇独立选择一个样本循环，靠近、拾取、燃烧和实体移除停止并断开对应音源。
