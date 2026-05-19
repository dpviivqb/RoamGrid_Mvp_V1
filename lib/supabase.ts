import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { isGlobalGridId } from "@/lib/grid";
import {
  getAllAdminGridHistory,
  getAnonymousId,
  hasMergedLocalHistoryForUser,
  markLocalHistoryMergedForUser
} from "@/lib/storage";
import type {
  AuthUser,
  ExplorationResult,
  LocationPoint,
  RemoteExplorationHistoryItem
} from "@/lib/types";

export type SupabaseSaveResult =
  | { ok: true; syncedAt: string; syncMode: "anonymous" | "authenticated"; userId?: string }
  | { ok: false; error: string };

export type SupabaseDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; reason?: "not_configured" | "not_authenticated" };

let browserClient: SupabaseClient | null | undefined;

export function isSupabaseConfigured() {
  return Boolean(getSupabaseConfig().url && getSupabaseConfig().key);
}

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) {
    return browserClient;
  }

  const { url, key } = getSupabaseConfig();
  if (!url || !key) {
    browserClient = null;
    return browserClient;
  }

  browserClient = createClient(url, key, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: true,
      persistSession: true,
      storageKey: "roamgrid_supabase_auth"
    }
  });

  return browserClient;
}

export async function getCurrentAuthUser() {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }

  return toAuthUser(data.user);
}

export async function saveResultToSupabase(
  result: ExplorationResult
): Promise<SupabaseSaveResult> {
  const supabase = getSupabaseBrowserClient();
  const syncableGridIds = getSyncableGridIds(result.discoveredGridIds);
  if (!supabase) {
    return {
      ok: false,
      error:
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy."
    };
  }

  const authUser = await getCurrentAuthUser();
  const userId = authUser?.id;
  const syncMode = userId ? "authenticated" : "anonymous";
  const sessionError = await saveSession(supabase, result, syncableGridIds.length, userId);
  if (sessionError && !isDuplicateRowError(sessionError)) {
    return { ok: false, error: formatSupabaseError("Failed to save session", sessionError) };
  }

  const pointsError = await savePoints(supabase, result.id, result.points, userId);
  if (pointsError) {
    return { ok: false, error: formatSupabaseError("Failed to save location points", pointsError) };
  }

  const gridsError = await saveGrids(
    supabase,
    result.anonymousId,
    userId,
    result.id,
    result.adminArea?.id,
    syncableGridIds
  );
  if (gridsError) {
    return { ok: false, error: formatSupabaseError("Failed to save discovered grids", gridsError) };
  }

  return { ok: true, syncedAt: new Date().toISOString(), syncMode, userId };
}

export async function syncLocalAdminGridHistoryToSupabase(): Promise<SupabaseDataResult<number>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured.", reason: "not_configured" };
  }

  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return { ok: false, error: "Sign in to sync local history.", reason: "not_authenticated" };
  }

  if (hasMergedLocalHistoryForUser(authUser.id)) {
    return { ok: true, data: 0 };
  }

  const history = getAllAdminGridHistory();
  const anonymousId = getAnonymousId();
  const rows = Object.entries(history).flatMap(([adminAreaId, entry]) => {
    const gridIds = Array.from(new Set(entry.gridIds)).filter(isGlobalGridId);
    return gridIds.map((gridId) => ({
      id: crypto.randomUUID(),
      anonymous_id: anonymousId,
      user_id: authUser.id,
      session_id: null,
      admin_area_id: adminAreaId,
      grid_id: gridId,
      discovered_at: entry.updatedAt
    }));
  });

  if (rows.length === 0) {
    markLocalHistoryMergedForUser(authUser.id);
    return { ok: true, data: 0 };
  }

  const { error } = await supabase
    .from("discovered_grids")
    .upsert(rows, { onConflict: "user_id,admin_area_id,grid_id", ignoreDuplicates: true });

  if (error) {
    return { ok: false, error: formatSupabaseError("Failed to sync local history", error) };
  }

  markLocalHistoryMergedForUser(authUser.id);
  return { ok: true, data: rows.length };
}

