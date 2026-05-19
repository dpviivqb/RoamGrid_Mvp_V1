import type { ExplorationResult } from "@/lib/types";

export type SupabaseSaveResult =
  | { ok: true; syncedAt: string }
  | { ok: false; error: string };

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

export async function saveResultToSupabase(
  result: ExplorationResult
): Promise<SupabaseSaveResult> {
  const payload: ExplorationResultPayload = {
    id: result.id,
    anonymousId: result.anonymousId,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    cityName: result.cityName,
    points: result.points,
    discoveredGridIds: result.discoveredGridIds,
    distanceMeters: result.distanceMeters,
    explorationPercentage: result.explorationPercentage
  };

  try {
    const response = await fetch("/api/exploration-results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = (await response.json().catch(() => null)) as
      | { syncedAt?: string; error?: string }
      | null;

    if (!response.ok) {
      const error = data?.error ?? `Supabase sync failed with HTTP ${response.status}`;
      console.error("Failed to save result to Supabase", error);
      return { ok: false, error };
    }

    return { ok: true, syncedAt: data?.syncedAt ?? new Date().toISOString() };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Supabase sync error";
    console.error("Failed to save result to Supabase", message);
    return { ok: false, error: message };
  }
}
