import { createClient } from "@supabase/supabase-js";
import type { ExplorationResult, LocationPoint } from "@/lib/types";

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key);
}

export async function saveResultToSupabase(result: ExplorationResult) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return;
  }

  const { error: sessionError } = await supabase.from("exploration_sessions").upsert({
    id: result.id,
    anonymous_id: result.anonymousId,
    started_at: result.startedAt,
    ended_at: result.endedAt,
    city_name: result.cityName,
    distance_meters: result.distanceMeters,
    discovered_grid_count: result.discoveredGridIds.length,
    exploration_percentage: result.explorationPercentage
  });

  if (sessionError) {
    console.error("Failed to save session", sessionError);
    return;
  }

  await savePoints(supabase, result.id, result.points);
  await saveGrids(supabase, result.anonymousId, result.discoveredGridIds);
}

async function savePoints(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  sessionId: string,
  points: LocationPoint[]
) {
  if (points.length === 0) {
    return;
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

  if (error) {
    console.error("Failed to save location points", error);
  }
}

async function saveGrids(
  supabase: NonNullable<ReturnType<typeof getSupabaseClient>>,
  anonymousId: string,
  gridIds: string[]
) {
  if (gridIds.length === 0) {
    return;
  }

  const discoveredAt = new Date().toISOString();
  const { error } = await supabase.from("discovered_grids").upsert(
    gridIds.map((gridId) => ({
      id: crypto.randomUUID(),
      anonymous_id: anonymousId,
      grid_id: gridId,
      discovered_at: discoveredAt
    }))
  );

  if (error) {
    console.error("Failed to save discovered grids", error);
  }
}
