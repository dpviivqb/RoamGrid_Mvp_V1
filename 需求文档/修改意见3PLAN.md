# RoamGrid 修改意见 3 工程落地方案

## Summary
- 目标：修复 Result 下载报错、真实定位点显示、Explore Again 定位视角、分享卡布局，并把首页右侧预览升级为用户实时定位地图。
- 核心策略：用真实 Mapbox marker 替代屏幕中心假蓝点；用 Canvas 2D 生成分享卡替代 `html2canvas`；首页使用真实只读地图预览，并在点击开始时做扩展到全屏的过渡动画。
- 保留现有中英文切换、国家/省份/城市层级、150m grid、Mapbox 语言切换、localStorage/Supabase 保存逻辑。

## Key Changes
- Result 下载分享卡报错：
  - 移除分享卡下载对 `html2canvas` 的依赖，改为 `CanvasRenderingContext2D` 稳定绘制分享卡。
  - 新增 `buildShareCardImage(result, language, place): Promise<Blob>`：绘制背景、品牌、地区 pill、巨大 `+N`、地图截图、底部指标卡。
  - 下载逻辑使用 `canvas.toBlob` + `URL.createObjectURL`，失败时显示错误状态，不触发 DOM 截图。
  - 分享卡 DOM 仍保留用于页面展示，但下载图片以 Canvas 结果为准，规避 `webkit-masked-url ... t.postMessage`。

- Explore Again 定位视角：
  - `/explore` 初始化后立即调用一次 `navigator.geolocation.getCurrentPosition`，拿到当前位置后 `jumpTo/flyTo` 到用户坐标。
  - `watchPosition` 继续负责持续追踪；首次定位完成前显示等待状态。
  - 重新进入 `/explore` 时重置当前 session ref、定位节流时间、地图 source，确保新探索不会继承旧视角。

- 玩家定位点真实置于地图：
  - 删除当前固定在屏幕中心的 `PlayerDot` overlay。
  - 新增 Mapbox `Marker`，使用 pulsing blue dot DOM element，并通过 `marker.setLngLat([lng, lat])` 绑定真实经纬度。
  - 用户拖动地图时，蓝点留在真实地图坐标上，不跟随屏幕中心。
  - 定位更新分两层：每次 GPS 更新都刷新 marker；轨迹点/grid 解锁仍按 3 秒节流记录，避免数据过密。

- 分享卡布局修复：
  - 右上角地区 pill 使用固定高度、flex 居中、最大宽度和文本截断，确保文字垂直居中。
  - 底部恢复三个指标卡：距离、时长、已探索百分比；必要时加第四项“区块数”仅用于页面展示，下载图保持三项。
  - 地图区域保持卡片高度约 50%，优先使用 `mapSnapshotDataUrl`，无截图时使用 fallback 地图视觉。
  - 中英文文案都走现有 `t()` 字典，新增下载错误、分享卡指标相关 key。

- 首页实时定位地图与展开动画：
  - 将 `HomeMapPreview` 从假 grid 改成真实 Mapbox 只读预览组件。
  - 首页请求一次当前位置；成功后地图居中用户位置，显示 pulsing marker、示例 route、示例已探索 grid；失败时显示杭州/附近区域 fallback。
  - 点击 `Start Exploring` 不再直接 `<Link>` 跳转，改为按钮触发 `isLaunching`：
    - 预览容器复制为 fixed overlay；
    - 执行 450ms 扩展到全屏动画；
    - 动画完成后 `router.push("/explore")`。
  - Explore 页面正常重新初始化真实地图，视觉上形成“首页地图扩展进入探索”的连续感。

- Mapbox 生命周期稳定性：
  - 拆分 Explore 地图初始化与语言切换 effect，避免切换语言时销毁并重建地图。
  - 统一 cleanup：清理 geolocation watch、unlock timeout、Mapbox marker、Mapbox map。
  - `map.on("error")` 保留日志，同时避免 unmounted 后继续 `setState` 或更新 source。

## Interfaces / Data Updates
- 新增组件/工具：
  - `components/PulsingMarker.ts` 或局部 helper：创建 pulsing marker DOM element。
  - `components/HomeLiveMapPreview.tsx`：首页真实定位地图预览。
  - `lib/share-card.ts`：Canvas 生成分享卡 Blob。
- 更新 `ExploreMap`：
  - `latestPoint` 用于 marker 真实经纬度，不再渲染屏幕中心 overlay。
  - 增加 `centerOnUser(point, mode)`，首次定位使用 `jumpTo`，后续记录点可选 `flyTo`。
- 更新 `ResultView`：
  - 下载按钮调用 `buildShareCardImage`。
  - 页面分享卡底部恢复 `Distance / Time / Explored` 指标。
- 更新 i18n：
  - 新增 `downloadFailed`、`shareDistance`、`shareTime`、`shareExplored` 等中英文 key。
- 依赖：
  - `html2canvas` 不再用于下载流程；可保留依赖以减少本轮风险，后续单独清理。

## Test Plan
- 下载分享卡：
  - 点击 Download Share Card 不再出现 `t.postMessage`。
  - 下载 PNG 中右上地区文字居中，底部有距离、时长、已探索三个指标。
  - 有真实地图截图和无截图旧 result 都可下载。
- Explore 定位：
  - 从 Result 点击 Explore Again 后，`/explore` 首次定位会跳转到用户当前位置。
  - 拖动地图后，蓝点保持在真实地图坐标，不固定在屏幕中心。
  - GPS 更新时 marker 实时移动，轨迹/grid 仍按 3 秒节流记录。
- 首页：
  - 首页右侧显示真实 Mapbox 预览和当前用户位置；无定位权限时显示 fallback。
  - 点击开始探索时预览卡片平滑扩展到全屏，然后进入 `/explore`。
- Regression：
  - 中英文切换后首页、Explore、Result 文案正常。
  - Mapbox 中文/英文标签切换仍工作。
  - `npm run lint`
  - `npm run build`
  - 本地检查 `/`、`/explore`、`/result`。

## Assumptions
- 首页真实地图预览会请求定位；拒绝定位时不阻塞进入探索页。
- 展开动画采用 CSS/React 状态模拟 shared transition，不复用同一个 Mapbox 实例跨路由。
- Canvas 下载方案是本轮修复 `html2canvas`/`postMessage` 问题的主路径。
- Supabase 表结构不变，分享卡图片不上传远端。
