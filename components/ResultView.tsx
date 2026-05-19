"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountMenu } from "@/components/AccountMenu";
import { LanguageToggle } from "@/components/LanguageToggle";
import { formatDistance, formatDuration, formatPercentage } from "@/lib/format";
import { getInitialLanguage, saveLanguage, t, type Language } from "@/lib/i18n";
import { formatPlaceLabel } from "@/lib/mapbox";
import { buildShareCardImage } from "@/lib/share-card";
import { saveResultToSupabase } from "@/lib/supabase";
import { getLastResult, saveLastResult } from "@/lib/storage";
import type { ExplorationResult } from "@/lib/types";

export function ResultView() {
  const router = useRouter();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hasAttemptedSyncRef = useRef(false);
  const [result, setResult] = useState<ExplorationResult | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [isDownloading, setIsDownloading] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    setLanguage(getInitialLanguage());
    setResult(getLastResult());
  }, []);

  useEffect(() => {
    if (!result || result.supabaseSyncedAt || hasAttemptedSyncRef.current) {
      return;
    }

    hasAttemptedSyncRef.current = true;
    setIsSyncing(true);

    void saveResultToSupabase(result)
      .then((syncResult) => {
        const nextResult = syncResult.ok
          ? {
              ...result,
              userId: syncResult.userId,
              syncMode: syncResult.syncMode,
              supabaseSyncedAt: syncResult.syncedAt,
              supabaseSyncError: undefined
            }
          : { ...result, supabaseSyncError: syncResult.error };

        saveLastResult(nextResult);
        setResult(nextResult);
      })
      .finally(() => {
        setIsSyncing(false);
      });
  }, [result]);

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
  }

  async function downloadShareCard() {
    if (!result) {
      return;
    }

    setIsDownloading(true);
    setDownloadError(null);

    try {
      const place = getResultPlace(result, language);
      const blob = await buildShareCardImage(result, language, place);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = "roamgrid-share-card.png";
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setDownloadError(t(language, "downloadFailed"));
    } finally {
      setIsDownloading(false);
    }
  }

  if (!result) {
    return (
      <main className="grid min-h-screen place-items-center px-6 text-center">
        <div className="max-w-md rounded-lg border border-white/10 bg-white/5 p-6 shadow-hud">
          <h1 className="text-2xl font-black text-white">{t(language, "noResultTitle")}</h1>
          <p className="mt-3 text-slate-300">{t(language, "noResultBody")}</p>
          <div className="mt-5 flex justify-center">
            <LanguageToggle language={language} onChange={handleLanguageChange} />
          </div>
          <Link
            href="/explore"
            className="mt-6 inline-flex rounded-lg bg-teal-300 px-5 py-3 font-bold text-slate-950 shadow-glow"
          >
            {t(language, "startExploring")}
          </Link>
        </div>
      </main>
    );
  }

  const claimedBlocks = result.newlyClaimedGridCount ?? result.discoveredGridIds.length;
  const place = getResultPlace(result, language);

  return (
    <main className="min-h-screen overflow-hidden px-4 py-6 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[0.88fr_1.12fr]">
        <section className="flex flex-col justify-center py-4">
          <div className="mb-8 grid gap-3 sm:grid-cols-[auto_1fr] sm:items-start">
            <Link href="/" className="text-sm font-bold tracking-[0.18em] text-teal-200 sm:pt-3">
              ROAMGRID
            </Link>
            <div className="flex min-w-0 flex-wrap items-start justify-start gap-2 sm:justify-end">
              <AccountMenu language={language} compact showEmail={false} />
              <LanguageToggle language={language} onChange={handleLanguageChange} />
            </div>
          </div>
          <p className="text-sm font-black uppercase tracking-[0.24em] text-teal-200">
            {t(language, "missionComplete")}
          </p>
          <h1 className="mt-3 text-4xl font-black leading-tight text-white sm:text-6xl">
            {t(language, "territoryClaimed")}
          </h1>
          <div className="mt-6 text-8xl font-black leading-none text-teal-200 drop-shadow-[0_0_28px_rgba(45,212,191,0.55)] sm:text-9xl">
            +{claimedBlocks}
          </div>
          <div className="mt-1 text-2xl font-black uppercase tracking-[0.14em] text-white">
            {language === "zh" ? "区块" : "Blocks"}
          </div>
          <p className="mt-5 max-w-xl text-lg leading-7 text-slate-300">
            {t(language, "claimedIn", { count: claimedBlocks, place })}
          </p>

          <ProgressBar
            label={t(language, "progress", { place })}
            value={result.explorationPercentage}
          />

          <div className="mt-8 grid grid-cols-3 gap-3">
            <ResultStat label={t(language, "distance")} value={formatDistance(result.distanceMeters)} />
            <ResultStat label={t(language, "duration")} value={formatDuration(result.durationSeconds)} />
            <ResultStat label={t(language, "explored")} value={formatPercentage(result.explorationPercentage)} />
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={downloadShareCard}
              disabled={isDownloading}
              className="rounded-lg bg-teal-300 px-5 py-3 font-black text-slate-950 shadow-glow transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isDownloading ? t(language, "rendering") : t(language, "downloadShareCard")}
            </button>
            <button
              type="button"
              onClick={() => router.push("/explore")}
              className="rounded-lg border border-white/15 bg-white/5 px-5 py-3 font-bold text-white transition hover:bg-white/10"
            >
              {t(language, "exploreAgain")}
            </button>
          </div>
          {downloadError ? <p className="mt-3 text-sm text-rose-200">{downloadError}</p> : null}
          {isSyncing ? (
            <p className="mt-3 text-sm font-semibold text-teal-200">
              {t(language, "supabaseSyncing")}
            </p>
          ) : null}
          {result.supabaseSyncError ? (
            <p className="mt-3 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
              {t(language, "supabaseSyncFailed", { error: result.supabaseSyncError })}
            </p>
          ) : null}
          {result.supabaseSyncedAt ? (
            <p className="mt-3 text-sm font-semibold text-teal-200">
              {t(language, "supabaseSynced")}
            </p>
          ) : null}
        </section>

        <section className="flex items-center justify-center">
          <ShareCard refElement={cardRef} result={result} language={language} place={place} />
        </section>
      </div>
    </main>
  );
}

function ResultStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/35 p-4 shadow-hud backdrop-blur">
      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {label}
      </div>
      <div className="mt-2 text-2xl font-black text-white">{value}</div>
    </div>
  );
}

function getResultPlace(result: ExplorationResult, language: Language) {
  return (
    result.adminArea?.localName ??
    result.adminArea?.name ??
    formatPlaceLabel(result.placeInfo, language) ??
    result.cityName
  );
}

function ProgressBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="mt-7 rounded-lg border border-white/10 bg-black/30 p-4 shadow-hud backdrop-blur">
      <div className="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
        <span className="truncate">{label}</span>
        <span className="text-teal-200">{formatPercentage(value)}</span>
      </div>
      <div className="mt-3 h-4 overflow-hidden rounded-full border border-white/12 bg-slate-700/45 shadow-inner shadow-black/40">
        <div
          className="h-full rounded-full bg-teal-300 shadow-[0_0_22px_rgba(45,212,191,0.8)]"
          style={{ width: `${Math.max(3, Math.min(100, value))}%` }}
        />
      </div>
    </div>
  );
}

function ShareCard({
  refElement,
  result,
  language,
  place
}: {
  refElement: React.RefObject<HTMLDivElement | null>;
  result: ExplorationResult;
  language: Language;
  place: string;
}) {
  const gridCount = result.newlyClaimedGridCount ?? result.discoveredGridIds.length;

  return (
    <div
      ref={refElement}
      className="w-full max-w-[440px] rounded-lg border border-white/10 bg-[#070a12] p-5 shadow-hud"
    >
      <div className="flex flex-col">
        <div className="flex items-center justify-between gap-3">
          <div className="font-black tracking-[0.18em] text-teal-200">ROAMGRID</div>
          <div className="flex h-8 max-w-[58%] items-center justify-center truncate rounded-full border border-teal-200/30 bg-teal-300/10 px-3 text-xs font-bold leading-none text-teal-100">
            <span className="truncate">{place}</span>
          </div>
        </div>

        <div className="mt-6 text-center">
          <div className="text-7xl font-black leading-none text-teal-200 drop-shadow-[0_0_28px_rgba(45,212,191,0.55)]">
            +{gridCount}
          </div>
          <h2 className="mt-2 text-2xl font-black uppercase tracking-[0.08em] text-white">
            {t(language, "newBlockClaimed")}
          </h2>
        </div>

        <MapVisual snapshot={result.mapSnapshotDataUrl} />

        <div className="mt-4 text-center text-sm font-bold text-slate-300">
          {t(language, "progressExplored", {
            place,
            percent: formatPercentage(result.explorationPercentage)
          })}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <ShareStat value={formatDistance(result.distanceMeters)} label={t(language, "shareDistance")} />
          <ShareStat value={formatDuration(result.durationSeconds)} label={t(language, "shareTime")} />
          <ShareStat value={formatPercentage(result.explorationPercentage)} label={t(language, "shareExplored")} />
        </div>
      </div>
    </div>
  );
}

function ShareStat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-black/30 px-2 py-2">
      <div className="truncate text-sm font-black text-white">{value}</div>
      <div className="mt-1 truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </div>
    </div>
  );
}

function MapVisual({ snapshot }: { snapshot?: string }) {
  if (snapshot) {
    return (
      <div className="relative mt-6 aspect-[1.55] overflow-hidden rounded-lg border border-white/10 bg-slate-950">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={snapshot} alt="" className="h-full w-full object-cover" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.02)_40%,rgba(2,6,23,0.46)_100%)]" />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#070a12] to-transparent" />
      </div>
    );
  }

  return (
    <div className="relative mt-6 aspect-[1.55] overflow-hidden rounded-lg border border-white/10 bg-slate-950">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(45,212,191,0.17)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,0.17)_1px,transparent_1px)] bg-[size:34px_34px]" />
      <div className="absolute left-[18%] top-[20%] h-12 w-12 rounded-sm border border-teal-200/70 bg-teal-300/25 shadow-glow" />
      <div className="absolute left-[34%] top-[34%] h-12 w-12 rounded-sm border border-teal-200/70 bg-teal-300/25 shadow-glow" />
      <div className="absolute left-[50%] top-[48%] h-12 w-12 rounded-sm border border-teal-200/70 bg-teal-300/25 shadow-glow" />
      <div className="absolute left-[66%] top-[62%] h-12 w-12 rounded-sm border border-teal-200/70 bg-teal-300/25 shadow-glow" />
      <div className="absolute left-[22%] top-[30%] h-2 w-[58%] rotate-[31deg] rounded-full bg-sky-300 shadow-[0_0_24px_rgba(125,211,252,0.8)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.05)_42%,rgba(2,6,23,0.62)_100%)]" />
    </div>
  );
}
