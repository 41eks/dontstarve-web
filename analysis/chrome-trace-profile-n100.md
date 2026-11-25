# n100 Chrome 运行时性能实测

在 n100 的 GitHub Actions 服务账号下，使用 Intel UHD、Chromium `153.0.8010.12`，通过 Vite 测试服务加载地面和洞穴存档。游戏代码基于 `a51b1efc`。两个场景均在 1280 × 720 下原地运行，完成 15 秒帧率和内存采样后，再各录制约 5 秒 Chrome trace。

| 存档 | trace 帧数 | trace 内平均 FPS | rAF 回调中位耗时 | rAF 回调 P99 | 主线程占用 | GC 总耗时 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 地面 | 300 | 59.8 | 8.6 ms | 14.2 ms | 62% | 22 ms |
| 洞穴 | 276 | 55.3 | 7.9 ms | 13.8 ms | 52% | 115 ms |

两份主线程 CPU profile 中，最重的游戏调用路径是 `renderSceneWithPasses`，包含子调用的采样耗时分别为 4.98 和 4.06 ms／帧。`updateEntities` 分别占 1.86 和 2.20 ms／帧。洞穴最慢的一次 rAF 回调耗时 50.3 ms，其中 49.7 ms 的 CPU profile 采样落在渲染调用链上。

表中 rAF 回调耗时衡量主线程执行，平均 FPS 按 trace 中的帧数和经过时间计算。Chrome 会记录 GPU 线程与合成事件，表中的 CPU 采样指标只描述主线程。

CI 在 `analysis/ci/chrome-traces/` 生成每个存档的 `.trace.json.gz` 和 Markdown 分析。Chrome DevTools 的 Performance 面板可导入压缩 trace 查看交互式火焰图。Markdown 包含 `scripts/chrome-trace-profile.py` 的 `summary` 和 `threads` 输出。
