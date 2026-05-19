export type Language = "en" | "zh";

export const LANGUAGE_STORAGE_KEY = "roamgrid_language";

const dictionary = {
  en: {
    startExploring: "Start Exploring",
    slogan: "Turn your city into an open-world game.",
    eyebrow: "Real-world map progress",
    previewTag: "150m block grid",
    previewPlace: "China · Zhejiang · Hangzhou",
    exploring: "Exploring {place}",
    nearbyBlocks: "Nearby Blocks",
    waitingLocation: "Waiting for location permission...",
    explorationActive: "Exploration active",
    locationUnavailable: "Location unavailable",
    mapTokenRequired: "Map token required",
    missingMapToken: "Missing NEXT_PUBLIC_MAPBOX_TOKEN. Add it to .env.local to load the map.",
    geolocationUnavailable: "Geolocation is not available in this browser.",
    locationDenied: "Location permission denied. Allow location access to start exploring.",
    noPoints: "No location points recorded yet.",
    gridDiscovered: "GRID DISCOVERED",
    plusOneBlock: "+1 BLOCK",
    finishExploration: "Finish Exploration",
    saving: "Saving...",
    time: "Time",
    dist: "Dist",
    map: "Map",
    blocks: "Blocks",
    noResultTitle: "No exploration result yet",
    noResultBody: "Start a session and finish it to generate your RoamGrid result.",
    missionComplete: "Mission complete",
    territoryClaimed: "New Blocks Unlocked",
    progress: "{place} Progress",
    claimedIn: "You claimed {count} new blocks in {place}.",
    distance: "Distance",
    duration: "Duration",
    explored: "Explored",
    downloadShareCard: "Download Share Card",
    rendering: "Rendering...",
    exploreAgain: "Explore Again",
    blocksClaimed: "Blocks Claimed",
    newBlockClaimed: "New Block Claimed",
    unlockedPlace: "I unlocked a new piece of {place}.",
    progressExplored: "{place} progress · {percent} explored",
    downloadFailed: "Failed to render share card. Try again.",
    supabaseSyncing: "Syncing to Supabase...",
    supabaseSyncFailed: "Supabase sync failed: {error}",
    supabaseSynced: "Supabase synced",
    shareDistance: "Distance",
    shareTime: "Time",
    shareExplored: "Explored",
    previewStatus: "Live position preview",
    previewFallback: "Location preview unavailable"
  },
  zh: {
    startExploring: "开始探索",
    slogan: "把你的城市变成开放世界游戏。",
    eyebrow: "现实世界地图进度",
    previewTag: "150米区块网格",
    previewPlace: "中国 · 浙江省 · 杭州市",
    exploring: "正在探索 {place}",
    nearbyBlocks: "附近区域",
    waitingLocation: "正在等待定位权限...",
    explorationActive: "探索进行中",
    locationUnavailable: "定位不可用",
    mapTokenRequired: "需要地图 Token",
    missingMapToken: "缺少 NEXT_PUBLIC_MAPBOX_TOKEN。请在 .env.local 中添加后加载地图。",
    geolocationUnavailable: "当前浏览器不支持定位。",
    locationDenied: "定位权限已拒绝。请允许定位后开始探索。",
    noPoints: "还没有记录到定位点。",
    gridDiscovered: "发现新区块",
    plusOneBlock: "+1 区块",
    finishExploration: "结束探索",
    saving: "保存中...",
    time: "时间",
    dist: "距离",
    map: "地图",
    blocks: "区块",
    noResultTitle: "还没有探索结果",
    noResultBody: "开始并结束一次探索后，会生成你的 RoamGrid 战绩。",
    missionComplete: "任务完成",
    territoryClaimed: "新区块已解锁",
    progress: "{place} 探索进度",
    claimedIn: "你在 {place} 解锁了 {count} 个新区块。",
    distance: "距离",
    duration: "时长",
    explored: "已探索",
    downloadShareCard: "下载分享卡",
    rendering: "生成中...",
    exploreAgain: "再次探索",
    blocksClaimed: "区块已解锁",
    newBlockClaimed: "新区块已解锁",
    unlockedPlace: "我解锁了 {place} 的一片新区域。",
    progressExplored: "{place} 进度 · 已探索 {percent}",
    downloadFailed: "分享卡生成失败，请重试。",
    supabaseSyncing: "正在同步到 Supabase...",
    supabaseSyncFailed: "Supabase 同步失败：{error}",
    supabaseSynced: "Supabase 已同步",
    shareDistance: "距离",
    shareTime: "时长",
    shareExplored: "已探索",
    previewStatus: "实时位置预览",
    previewFallback: "定位预览不可用"
  }
} as const;

export type TranslationKey = keyof typeof dictionary.en;

export function getInitialLanguage(): Language {
  if (typeof window === "undefined") {
    return "en";
  }

  const saved = getSavedLanguage();
  if (saved) {
    return saved;
  }

  return navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function getSavedLanguage(): Language | null {
  if (typeof window === "undefined") {
    return null;
  }

  const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  return saved === "zh" || saved === "en" ? saved : null;
}

export function saveLanguage(language: Language) {
  window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
}

export function t(
  language: Language,
  key: TranslationKey,
  params: Record<string, string | number> = {}
) {
  let value: string = dictionary[language][key];
  Object.entries(params).forEach(([paramKey, paramValue]) => {
    value = value.replace(`{${paramKey}}`, String(paramValue));
  });
  return value;
}
