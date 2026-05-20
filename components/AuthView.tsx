"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LanguageToggle } from "@/components/LanguageToggle";
import { getInitialLanguage, saveLanguage, type Language } from "@/lib/i18n";
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
  syncLocalHistoryToSupabase
} from "@/lib/supabase";

type AuthMode = "login" | "register" | "reset";

const copy = {
  en: {
    title: "RoamGrid Account",
    subtitle: "Sync explored blocks across your devices.",
    login: "Log in",
    register: "Register",
    reset: "Forgot password",
    email: "Email",
    password: "Password",
    submitLogin: "Log in",
    submitRegister: "Create account",
    submitReset: "Send reset email",
    loading: "Please wait...",
    backHome: "Back to RoamGrid",
    configuredError: "Supabase is not configured. Add the public Supabase URL and publishable key first.",
    shortPassword: "Password must be at least 6 characters.",
    resetSent: "Password reset email sent. Open the link on this device.",
    confirmEmail: "Account created. If email confirmation is enabled, open the email link to finish login.",
    syncFailed: "Logged in, but local history sync failed: {error}"
  },
  zh: {
    title: "RoamGrid 账号",
    subtitle: "跨设备同步你探索过的方块。",
    login: "登录",
    register: "注册",
    reset: "忘记密码",
    email: "邮箱",
    password: "密码",
    submitLogin: "登录",
    submitRegister: "创建账号",
    submitReset: "发送重置邮件",
    loading: "请稍候...",
    backHome: "返回 RoamGrid",
    configuredError: "Supabase 尚未配置。请先添加 Supabase URL 和 publishable key。",
    shortPassword: "密码至少需要 6 位。",
    resetSent: "密码重置邮件已发送。请在这台设备上打开邮件链接。",
    confirmEmail: "账号已创建。如果开启了邮箱验证，请打开邮件链接完成登录。",
    syncFailed: "已登录，但本地历史同步失败：{error}"
  }
} as const;

export function AuthView() {
  const router = useRouter();
  const [language, setLanguage] = useState<Language>("en");
  const [mode, setMode] = useState<AuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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

    if (mode !== "reset" && password.length < 6) {
      setError(text.shortPassword);
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "login") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (signInError) {
          setError(signInError.message);
          return;
        }

        await syncAndContinue();
        return;
      }

      if (mode === "register") {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password
        });
        if (signUpError) {
          setError(signUpError.message);
          return;
        }

        if (data.session) {
          await syncAndContinue();
          return;
        }

        setMessage(text.confirmEmail);
        return;
      }

      const redirectTo = `${window.location.origin}/auth/update-password`;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo
      });
      if (resetError) {
        setError(resetError.message);
        return;
      }

      setMessage(text.resetSent);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function syncAndContinue() {
    const syncResult = await syncLocalHistoryToSupabase();
    if (!syncResult.ok && syncResult.reason !== "not_authenticated") {
      setError(copy[language].syncFailed.replace("{error}", syncResult.error));
      return;
    }

    router.push("/");
  }

  const text = copy[language];
  const submitLabel =
    mode === "login" ? text.submitLogin : mode === "register" ? text.submitRegister : text.submitReset;

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

          <div className="mt-6 grid grid-cols-3 gap-2">
            {(["login", "register", "reset"] as AuthMode[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setMode(item);
                  setError(null);
                  setMessage(null);
                }}
                className={
                  item === mode
                    ? "rounded-md bg-teal-300 px-3 py-2 text-sm font-black text-slate-950"
                    : "rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-slate-200"
                }
              >
                {text[item]}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block">
              <span className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                {text.email}
              </span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
                autoComplete="email"
                className="mt-2 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-3 text-base text-white outline-none transition focus:border-teal-200"
              />
            </label>

            {mode !== "reset" ? (
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
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  className="mt-2 w-full rounded-md border border-white/10 bg-slate-950 px-3 py-3 text-base text-white outline-none transition focus:border-teal-200"
                />
              </label>
            ) : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-lg bg-teal-300 px-5 py-3 font-black text-slate-950 shadow-glow transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? text.loading : submitLabel}
            </button>
          </form>

          {message ? <p className="mt-4 text-sm font-semibold text-teal-200">{message}</p> : null}
          {error ? (
            <p className="mt-4 rounded-md border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
              {error}
            </p>
          ) : null}
        </section>

        <Link href="/" className="mt-5 text-center text-sm font-bold text-slate-300 hover:text-white">
          {text.backHome}
        </Link>
      </div>
    </main>
  );
}