export async function getRemoteAdminDiscoveredGrids(
  adminAreaId: string
): Promise<SupabaseDataResult<string[]>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured.", reason: "not_configured" };
  }

  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return { ok: true, data: [] };
  }

  const { data, error } = await supabase
    .from("discovered_grids")
    .select("grid_id")
    .eq("user_id", authUser.id)
    .eq("admin_area_id", adminAreaId);

  if (error) {
    return { ok: false, error: formatSupabaseError("Failed to load remote grid history", error) };
  }

  const gridIds = (data ?? [])
    .map((row) => row.grid_id)
    .filter((gridId): gridId is string => typeof gridId === "string")
    .filter(isGlobalGridId);

  return { ok: true, data: Array.from(new Set(gridIds)) };
}

export async function getRemoteExplorationHistory(): Promise<
  SupabaseDataResult<RemoteExplorationHistoryItem[]>
> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured.", reason: "not_configured" };
  }

  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return { ok: false, error: "Sign in to view history.", reason: "not_authenticated" };
  }

  const { data: sessionRows, error: sessionError } = await supabase
    .from("exploration_sessions")
    .select(
      "id,user_id,started_at,ended_at,city_name,admin_area_id,admin_area_name,total_grid_count,distance_meters,discovered_grid_count,exploration_percentage"
    )
    .eq("user_id", authUser.id)
    .order("ended_at", { ascending: false })
    .limit(30);

  if (sessionError) {
    return { ok: false, error: formatSupabaseError("Failed to load exploration history", sessionError) };
  }

  const sessions = (sessionRows ?? []) as SessionHistoryRow[];
  const sessionIds = sessions.map((session) => session.id);
  if (sessionIds.length === 0) {
    return { ok: true, data: [] };
  }

  const [{ data: pointRows, error: pointsError }, { data: gridRows, error: gridsError }] =
    await Promise.all([
      supabase
        .from("location_points")
        .select("session_id,lat,lng,timestamp")
        .eq("user_id", authUser.id)
        .in("session_id", sessionIds)
        .order("timestamp", { ascending: true }),
      supabase
        .from("discovered_grids")
        .select("session_id,grid_id")
        .eq("user_id", authUser.id)
        .in("session_id", sessionIds)
    ]);

  if (pointsError) {
    return { ok: false, error: formatSupabaseError("Failed to load location points", pointsError) };
  }

  if (gridsError) {
    return { ok: false, error: formatSupabaseError("Failed to load discovered grids", gridsError) };
  }

  const pointsBySession = new Map<string, LocationPoint[]>();
  ((pointRows ?? []) as PointHistoryRow[]).forEach((point) => {
    const points = pointsBySession.get(point.session_id) ?? [];
    points.push({ lat: point.lat, lng: point.lng, timestamp: point.timestamp });
    pointsBySession.set(point.session_id, points);
  });

  const gridsBySession = new Map<string, string[]>();
  ((gridRows ?? []) as GridHistoryRow[]).forEach((grid) => {
    if (!grid.session_id || !isGlobalGridId(grid.grid_id)) {
      return;
    }

    const gridIds = gridsBySession.get(grid.session_id) ?? [];
    gridIds.push(grid.grid_id);
    gridsBySession.set(grid.session_id, gridIds);
  });

  return {
    ok: true,
    data: sessions.map((session) => ({
      id: session.id,
      userId: session.user_id,
      startedAt: session.started_at,
      endedAt: session.ended_at,
      cityName: session.city_name ?? undefined,
      adminAreaId: session.admin_area_id ?? undefined,
      adminAreaName: session.admin_area_name ?? undefined,
      distanceMeters: session.distance_meters,
      durationSeconds: calculateDurationSeconds(session.started_at, session.ended_at),
      discoveredGridCount: session.discovered_grid_count,
      explorationPercentage: session.exploration_percentage,
      totalGridCount: session.total_grid_count ?? undefined,
      points: pointsBySession.get(session.id) ?? [],
      discoveredGridIds: Array.from(new Set(gridsBySession.get(session.id) ?? []))
    }))
  };
}

