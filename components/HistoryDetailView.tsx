"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AccountMenu } from "@/components/AccountMenu";
import { GridPreview, RoutePreview } from "@/components/HistoryRoutePreview";
import { LanguageToggle } from "@/components/LanguageToggle";
import { formatDistance, formatDuration, formatPercentage } from "@/lib/format";
import {
  hasLocalHistorySource,
  hasRemoteHistorySource,
  historyDetailFromResult,
  mergeHistoryDetails
} from "@/lib/history";
import { getInitialLanguage, saveLanguage, type Language } from "@/lib/i18n";
import { deleteLocalExplorationResult, getLocalExplorationResult } from "@/lib/storage";
import {
  deleteRemoteExplorationSession,
  getCurrentAuthUser,
  getRemoteExplorationSession
} from "@/lib/supabase";
import type { AuthUser, HistoryDetail, HistorySource, LocalizedText } from "@/lib/types";

const copy = {
  en: {
    back: "History",
    loading: "Loading route...",
    notFoundTitle: "History not found",
    notFoundBody: "This run is not saved on this device or available in your synced history.",
    loginHint: "Log in to check synced history.",
    login: "Log in",
    distance: "Distance",
    duration: "Time",
    blocks: "Blocks",
    points: "Route points",
    progress: "Progress",
    grids: "Session grids",
    routeUnavailable: "Route unavailable",
    routeStatic: "Location points are too close to form a visible route.",
    delete: "Delete",
    deleting: "Deleting...",
    deleteConfirm: "Delete this history record?",
    deleteFailed: "Failed to delete history: {error}",
    local: "Device",
    remote: "Synced",
    localRemote: "Device + Synced"
  },
  zh: {
    back: "历史",
    loading: "正在加载轨迹...",
    notFoundTitle: "未找到历史记录",
    notFoundBody: "这次探索没有保存在本机，也无法从同步历史中读取。",
    loginHint: "登录后可检查已同步历史。",
    login: "登录",
    distance: "距离",
    duration: "时长",
    blocks: "区块",
    points: "轨迹点",
    progress: "进度",
    grids: "本次方块",
    routeUnavailable: "暂无轨迹",
    routeStatic: "定位点距离太近，无法形成可见轨迹。",
    delete: "删除",
    deleting: "删除中...",
    deleteConfirm: "删除这条历史记录？",
    deleteFailed: "删除历史失败：{error}",
    local: "本机",
    remote: "已同步",
    localRemote: "本机 + 已同步"
  }
} as const;

