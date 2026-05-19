"use client";

import type { Language } from "@/lib/i18n";

export function LanguageToggle({
  language,
  onChange
}: {
  language: Language;
  onChange: (language: Language) => void;
}) {
  return (
    <div className="inline-grid grid-cols-2 rounded-md border border-white/10 bg-black/30 p-1 text-xs font-black shadow-hud backdrop-blur">
      <button
        type="button"
        onClick={() => onChange("zh")}
        className={`rounded px-3 py-1.5 transition ${
          language === "zh" ? "bg-teal-300 text-slate-950" : "text-slate-300 hover:text-white"
        }`}
      >
        中
      </button>
      <button
        type="button"
        onClick={() => onChange("en")}
        className={`rounded px-3 py-1.5 transition ${
          language === "en" ? "bg-teal-300 text-slate-950" : "text-slate-300 hover:text-white"
        }`}
      >
        EN
      </button>
    </div>
  );
}
