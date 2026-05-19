# RoamGrid MVP 实施计划

## Summary
- 在当前空项目根目录创建完整的 `Next.js + TypeScript + Tailwind CSS` App Router 项目，实现 `RoamGrid` MVP。
- 计划文件保存目标：项目根目录 `MVP实施计划.md`。当前处于计划模式，不直接写文件；进入执行模式后第一步将把本计划写入该文件。
- MVP 主链路：`/` 首页 → `/explore` 实时定位探索 → 轨迹与 100m grid 解锁 → HUD → `/result` 结果页与分享卡。
- 数据策略：先用 `localStorage` 保证前端闭环；如检测到 Supabase 环境变量，再同步保存 `session / points / grids`。

## Key Changes
- 初始化项目：
  - 使用 Next.js App Router、TypeScript、Tailwind CSS。
  - 安装 `mapbox-gl`、`@supabase/supabase-js`、`html2canvas`、必要类型依赖。
  - 添加 `.env.example`，包含 `NEXT_PUBLIC_MAPBOX_TOKEN`、`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`。
  - 添加 `README.md`，说明本地启动、Mapbox token、Supabase 可选配置和手机定位测试方式。

- 页面与体验：
  - `/`：展示 `RoamGrid`、标语 `Turn your city into an open-world game.`、`Start Exploring` 按钮，点击进入 `/explore`。
  - `/explore`：全屏 Mapbox 地图，请求定位权限，使用 `navigator.geolocation.watchPosition` 记录位置，绘制实时蓝色路线、已探索 grid 高亮、暗色迷雾效果、顶部 HUD、底部 `Finish Exploration`。
  - `/result`：展示距离、解锁 grid 数、探索百分比、持续时间；生成分享卡；提供 `Download Share Card` 和 `Explore Again`。

- 核心逻辑：
  - 生成并持久化 `anonymous_id` 到 `localStorage`。
  - 每 3-5 秒记录 GPS 点，保存当前探索 session。
  - grid 使用近似米制算法：起点周围 5km x 5km，100m grid，`50 * 50 = 2500` 总格子。
  - 实现 `getGridId(lat, lng)`、`getGridPolygon(gridId)`、`calculateDistance(points)`、`calculateExplorationPercentage(discoveredGridCount, totalGridCount)`。
  - 结束探索时停止 `watchPosition`，写入本地 summary，并跳转 `/result`。
  - 若 Supabase env 存在，则写入 `exploration_sessions`、`location_points`、`discovered_grids`；不存在则静默只用本地数据。

## Public Interfaces / Data
- `localStorage` keys：
  - `roamgrid_anonymous_id`
  - `roamgrid_current_session`
  - `roamgrid_last_result`
  - `roamgrid_discovered_grids`
- Supabase 表：
  - `exploration_sessions(id, anonymous_id, started_at, ended_at, city_name, distance_meters, discovered_grid_count, exploration_percentage)`
  - `location_points(id, session_id, lat, lng, timestamp)`
  - `discovered_grids(id, anonymous_id, grid_id, discovered_at)`
- 环境变量：
  - `NEXT_PUBLIC_MAPBOX_TOKEN` 必需用于地图。
  - `NEXT_PUBLIC_SUPABASE_URL` 和 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 可选，用于远端保存。

## Test Plan
- 本地运行：
  - `npm install`
  - `npm run dev`
  - 打开 `/`、`/explore`、`/result`，确认页面无构建错误。
- 浏览器测试：
  - 无 Mapbox token 时显示清晰错误状态。
  - 定位拒绝时显示权限错误，不崩溃。
  - 定位允许时地图定位到当前位置，轨迹线随位置更新。
  - 移动后 HUD 的时间、距离、探索百分比、grid 数正确变化。
  - 点击 `Finish Exploration` 后停止定位并跳转 `/result`。
  - `/result` 能读取上次结果，下载分享卡。
- 数据测试：
  - 未配置 Supabase 时，localStorage 闭环可用。
  - 配置 Supabase 后，session、points、grids 正常插入。
  - 刷新页面后 anonymous_id 和已发现 grids 保持一致。

## Assumptions
- 使用 `npm`，并确保最终支持 `npm run dev`。
- 当前项目为空目录，因此可以在根目录直接初始化 Next.js 项目。
- Auth 不做，用户身份仅使用 localStorage UUID。
- 城市名称先不依赖反向地理编码；MVP 可显示默认城市名或 `Unknown City`。
- 分享卡使用前端 DOM + `html2canvas` 生成，不做服务端渲染图片。
