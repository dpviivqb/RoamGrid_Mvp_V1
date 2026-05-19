# RoamGrid 修改意见 2 + 中英文切换落地方案

## Summary
- 目标：在“现实世界游戏 UI”升级基础上，新增中英文切换，并让地图标签跟随语言显示中文或英文。
- 地理归属不只显示城市，统一显示 `国家 / 省份 / 城市`，中英文分别展示。
- 地图中文显示可行：Mapbox 官方示例支持通过 `setLayoutProperty` 动态切换标签语言；若使用 Mapbox Standard Style，也可用 `setConfigProperty` 配置样式语言。当前项目使用 `mapbox://styles/mapbox/dark-v11`，优先采用 `setLayoutProperty` 方案，兼容当前样式。

## Key Changes
- 语言切换：
  - 新增全局语言状态：`en` / `zh`，默认根据 `navigator.language` 判断，中文浏览器默认 `zh`，否则 `en`。
  - 将语言偏好保存到 `localStorage`，key 使用 `roamgrid_language`。
  - 首页、Explore、Result 都加语言切换按钮，建议右上角小型 segmented control：`中 / EN`。
  - 所有核心文案接入本地字典，不引入 i18n 库。

- 地理归属升级：
  - 新增 `PlaceInfo` 数据结构：
    - `country`
    - `region`
    - `city`
    - `label`
    - `localized.en`
    - `localized.zh`
  - Mapbox reverse geocoding 提取 `country / region / place/locality/district`，生成完整层级。
  - 英文示例：`China · Zhejiang · Hangzhou`
  - 中文示例：`中国 · 浙江省 · 杭州市`
  - 缺失字段自动跳过；全部缺失时英文 fallback `Nearby Blocks`，中文 fallback `附近区域`。
  - 旧字段 `cityName` 保留兼容，值使用当前语言或默认英文 label；Supabase `city_name` 继续写 label，不改表结构。

- 地图语言：
  - 当前 `dark-v11` 样式使用 `setLayoutProperty` 遍历 symbol label layer，把 `text-field` 切换到对应 Mapbox 字段。
  - 中文优先字段：`name_zh-Hans`，fallback 到 `name_zh`、`name`。
  - 英文优先字段：`name_en`，fallback 到 `name`.
  - 在 `map.on("load")` 和语言切换时都执行一次 `applyMapLanguage(map, language)`。
  - 若某些图层不支持对应语言字段，保持 fallback，不阻断地图显示。

- 首页 / Explore / Result UI：
  - 首页右侧真实地图风格预览中的地区标签跟随语言显示完整层级。
  - Explore HUD 显示：
    - 英文：`Exploring China · Zhejiang · Hangzhou`
    - 中文：`正在探索 中国 · 浙江省 · 杭州市`
  - 解锁反馈跟随语言：
    - 英文：`GRID DISCOVERED` / `+1 BLOCK`
    - 中文：`发现新区块` / `+1 区块`
  - Result 标题和进度条跟随语言：
    - 英文：`New Blocks Unlocked`
    - 中文：`新区块已解锁`
    - 进度条：`China · Zhejiang · Hangzhou Progress` / `中国 · 浙江省 · 杭州市 探索进度`
  - 分享卡顶部显示 `ROAMGRID + 国家/省份/城市`，地图占至少 50% 高度，底部进度文案跟随语言。

- 保留修改意见 2 的体验升级：
  - 首页右侧从抽象 grid 改为真实地图风格预览。
  - Explore 新增 pulsing blue dot。
  - Fog 减轻，地图不再过黑。
  - grid 改为 150m，探索区约 5km，总 grid 数改为 `34 * 34 = 1156`。
  - Result 巨大化 `+N BLOCKS / +N 区块`，增加进度条。
  - 分享卡重排，地图视觉占比提升。

## Interfaces / Data Updates
- 新增 `lib/i18n.ts`：
  - `type Language = "en" | "zh"`
  - `getInitialLanguage()`
  - `getSavedLanguage()`
  - `saveLanguage(language)`
  - `t(language, key, params?)`
- 新增/更新 `lib/mapbox.ts`：
  - `resolvePlaceInfo(lat, lng): Promise<PlaceInfo>`
  - `formatPlaceLabel(placeInfo, language)`
  - `applyMapLanguage(map, language)`
- 更新 `lib/types.ts`：
  - `PlaceInfo`
  - `ExplorationSession.placeInfo?: PlaceInfo`
  - `ExplorationResult.placeInfo?: PlaceInfo`
- 更新 `lib/grid.ts`：
  - `GRID_SIZE_METERS = 150`
  - `GRID_COLUMNS = 34`
  - `TOTAL_GRID_COUNT = GRID_COLUMNS * GRID_COLUMNS`
  - `buildGridCells` 使用 `GRID_COLUMNS`，不再硬编码 `50`。
- localStorage：
  - 新增 `roamgrid_language`
  - 不迁移旧 result；旧数据没有 `placeInfo` 时用 `cityName` 生成兼容 label。

## Test Plan
- 语言切换：
  - 首页、Explore、Result 点击 `中 / EN` 后所有产品文案切换。
  - 刷新后语言偏好保持。
  - 无定位 result、旧 localStorage result 也能正常显示。
- 地图中文：
  - 中文模式下地图道路/地点标签尽可能显示中文。
  - 英文模式下地图标签切回英文。
  - 不支持中文字段的图层 fallback 到默认 `name`，不报错。
- 地理层级：
  - 定位成功后显示国家、省份、城市，不只显示城市。
  - 字段缺失时自动降级，不出现多余分隔符。
- 体验回归：
  - Pulsing blue dot 可见。
  - 解锁新区块显示 800ms 反馈。
  - Result 有巨大 `+N` 和进度条。
  - 分享卡地图高度约 50%，长地区名不溢出。
- Verification：
  - `npm run lint`
  - `npm run build`
  - 本地访问 `/`、`/explore`、`/result`。
  - 普通窗口和无扩展/隐身窗口分别复测 `t.postMessage` 是否仍出现。

## Assumptions
- 不引入完整 i18n 框架，MVP 用轻量本地字典足够。
- 地图语言优先兼容当前 `dark-v11` 样式；暂不切换到 Mapbox Standard Style，以免改变当前视觉和图层行为。
- Mapbox 标签字段是否完整取决于地图瓦片数据，中文模式会尽力显示中文并 fallback。
- Supabase 表结构不变，地区层级只在 localStorage result 中完整保存。
