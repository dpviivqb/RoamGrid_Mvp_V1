"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AccountMenu } from "@/components/AccountMenu";
import { HistoryCardPreview } from "@/components/HistoryRoutePreview";
import { LanguageToggle } from "@/components/LanguageToggle";
import { formatDistance, formatDuration, formatPercentage } from "@/lib/format";
import { historySummaryFromResult, mergeHistorySummaries } from "@/lib/history";
import { getInitialLanguage, saveLanguage, type Language } from "@/lib/i18n";
import { getLocalExplorationHistory } from "@/lib/storage";
import {
  getCurrentAuthUser,
  getRemoteExplorationHistoryList,
  getSupabaseBrowserClient
} from "@/lib/supabase";
import type { AuthUser, HistorySource, HistorySummary, LocalizedText } from "@/lib/types";

const copy = {
  en: {
    title: "Exploration History",
    subtitle: "Every saved run on this device, plus synced sessions when you are logged in.",
    loginTitle: "Sync history across devices",
    loginBody: "Local saves work without an account. Log in to include synced history.",
    login: "Log in",
    start: "Explore",
    loading: "Loading history...",
    empty: "No saved explorations yet.",
    distance: "Distance",
    duration: "Time",
    progress: "Progress",
    syncedWarning: "Synced history unavailable: {error}",
    local: "Device",
    remote: "Synced",
    localRemote: "Device + Synced",
    blocks: "Blocks"
  },
  zh: {
    title: "探索历史",
    subtitle: "当前设备保存的所有记录；登录后会合并已同步记录。",
    loginTitle: "跨设备同步历史",
    loginBody: "不登录也会保留本机历史。登录后可查看账号同步记录。",
    login: "登录",
    start: "开始探索",
    loading: "正在加载历史...",
    empty: "还没有保存的探索记录。",
    distance: "距离",
    duration: "时长",
    progress: "进度",
    syncedWarning: "同步历史暂不可用：{error}",
    local: "本机",
    remote: "已同步",
    localRemote: "本机 + 已同步",
    blocks: "区块"
  }
} as const;

export function HistoryView() {
  const [language, setLanguage] = useState<Language>("en");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [items, setItems] = useState<HistorySummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    setLanguage(getInitialLanguage());
  }, []);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    let isMounted = true;

    async function loadHistory() {
      setIsLoading(true);
      setWarning(null);

      const localSummaries = getLocalExplorationHistory().map((result) =>
        historySummaryFromResult(result, "local")
      );
      const authUser = await getCurrentAuthUser();
      if (!isMounted) {
        return;
      }

      setUser(authUser);
      let remoteSummaries: HistorySummary[] = [];

      if (authUser) {
        const remoteResult = await getRemoteExplorationHistoryList();
        if (!isMounted) {
          return;
        }

        if (remoteResult.ok) {
          remoteSummaries = remoteResult.data;
        } else if (remoteResult.reason !== "not_configured") {
          setWarning(copy[language].syncedWarning.replace("{error}", remoteResult.error));
        }
      }

      setItems(mergeHistorySummaries([...remoteSummaries, ...localSummaries]));
      setIsLoading(false);
    }

    void loadHistory();
    const listener = supabase?.auth.onAuthStateChange(() => {
      void loadHistory();
    });

    return () => {
      isMounted = false;
      listener?.data.subscription.unsubscribe();
    };
  }, [language]);

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
  }

  const text = copy[language];

  return (
    <main className="min-h-screen overflow-x-hidden px-4 py-6 sm:px-6">
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

        {!user ? (
          <section className="mt-8 rounded-lg border border-white/10 bg-black/28 p-5 shadow-hud backdrop-blur-md">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-black text-white">{text.loginTitle}</h2>
                <p className="mt-1 text-sm text-slate-300">{text.loginBody}</p>
              </div>
              <Link
                href="/auth"
                className="inline-flex shrink-0 rounded-lg border border-teal-200/20 bg-teal-300/12 px-4 py-3 text-sm font-black text-teal-100 transition hover:bg-teal-300/20"
              >
                {text.login}
              </Link>
            </div>
          </section>
        ) : null}

        {warning ? (
          <p className="mt-6 rounded-lg border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">
            {warning}
          </p>
        ) : null}

        {isLoading ? (
          <p className="mt-10 rounded-lg border border-white/10 bg-black/30 p-5 text-slate-200 shadow-hud">
            {text.loading}
          </p>
        ) : null}

        {!isLoading && items.length === 0 ? (
          <p className="mt-10 rounded-lg border border-white/10 bg-black/30 p-5 text-slate-200 shadow-hud">
            {text.empty}
          </p>
        ) : null}

        {!isLoading && items.length > 0 ? (
          <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
              <HistoryCard key={item.id} item={item} language={language} />
            ))}
          </section>
        ) : null}
      </div>
    </main>
  );
}

function HistoryCard({ item, language }: { item: HistorySummary; language: Language }) {
  const text = copy[language];

  return (
    <Link
      href={`/history/${item.id}`}
      className="group flex min-w-0 flex-col rounded-lg border border-white/10 bg-black/30 p-3 shadow-hud backdrop-blur-md transition hover:border-teal-200/40 hover:bg-white/5"
    >
      <HistoryCardPreview snapshot={item.mapSnapshotDataUrl} blockCount={item.blockCount} />
      <div className="mt-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-black text-white">
            {getLocalizedText(item.areaTitle, language)}
          </h2>
          <p className="mt-1 line-clamp-2 min-h-[2.5rem] text-sm leading-5 text-slate-400">
            {getLocalizedText(item.parentPath, language)}
          </p>
        </div>
        <div className="shrink-0 rounded-md border border-teal-200/30 bg-teal-300/10 px-3 py-2 text-sm font-black text-teal-100">
          +{item.blockCount}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-slate-500">
        <span>{formatDate(item.endedAt, language)}</span>
        <span>{formatSource(item.source, language)}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <HistoryStat label={text.distance} value={formatDistance(item.distanceMeters)} />
        <HistoryStat label={text.duration} value={formatDuration(item.durationSeconds)} />
        <HistoryStat label={text.progress} value={formatPercentage(item.explorationPercentage)} />
      </div>
    </Link>
  );
}

function HistoryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/24 px-2 py-2">
      <div className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-black text-white">{value}</div>
    </div>
  );
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

function formatDate(value: string, language: Language) {
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
