import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ExplorationResult, LocationPoint } from "@/lib/types";

type ExplorationResultPayload = Pick<
  ExplorationResult,
  | "id"
  | "anonymousId"
  | "startedAt"
  | "endedAt"
  | "cityName"
  | "points"
  | "discoveredGridIds"
  | "distanceMeters"
  | "explorationPercentage"
>;

type SupabaseErrorLike = {
  code?: string;
  details?: string;
  hint?: string;
  message?: string;
};

export async function GET() {
  return NextResponse.json({
    supabaseUrlConfigured: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    supabaseWriteKeyConfigured: Boolean(
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    )
  });
}

export async function POST(request: Request) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return NextResponse.json(
      {
        error:
          "Supabase is not configured on the server. Set NEXT_PUBLIC_SUPABASE_URL and either SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY in Vercel, then redeploy."
      },
      { status: 503 }
    );
  }

  let result: ExplorationResultPayload;
  try {
    result = (await request.json()) as ExplorationResultPayload;
  } catch {
    return NextResponse.json({ error: "Invalid exploration result payload." }, { status: 400 });
  }

  const validationError = validateResult(result);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  const { error: sessionError } = await supabase.from("exploration_sessions").insert({
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
    return syncErrorResponse("Failed to save exploration session", sessionError);
  }

  const pointsError = await savePoints(supabase, result.id, result.points);
  if (pointsError) {
    return syncErrorResponse("Failed to save location points", pointsError);
  }

  const gridsError = await saveGrids(supabase, result.anonymousId, result.discoveredGridIds);
  if (gridsError) {
    return syncErrorResponse("Failed to save discovered grids", gridsError);
  }

  return NextResponse.json({ ok: true, syncedAt: new Date().toISOString() });
}

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false
    }
  });
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

function validateResult(result: Partial<ExplorationResultPayload>) {
  if (!result.id || !result.anonymousId || !result.startedAt || !result.endedAt) {
    return "Exploration result is missing required session fields.";
  }

  if (!Array.isArray(result.points) || result.points.length === 0) {
    return "Exploration result has no location points.";
  }

  if (!Array.isArray(result.discoveredGridIds) || result.discoveredGridIds.length === 0) {
    return "Exploration result has no discovered grids.";
  }

  return null;
}

function syncErrorResponse(message: string, error: SupabaseErrorLike) {
  const details = [error.message, error.code, error.details, error.hint].filter(Boolean).join(" · ");
  return NextResponse.json(
    {
      error: details ? `${message}: ${details}` : message
    },
    { status: 502 }
  );
}
