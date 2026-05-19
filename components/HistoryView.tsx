"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { LanguageToggle } from "@/components/LanguageToggle";
import { buildGridCells } from "@/lib/grid";
import { formatDistance, formatDuration, formatPercentage } from "@/lib/format";
import { getInitialLanguage, saveLanguage, type Language } from "@/lib/i18n";
import {
  getCurrentAuthUser,
  getRemoteExplorationHistory,
  getSupabaseBrowserClient
} from "@/lib/supabase";
import type { AuthUser, LocationPoint, RemoteExplorationHistoryItem } from "@/lib/types";

const copy = {
  en: {
    title: "Exploration History",
    subtitle: "Your synced sessions, routes, and discovered blocks.",
    loginTitle: "Log in to view synced history",
    loginBody: "Anonymous exploration still works, but cross-device history needs an account.",
    login: "Log in",
    start: "Explore",
    loading: "Loading history...",
    empty: "No synced sessions yet.",
    distance: "Distance",
    duration: "Duration",
    blocks: "Blocks",
    progress: "Progress",
    points: "Route points",
    grids: "Session grids",
    routeUnavailable: "Route unavailable"
  },
  zh: {
    title: "探索历史",
    subtitle: "已同步的探索记录、轨迹和方块。",
    loginTitle: "登录后查看同步历史",
    loginBody: "匿名探索仍然可用，但跨设备历史需要账号。",
    login: "登录",
    start: "开始探索",
    loading: "正在加载历史...",
    empty: "还没有已同步的探索记录。",
    distance: "距离",
    duration: "时长",
    blocks: "区块",
    progress: "进度",
    points: "轨迹点",
    grids: "本次方块",
    routeUnavailable: "暂无轨迹"
  }
} as const;

export function HistoryView() {
  const [language, setLanguage] = useState<Language>("en");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [items, setItems] = useState<RemoteExplorationHistoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLanguage(getInitialLanguage());
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let isMounted = true;

    async function loadUserAndHistory() {
      setIsLoading(true);
      setError(null);
      const authUser = await getCurrentAuthUser();
      if (!isMounted) {
        return;
      }

      setUser(authUser);
      if (!authUser) {
        setItems([]);
        setSelectedId(null);
        setIsLoading(false);
        return;
      }

      const result = await getRemoteExplorationHistory();
      if (!isMounted) {
        return;
      }

      if (!result.ok) {
        setError(result.error);
        setItems([]);
        setSelectedId(null);
      } else {
        setItems(result.data);
        setSelectedId(result.data[0]?.id ?? null);
      }
      setIsLoading(false);
    }

    void loadUserAndHistory();
    const listener = supabase?.auth.onAuthStateChange(() => {
      void loadUserAndHistory();
    });

    return () => {
      isMounted = false;
      listener?.data.subscription.unsubscribe();
    };
  }, []);

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
  }

  const text = copy[language];
  const selectedItem = useMemo(
    () => items.find((item) => item.id === selectedId) ?? items[0],
    [items, selectedId]
  );

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <nav className="flex items-center justify-between gap-3">
          <Link href="/" className="text-sm font-black tracking-[0.18em] text-teal-200">
            ROAMGRID
          </Link>
          <div className="flex items-center gap-2">
            <AccountMenu language={language} compact />
            <LanguageToggle language={language} onChange={handleLanguageChange} />
          </div>
        </nav>

        <header className="mt-10 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-4xl font-black text-white sm:text-5xl">{text.title}</h1>
            <p className="mt-3 max-w-2xl text-slate-300">{text.subtitle}</p>
          </div>
          <Link
            href="/explore"
            className="inline-flex rounded-lg bg-teal-300 px-5 py-3 font-black text-slate-950 shadow-glow"
          >
            {text.start}
          </Link>
        </header>

        {!user && !isLoading ? (
          <section className="mt-10 rounded-lg border border-white/10 bg-black/30 p-6 text-center shadow-hud backdrop-blur-md">
            <h2 className="text-2xl font-black text-white">{text.loginTitle}</h2>
            <p className="mx-auto mt-3 max-w-xl text-slate-300">{text.loginBody}</p>
            <Link
              href="/auth"
              className="mt-6 inline-flex rounded-lg bg-teal-300 px-5 py-3 font-black text-slate-950 shadow-glow"
            >
              {text.login}
            </Link>
          </section>
        ) : null}

        {isLoading ? (
          <p className="mt-10 rounded-lg border border-white/10 bg-black/30 p-5 text-slate-200 shadow-hud">
            {text.loading}
          </p>
        ) : null}

        {error ? (
          <p className="mt-10 rounded-lg border border-amber-300/20 bg-amber-300/10 p-5 text-amber-100">
            {error}
          </p>
        ) : null}

        {user && !isLoading && !error && items.length === 0 ? (
          <p className="mt-10 rounded-lg border border-white/10 bg-black/30 p-5 text-slate-200 shadow-hud">
            {text.empty}
          </p>
        ) : null}

        {user && items.length > 0 ? (
          <section className="mt-8 grid gap-5 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-3">
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={
                    item.id === selectedItem?.id
                      ? "w-full rounded-lg border border-teal-200/40 bg-teal-300/12 p-4 text-left shadow-hud"
                      : "w-full rounded-lg border border-white/10 bg-black/28 p-4 text-left shadow-hud transition hover:bg-white/5"
                  }
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-lg font-black text-white">
                        {item.adminAreaName ?? item.cityName ?? "RoamGrid"}
                      </div>
                      <div className="mt-1 text-sm text-slate-400">
                        {formatDate(item.endedAt, language)}
                      </div>
                    </div>
                    <div className="text-right text-sm font-black text-teal-200">
                      +{item.discoveredGridCount}
                    </div>
                  </div>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <HistoryStat label={text.distance} value={formatDistance(item.distanceMeters)} />
                    <HistoryStat label={text.duration} value={formatDuration(item.durationSeconds)} />
                    <HistoryStat label={text.progress} value={formatPercentage(item.explorationPercentage)} />
                  </div>
                </button>
              ))}
            </div>

            {selectedItem ? (
              <div className="rounded-lg border border-white/10 bg-black/30 p-4 shadow-hud backdrop-blur-md">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-2xl font-black text-white">
                      {selectedItem.adminAreaName ?? selectedItem.cityName ?? "RoamGrid"}
                    </h2>
                    <p className="mt-1 text-sm text-slate-400">
                      {formatDate(selectedItem.startedAt, language)} - {formatDate(selectedItem.endedAt, language)}
                    </p>
                  </div>
                  <div className="rounded-md border border-teal-200/30 bg-teal-300/10 px-3 py-2 text-sm font-black text-teal-100">
                    +{selectedItem.discoveredGridCount}
                  </div>
                </div>

                <RoutePreview points={selectedItem.points} fallback={text.routeUnavailable} />

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <DetailStat label={text.distance} value={formatDistance(selectedItem.distanceMeters)} />
                  <DetailStat label={text.duration} value={formatDuration(selectedItem.durationSeconds)} />
                  <DetailStat label={text.blocks} value={String(selectedItem.discoveredGridCount)} />
                  <DetailStat label={text.points} value={String(selectedItem.points.length)} />
                </div>

                <div className="mt-5">
                  <div className="mb-2 text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                    {text.grids}
                  </div>
                  <GridPreview gridIds={selectedItem.discoveredGridIds} />
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/24 px-2 py-2">
      <div className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-black text-white">{value}</div>
    </div>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/28 p-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 text-lg font-black text-white">{value}</div>
    </div>
  );
}

