"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient, syncLocalAdminGridHistoryToSupabase } from "@/lib/supabase";
import type { AuthUser } from "@/lib/types";
import type { Language } from "@/lib/i18n";

type AccountMenuProps = {
  language: Language;
  compact?: boolean;
  showEmail?: boolean;
};

const copy = {
  en: {
    login: "Log in to sync",
    history: "History",
    signOut: "Sign out",
    syncing: "Syncing",
    syncFailed: "Sync failed"
  },
  zh: {
    login: "登录同步历史",
    history: "历史",
    signOut: "退出",
    syncing: "同步中",
    syncFailed: "同步失败"
  }
} as const;

export function AccountMenu({ language, compact = false, showEmail = true }: AccountMenuProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    function applySession(session: Session | null) {
      if (!isMounted) {
        return;
      }

      const nextUser = session?.user
        ? { id: session.user.id, email: session.user.email }
        : null;
      setUser(nextUser);
      setIsLoading(false);

      if (nextUser) {
        setIsSyncing(true);
        setSyncError(null);
        void syncLocalAdminGridHistoryToSupabase()
          .then((result) => {
            if (!isMounted || result.ok || result.reason === "not_authenticated") {
              return;
            }
            setSyncError(result.error);
          })
          .finally(() => {
            if (isMounted) {
              setIsSyncing(false);
            }
          });
      }
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data.session));
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      return;
    }

    await supabase.auth.signOut();
    setUser(null);
  }

  if (isLoading) {
    return null;
  }

  const text = copy[language];
  const baseClass = compact
    ? "rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-xs font-bold text-slate-100 shadow-hud backdrop-blur-md transition hover:bg-white/10"
    : "rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-bold text-slate-100 transition hover:bg-white/10";

  if (!user) {
    return (
      <Link href="/auth" className={baseClass}>
        {text.login}
      </Link>
    );
  }

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
      <Link href="/history" className={baseClass}>
        {text.history}
      </Link>
      {showEmail ? (
        <div
          className={
            compact
              ? "hidden max-w-[10rem] truncate rounded-md border border-white/10 bg-black/36 px-2.5 py-2 text-xs font-semibold text-slate-200 shadow-hud backdrop-blur-md sm:block"
              : "hidden max-w-[14rem] truncate rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-slate-200 sm:block"
          }
          title={user.email}
        >
          {isSyncing ? text.syncing : user.email}
        </div>
      ) : null}
      <button type="button" onClick={signOut} className={baseClass}>
        {text.signOut}
      </button>
      {syncError ? (
        <span className="sr-only">
          {text.syncFailed}: {syncError}
        </span>
      ) : null}
    </div>
  );
}