async function saveSession(
  supabase: SupabaseClient,
  result: ExplorationResult,
  discoveredGridCount: number,
  userId: string | undefined
) {
  const { error } = await supabase.from("exploration_sessions").insert({
    id: result.id,
    anonymous_id: result.anonymousId,
    user_id: userId ?? null,
    started_at: result.startedAt,
    ended_at: result.endedAt,
    city_name: result.cityName,
    admin_area_id: result.adminArea?.id,
    admin_area_name: result.adminArea?.localName ?? result.adminArea?.name,
    admin_level: result.adminArea?.adminLevel,
    admin_source: result.adminArea?.source,
    admin_area_m2: result.adminArea?.areaM2,
    total_grid_count: result.totalGridCount ?? result.adminArea?.totalGridCount,
    distance_meters: result.distanceMeters,
    discovered_grid_count: discoveredGridCount,
    exploration_percentage: result.explorationPercentage
  });

  return error;
}

async function savePoints(
  supabase: SupabaseClient,
  sessionId: string,
  points: LocationPoint[],
  userId: string | undefined
) {
  if (points.length === 0) {
    return null;
  }

  const { error } = await supabase.from("location_points").insert(
    points.map((point) => ({
      id: crypto.randomUUID(),
      user_id: userId ?? null,
      session_id: sessionId,
      lat: point.lat,
      lng: point.lng,
      timestamp: point.timestamp
    }))
  );

  return error;
}

async function saveGrids(
  supabase: SupabaseClient,
  anonymousId: string,
  userId: string | undefined,
  sessionId: string,
  adminAreaId: string | undefined,
  gridIds: string[]
) {
  if (gridIds.length === 0) {
    return null;
  }

  const discoveredAt = new Date().toISOString();
  const rows = gridIds.map((gridId) => ({
    id: crypto.randomUUID(),
    anonymous_id: anonymousId,
    user_id: userId ?? null,
    session_id: sessionId,
    admin_area_id: adminAreaId,
    grid_id: gridId,
    discovered_at: discoveredAt
  }));

  if (!userId) {
    const { error } = await supabase.from("discovered_grids").insert(rows);
    return error;
  }

  const { error } = await supabase
    .from("discovered_grids")
    .upsert(rows, { onConflict: "user_id,admin_area_id,grid_id", ignoreDuplicates: true });

  return error;
}

function getSupabaseConfig() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  return { url, key };
}

function normalizeSupabaseUrl(value: string | undefined) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value.trim());
    url.pathname = url.pathname.replace(/\/rest\/v1\/?$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");
  }
}

function isDuplicateRowError(error: PostgrestError) {
  return error.code === "23505";
}

function getSyncableGridIds(gridIds: string[]) {
  return gridIds.filter(isGlobalGridId);
}

function formatSupabaseError(label: string, error: PostgrestError) {
  return [label, error.message, error.code, error.details, error.hint].filter(Boolean).join(": ");
}

function toAuthUser(user: { id: string; email?: string }) {
  return {
    id: user.id,
    email: user.email
  } satisfies AuthUser;
}

function calculateDurationSeconds(startedAt: string, endedAt: string) {
  return Math.max(1, Math.floor((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 1000));
}

type SessionHistoryRow = {
  id: string;
  user_id: string;
  started_at: string;
  ended_at: string;
  city_name: string | null;
  admin_area_id: string | null;
  admin_area_name: string | null;
  total_grid_count: number | null;
  distance_meters: number;
  discovered_grid_count: number;
  exploration_percentage: number;
};

type PointHistoryRow = {
  session_id: string;
  lat: number;
  lng: number;
  timestamp: string;
};

type GridHistoryRow = {
  session_id: string | null;
  grid_id: string;
};