function RoutePreview({ points, fallback }: { points: LocationPoint[]; fallback: string }) {
  if (points.length < 2) {
    return (
      <div className="mt-5 grid h-64 place-items-center rounded-lg border border-white/10 bg-slate-950 text-sm text-slate-400">
        {fallback}
      </div>
    );
  }

  const projected = projectPoints(points);
  const linePoints = projected.map((point) => `${point.x},${point.y}`).join(" ");
  const first = projected[0];
  const last = projected[projected.length - 1];

  return (
    <div className="mt-5 overflow-hidden rounded-lg border border-white/10 bg-slate-950">
      <svg viewBox="0 0 640 360" className="h-64 w-full">
        <defs>
          <pattern id="history-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(148, 163, 184, 0.14)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="640" height="360" fill="url(#history-grid)" />
        <polyline points={linePoints} fill="none" stroke="#38bdf8" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
        <polyline points={linePoints} fill="none" stroke="#67e8f9" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" opacity="0.18" />
        <circle cx={first.x} cy={first.y} r="8" fill="#5eead4" />
        <circle cx={last.x} cy={last.y} r="10" fill="#f0fdfa" stroke="#38bdf8" strokeWidth="4" />
      </svg>
    </div>
  );
}

function GridPreview({ gridIds }: { gridIds: string[] }) {
  const cells = buildGridCells(gridIds.slice(0, 60));
  if (cells.length === 0) {
    return <div className="text-sm text-slate-400">-</div>;
  }

  return (
    <div className="grid max-h-48 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4">
      {cells.map((cell) => (
        <div
          key={cell.id}
          className="truncate rounded-md border border-teal-200/20 bg-teal-300/10 px-2 py-2 text-xs font-bold text-teal-100"
          title={cell.id}
        >
          {cell.id}
        </div>
      ))}
    </div>
  );
}

function projectPoints(points: LocationPoint[]) {
  const padding = 28;
  const width = 640;
  const height = 360;
  const lngs = points.map((point) => point.lng);
  const lats = points.map((point) => point.lat);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const lngSpan = Math.max(maxLng - minLng, 0.00001);
  const latSpan = Math.max(maxLat - minLat, 0.00001);

  return points.map((point) => ({
    x: padding + ((point.lng - minLng) / lngSpan) * (width - padding * 2),
    y: height - padding - ((point.lat - minLat) / latSpan) * (height - padding * 2)
  }));
}

function formatDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
