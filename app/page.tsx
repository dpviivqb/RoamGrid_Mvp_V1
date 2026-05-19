"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { HomeLiveMapPreview } from "@/components/HomeLiveMapPreview";
import { LanguageToggle } from "@/components/LanguageToggle";
import { getInitialLanguage, saveLanguage, t, type Language } from "@/lib/i18n";

type LaunchStyle = {
  left: number;
  top: number;
  width: number;
  height: number;
  borderRadius: number;
};

export default function HomePage() {
  const router = useRouter();
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchStyle, setLaunchStyle] = useState<LaunchStyle | null>(null);

  useEffect(() => {
    setLanguage(getInitialLanguage());
  }, []);

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
  }

  function startExploring() {
    const rect = previewRef.current?.getBoundingClientRect();
    if (!rect) {
      router.push("/explore");
      return;
    }

    setLaunchStyle({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      borderRadius: 8
    });
    setIsLaunching(true);

    window.setTimeout(() => {
      setLaunchStyle({
        left: 0,
        top: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        borderRadius: 0
      });
    }, 20);

    window.setTimeout(() => router.push("/explore"), 470);
  }

  return (
    <main className="min-h-screen overflow-hidden">
      <section className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-6 py-6">
        <nav className="flex items-center justify-between gap-3 text-sm text-slate-300">
          <div className="font-bold tracking-[0.18em] text-teal-200">ROAMGRID</div>
          <div className="flex items-center gap-3">
            <div className="hidden rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs sm:block">
              {t(language, "previewTag")}
            </div>
            <LanguageToggle language={language} onChange={handleLanguageChange} />
          </div>
        </nav>

        <div className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1fr_0.9fr]">
          <div className="max-w-2xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-teal-200">
              {t(language, "eyebrow")}
            </p>
            <h1 className="text-5xl font-black leading-tight text-white sm:text-7xl">
              RoamGrid
            </h1>
            <p className="mt-5 max-w-xl text-xl leading-8 text-slate-300">
              {t(language, "slogan")}
            </p>
            <button
              type="button"
              onClick={startExploring}
              className="mt-9 inline-flex items-center justify-center rounded-lg bg-teal-300 px-6 py-4 text-base font-bold text-slate-950 shadow-glow transition hover:bg-teal-200 focus:outline-none focus:ring-4 focus:ring-teal-300/30"
            >
              {t(language, "startExploring")}
            </button>
          </div>

          <div ref={previewRef}>
            <HomeLiveMapPreview
              language={language}
              place={t(language, "previewPlace")}
              status={t(language, "previewStatus")}
              fallback={t(language, "previewFallback")}
            />
          </div>
        </div>
      </section>

      {isLaunching && launchStyle ? (
        <div
          className="fixed z-50 overflow-hidden border border-teal-200/20 bg-slate-950 shadow-glow transition-all duration-[450ms] ease-in-out"
          style={{
            left: launchStyle.left,
            top: launchStyle.top,
            width: launchStyle.width,
            height: launchStyle.height,
            borderRadius: launchStyle.borderRadius
          }}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(45,212,191,0.2),transparent_22rem),linear-gradient(135deg,#07101a,#020617)]" />
          <div className="absolute inset-0 bg-[linear-gradient(rgba(45,212,191,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(45,212,191,0.12)_1px,transparent_1px)] bg-[size:56px_56px]" />
          <div className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2">
            <div className="absolute inset-0 animate-player-ping rounded-full border border-sky-200/70 bg-sky-300/20" />
            <div className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-sky-300 shadow-[0_0_24px_rgba(56,189,248,0.95)]" />
          </div>
        </div>
      ) : null}
    </main>
  );
}
