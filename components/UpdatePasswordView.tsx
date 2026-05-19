"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LanguageToggle } from "@/components/LanguageToggle";
import { getInitialLanguage, saveLanguage, type Language } from "@/lib/i18n";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase";

const copy = {
  en: {
    title: "Set New Password",
    subtitle: "Enter a new password for your RoamGrid account.",
    password: "New password",
    confirmPassword: "Confirm password",
    save: "Update password",
    saving: "Updating...",
    mismatch: "Passwords do not match.",
    shortPassword: "Password must be at least 6 characters.",
    configuredError: "Supabase is not configured.",
    success: "Password updated. You can continue exploring.",
    continue: "Continue exploring",
    backLogin: "Back to login"
  },
  zh: {
    title: "设置新密码",
    subtitle: "为你的 RoamGrid 账号输入一个新密码。",
    password: "新密码",
    confirmPassword: "确认密码",
    save: "更新密码",
    saving: "更新中...",
    mismatch: "两次输入的密码不一致。",
    shortPassword: "密码至少需要 6 位。",
    configuredError: "Supabase 尚未配置。",
    success: "密码已更新，可以继续探索。",
    continue: "继续探索",
    backLogin: "返回登录"
  }
} as const;

export function UpdatePasswordView() {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("en");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLanguage(getInitialLanguage());
  }, []);

  function handleLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    saveLanguage(nextLanguage);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);

    const text = copy[language];
    const supabase = getSupabaseBrowserClient();
    if (!supabase || !isSupabaseConfigured()) {
      setError(text.configuredError);
      return;
    }

    if (password.length < 6) {
      setError(text.shortPassword);
      return;
    }

    if (password !== confirmPassword) {
      setError(text.mismatch);
      return;
    }

    setIsSubmitting(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }

      setMessage(text.success);
      window.setTimeout(() => router.push("/explore"), 700);
    } finally {
      setIsSubmitting(false);
    }
  }

  const text = copy[language];

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md flex-col justify-center">
        <nav className="mb-8 flex items-center justify-between gap-3">
          <Link href="/" className="text-sm font-black tracking-[0.18em] text-teal-200">
            ROAMGRID
          </Link>
          <LanguageToggle language={language} onChange={handleLanguageChange} />
        </nav>

        <section className="rounded-lg border border-white/10 bg-black/30 p-5 shadow-hud backdrop-blur-md">
          <h1 className="text-3xl font-black text-white">{text.title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">{text.subtitle}</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                {text.password}
              </span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="mt-2 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-3 text-base text-white outline-none transition focus:border-teal-200"
              />
            </label>

            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                {text.confirmPassword}
              </span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
                className="mt-2 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-3 text-base text-white outline-none transition focus:border-teal-200"
              />
            </label>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-teal-300 px-5 py-3 font-black text-slate-950 shadow-glow transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? text.saving : text.save}
            </button>
          </form>

          {message ? <p className="mt-4 text-sm font-semibold text-teal-200">{message}</p> : null}
          {error ? (
            <p className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
              {error}
            </p>
          ) : null}
        </section>

        <div className="mt-5 flex justify-center gap-4 text-sm font-bold text-slate-300">
          <button type="button" onClick={() => router.push("/explore")} className="hover:text-white">
            {text.continue}
          </button>
          <Link href="/auth" className="hover:text-white">
            {text.backLogin}
          </Link>
        </div>
      </div>
    </main>
  );
}
