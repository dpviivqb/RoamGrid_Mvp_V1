# RoamGrid 产品气质升级落地方案

## Summary
- 目标：把当前“技术 Demo / 数据看板感”的 RoamGrid，改成“现实世界版开地图游戏”的产品体验。
- 保留现有核心功能：定位、轨迹、100m grid、HUD、Result、分享卡、localStorage、Supabase 可选同步。
- 重点改造三件事：地图成为视觉中心、已探索区域有“点亮/占领”反馈、Result 变成“战绩/成就页”。

## Key Changes
- Explore 页面改成游戏 HUD：
  - 缩小顶部统计卡，改为更轻的悬浮 HUD，避免遮挡地图。
  - 增加顶部动态文案，例如 `Exploring Hangzhou` / `城区探索中`，城市名来自首次定位后的 Mapbox reverse geocoding，失败则显示 `Exploring nearby blocks`。
  - 地图仍全屏，HUD、状态、Finish 按钮全部悬浮；视觉中心始终是地图和被点亮的 grid。

- 地图点亮与迷雾增强：
  - Mapbox 图层增加 `discovered-grid-glow` 外发光线层、亮色 fill 层、边缘 line 层。
  - 新解锁 grid 增加短暂 pulse/fade 状态，用本地 state 记录最近解锁的 grid id，并在地图源数据里标记 `isNew`。
  - 未探索区域继续用暗色全屏 overlay 和径向 fog；降低纯 dashboard 背景感，让地图更像“被雾覆盖的世界”。
  - 路线线条保留霓虹蓝，但增加 halo/blur 线层，强化速度感。

- Result 页面改成成就页：
  - 主标题从 `Exploration complete` 改为 `New Blocks Unlocked` 或 `District Expanded`。
  - 页面核心视觉改为大数字：`+N BLOCKS`。
  - 次级文案改为城市归属感表达：`You claimed N new blocks in Hangzhou.`、`Hangzhou explored: X%`。
  - 原来的 Distance / Duration / Explored 统计保留，但降级为底部小型战报，不再是页面主角。

- 分享卡使用真实地图：
  - 在 Explore 点击 `Finish Exploration` 时，通过 Mapbox canvas 截图生成 `mapSnapshotDataUrl`，随 result 存入 `roamgrid_last_result`。
  - Map 初始化增加 `preserveDrawingBuffer: true`，保证 `map.getCanvas().toDataURL("image/png")` 可用。
  - Result 分享卡优先展示真实地图截图；如果截图失败，才 fallback 到当前抽象 grid 图。
  - 分享卡文案改成“我今天解锁了这片区域”：突出 `+N BLOCKS`、城市名、探索百分比，弱化距离。

## Interfaces / Data Updates
- 扩展 `ExplorationSession` / `ExplorationResult`：
  - `cityName: string` 从默认 `Unknown City` 升级为 reverse geocoding 结果。
  - 新增可选字段 `mapSnapshotDataUrl?: string`，用于 Result 和分享卡展示真实地图截图。
  - 新增可选字段 `newlyClaimedGridCount?: number`，MVP 中等同本次 session 解锁 grid 数。
- 新增工具函数：
  - `resolveCityName(lat, lng): Promise<string>`：调用 Mapbox geocoding，优先取 place/locality/district，失败返回 `Nearby Blocks`。
  - `captureMapSnapshot(map): string | null`：安全读取 Mapbox canvas data URL，失败不阻断结束流程。
- Supabase 暂不新增列，避免表结构迁移；城市名继续写入现有 `city_name`，截图仅保存在 localStorage。

## Test Plan
- Explore 体验：
  - 定位成功后显示 `Exploring <city>`，Mapbox geocoding 失败时显示 fallback 文案。
  - 新 grid 解锁时地图区域更亮、有 glow/pulse，HUD 不遮挡主要地图。
  - Finish 后仍能停止定位、保存 result、跳转 `/result`。
- Result 体验：
  - 页面主视觉显示 `+N BLOCKS` 和城市归属文案。
  - 真实地图截图存在时，分享卡和结果页使用截图。
  - 截图失败或旧数据无截图时，使用 fallback grid visual，不崩溃。
- Regression：
  - `npm run lint`
  - `npm run build`
  - 无 Mapbox token、定位拒绝、无 result、本地旧 result 数据都能正常显示。
  - Supabase env 存在时，原有 session / points / grids 保存流程不受影响。

## Assumptions
- 不引入新的 UI 框架或动画库，只用 Tailwind、CSS animation 和 Mapbox layer paint 实现。
- 城市识别使用现有 `NEXT_PUBLIC_MAPBOX_TOKEN` 调 Mapbox geocoding，不新增环境变量。
- 真实地图截图优先在 Explore 结束瞬间捕获，避免 Result 页重新加载地图或依赖服务端截图。
- 本轮只做产品气质升级，不改变 grid 尺寸、探索百分比算法、Supabase 表结构或 Auth 策略。