export function HistoryDetailView() {
  const router = useRouter();
  const params = useParams<{ id?: string | string[] }>();
  const sessionId = getRouteParam(params.id);
  const [language, setLanguage] = useState<Language>("en");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    setLanguage(getInitialLanguage());
  }, []);

  useEffect(() => {
    if (!sessionId) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function loadDetail() {
      setIsLoading(true);
      setError(null);
      setWarning(null);

      const localResult = getLocalExplorationResult(sessionId);
      const localDetail = localResult ? historyDetailFromResult(localResult, "local") : null;
      const authUser = await getCurrentAuthUser();
      if (!isMounted) {
        return;
      }

      setUser(authUser);
      let remoteDetail: HistoryDetail | null = null;

      if (authUser) {
        const remoteResult = await getRemoteExplorationSession(sessionId);
        if (!isMounted) {
          return;
        }

        if (remoteResult.ok) {
          remoteDetail = remoteResult.data;
        } else if (localDetail) {
          setWarning(remoteResult.error);
        } else if (remoteResult.reason !== "not_configured") {
          setError(remoteResult.error);
        }
      }

      setDetail(mergeHistoryDetails(localDetail, remoteDetail));
      setIsLoading(false);
    }

    void loadDetail();

    return () => {
      isMounted = false;
    };
  }, [sessionId]);

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
  }

  async function deleteHistoryItem() {
    if (!detail || !window.confirm(copy[language].deleteConfirm)) {
      return;
    }

    setIsDeleting(true);
    setError(null);

    if (hasRemoteHistorySource(detail.source)) {
      const result = await deleteRemoteExplorationSession(detail.id);
      if (!result.ok) {
        setError(copy[language].deleteFailed.replace("{error}", result.error));
        setIsDeleting(false);
        return;
      }
    }

    if (hasLocalHistorySource(detail.source)) {
      deleteLocalExplorationResult(detail.id);
    }

    router.push("/history");
  }

  const text = copy[language];

  return (
    <main className="min-h-screen overflow-x-hidden px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <nav className="flex items-center justify-between gap-3">
          <Link href="/history" className="text-sm font-black tracking-[0.18em] text-teal-200">
            ROAMGRID / {text.back}
          </Link>
          <div className="flex items-center gap-2">
            <AccountMenu language={language} compact />
            <LanguageToggle language={language} onChange={handleLanguageChange} />
          </div>
        </nav>

        {isLoading ? (
          <p className="mt-10 rounded-lg border border-white/10 bg-black/30 p-5 text-slate-200 shadow-hud">
            {text.loading}
          </p>
        ) : null}

        {!isLoading && !detail ? (
          <section className="mt-10 rounded-lg border border-white/10 bg-black/30 p-6 text-center shadow-hud backdrop-blur-md">
            <h1 className="text-3xl font-black text-white">{text.notFoundTitle}</h1>
            <p className="mx-auto mt-3 max-w-xl text-slate-300">{error ?? text.notFoundBody}</p>
            {!user ? <p className="mt-2 text-sm text-slate-400">{text.loginHint}</p> : null}
            <div className="mt-6 flex flex-wrap justify-center gap-3">
              <Link
                href="/history"
                className="rounded-lg border border-white/10 bg-white/5 px-5 py-3 font-bold text-white transition hover:bg-white/10"
              >
                {text.back}
              </Link>
              {!user ? (
                <Link
                  href="/auth"
                  className="rounded-lg bg-teal-300 px-5 py-3 font-black text-slate-950 shadow-glow"
                >
                  {text.login}
                </Link>
              ) : null}
            </div>
          </section>
        ) : null}

        {detail ? (
          <>
            <header className="mt-10 flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-teal-200">
                  <span>{formatSource(detail.source, language)}</span>
                  <span className="text-slate-600">/</span>
                  <span>{formatDateRange(detail.startedAt, detail.endedAt, language)}</span>
                </div>
                <h1 className="mt-3 break-words text-4xl font-black leading-tight text-white sm:text-5xl">
                  {getLocalizedText(detail.areaTitle, language)}
                </h1>
                <p className="mt-3 break-words text-base leading-7 text-slate-300 sm:text-lg">
                  {getLocalizedText(detail.fullPlacePath, language)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void deleteHistoryItem()}
                disabled={isDeleting}
                className="rounded-lg border border-rose-200/20 bg-rose-300/10 px-5 py-3 font-black text-rose-100 transition hover:bg-rose-300/20 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeleting ? text.deleting : text.delete}
              </button>
            </header>

            {warning ? (
              <p className="mt-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
                {warning}
              </p>
            ) : null}
            {error ? (
              <p className="mt-6 rounded-lg border border-rose-300/20 bg-rose-300/10 p-4 text-sm text-rose-100">
                {error}
              </p>
            ) : null}

            <section className="mt-8 overflow-hidden rounded-lg border border-white/10 bg-black/30 p-4 shadow-hud backdrop-blur-md">
              <RoutePreview
                points={detail.points}
                fallback={text.routeUnavailable}
                staticFallback={text.routeStatic}
                className="h-80"
              />

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
                <DetailStat label={text.distance} value={formatDistance(detail.distanceMeters)} />
                <DetailStat label={text.duration} value={formatDuration(detail.durationSeconds)} />
                <DetailStat label={text.blocks} value={String(detail.blockCount)} />
                <DetailStat label={text.points} value={String(detail.points.length)} />
                <DetailStat label={text.progress} value={formatPercentage(detail.explorationPercentage)} />
              </div>

              <div className="mt-6">
                <div className="mb-3 text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                  {text.grids}
                </div>
                <GridPreview gridIds={detail.discoveredGridIds} />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/28 p-3">
      <div className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-lg font-black text-white">{value}</div>
    </div>
  );
}

function getRouteParam(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

function getLocalizedText(value: LocalizedText, language: Language) {
  return value[language] || value.en;
}

function formatSource(source: HistorySource, language: Language) {
  const text = copy[language];
  if (source === "local_remote") {
    return text.localRemote;
  }

  return source === "remote" ? text.remote : text.local;
}

function formatDateRange(startedAt: string, endedAt: string, language: Language) {
  return `${formatDate(startedAt, language)} - ${formatDate(endedAt, language)}`;
}

function formatDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
