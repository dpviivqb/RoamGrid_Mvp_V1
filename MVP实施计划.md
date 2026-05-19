# RoamGrid MVP 实施计划

## Summary

- 创建完整的 `Next.js + TypeScript + Tailwind CSS` App Router 项目，实现 `RoamGrid` MVP。
- MVP 主链路：`/` 首页 -> `/explore` 实时定位探索 -> 轨迹与 100m grid 解锁 -> HUD -> `/result` 结果页与分享卡。
- 数据策略：先用 `localStorage` 保证前端闭环；如检测到 Supabase 环境变量，再同步保存 `session / points / grids`。

## Key Changes

- 使用 `mapbox-gl` 展示全屏地图、实时路线和已探索 grid。
- 使用 `navigator.geolocation.watchPosition` 记录定位，3 秒节流写入当前 session。
- 使用 5km x 5km 探索区域、100m grid、2500 总格子计算探索百分比。
- 使用 `html2canvas` 在结果页下载分享卡。
- 添加 `.env.example` 和 `README.md` 说明 Mapbox 与 Supabase 配置。

## Data

- `localStorage` keys:
  - `roamgrid_anonymous_id`
  - `roamgrid_current_session`
  - `roamgrid_last_result`
  - `roamgrid_discovered_grids`
- Supabase tables:
  - `exploration_sessions`
  - `location_points`
  - `discovered_grids`

## Test Plan

- 运行 `npm install` 和 `npm run dev`。
- 测试无 Mapbox token、定位拒绝、定位允许、轨迹更新、HUD 更新、结束探索、结果页读取和分享卡下载。
- 配置 Supabase 后确认 session、points、grids 可写入。
