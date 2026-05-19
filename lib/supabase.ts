import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import type { ExplorationResult, LocationPoint } from "@/lib/types";

export type SupabaseSaveResult =
  | { ok: true; syncedAt: string }
  | { ok: false; error: string };

function getSupabaseClient() {
  const url = normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false
    }
  });
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

export async function saveResultToSupabase(
  result: ExplorationResult
): Promise<SupabaseSaveResult> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return {
      ok: false,
      error:
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in Vercel, then redeploy."
    };
  }

  const sessionError = await saveSession(supabase, result);
  if (sessionError && !isDuplicateRowError(sessionError)) {
    return { ok: false, error: formatSupabaseError("Failed to save session", sessionError) };
  }

  const pointsError = await savePoints(supabase, result.id, result.points);
  if (pointsError) {
    return { ok: false, error: formatSupabaseError("Failed to save location points", pointsError) };
  }

  const gridsError = await saveGrids(supabase, result.anonymousId, result.discoveredGridIds);
  if (gridsError) {
    return { ok: false, error: formatSupabaseError("Failed to save discovered grids", gridsError) };
  }

  return { ok: true, syncedAt: new Date().toISOString() };
}

async function saveSession(supabase: SupabaseClient, result: ExplorationResult) {
  const { error } = await supabase.from("exploration_sessions").insert({
    id: result.id,
    anonymous_id: result.anonymousId,
    started_at: result.startedAt,
    ended_at: result.endedAt,
    city_name: result.cityName,
    distance_meters: result.distanceMeters,
    discovered_grid_count: result.discoveredGridIds.length,
    exploration_percentage: result.explorationPercentage
  });

  return error;
}

async function savePoints(
  supabase: SupabaseClient,
  sessionId: string,
  points: LocationPoint[]
) {
  if (points.length === 0) {
    return null;
  }

  const { error } = await supabase.from("location_points").insert(
    points.map((point) => ({
      id: crypto.randomUUID(),
      session_id: sessionId,
      lat: point.lat,
      lng: point.lng,
      timestamp: point.timestamp
    }))
  );

  return error;
}

async function saveGrids(supabase: SupabaseClient, anonymousId: string, gridIds: string[]) {
  if (gridIds.length === 0) {
    return null;
  }

  const discoveredAt = new Date().toISOString();
  const { error } = await supabase.from("discovered_grids").insert(
    gridIds.map((gridId) => ({
      id: crypto.randomUUID(),
      anonymous_id: anonymousId,
      grid_id: gridId,
      discovered_at: discoveredAt
    }))
  );

  return error;
}

function isDuplicateRowError(error: PostgrestError) {
  return error.code === "23505";
}

function formatSupabaseError(label: string, error: PostgrestError) {
  return [label, error.message, error.code, error.details, error.hint].filter(Boolean).join(": ");
}
