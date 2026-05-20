import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { isGlobalGridId } from "@/lib/grid";
import { buildPlaceHierarchy, buildResultPlaceHierarchy } from "@/lib/history";
import {
  deleteLocalExplorationResult,
  getAllAdminGridHistory,
  getAnonymousId,
  getLocalExplorationHistory,
  hasMergedLocalHistoryForUser,
  markLocalHistoryMergedForUser,
  saveExplorationHistory
} from "@/lib/storage";
import type {
  AuthUser,
  ExplorationResult,
  HistoryDetail,
  HistorySummary,
  LocationPoint
} from "@/lib/types";

export type SupabaseSaveResult =
  | {
      ok: true;
      syncedAt: string;
      syncMode: "anonymous" | "authenticated";
      userId?: string;
      mapSnapshotStoragePath?: string;
    }
  | { ok: false; error: string };

export type SupabaseDataResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; reason?: "not_configured" | "not_authenticated" };

let browserClient: SupabaseClient | null | undefined;
const HISTORY_PAGE_SIZE = 100;
const SNAPSHOT_BUCKET = "exploration-snapshots";
const SNAPSHOT_SIGNED_URL_TTL_SECONDS = 60 * 60;
const HISTORY_LIST_SELECT =
  "id,user_id,started_at,ended_at,city_name,admin_area_id,admin_area_name,admin_area_display_name,place_parent_label_en,place_parent_label_zh,place_full_label_en,place_full_label_zh,map_snapshot_data_url,map_snapshot_storage_path,map_snapshot_version,total_grid_count,distance_meters,discovered_grid_count,exploration_percentage";
const HISTORY_DETAIL_SELECT =
  "id,anonymous_id,user_id,started_at,ended_at,city_name,admin_area_id,admin_area_name,admin_area_display_name,admin_level,admin_source,admin_area_m2,place_parent_label_en,place_parent_label_zh,place_full_label_en,place_full_label_zh,map_snapshot_data_url,map_snapshot_storage_path,map_snapshot_version,total_grid_count,distance_meters,discovered_grid_count,exploration_percentage";
const LEGACY_HISTORY_LIST_SELECT =
  "id,user_id,started_at,ended_at,city_name,admin_area_id,admin_area_name,total_grid_count,distance_meters,discovered_grid_count,exploration_percentage";
const LEGACY_HISTORY_DETAIL_SELECT =
  "id,anonymous_id,user_id,started_at,ended_at,city_name,admin_area_id,admin_area_name,admin_level,admin_source,admin_area_m2,total_grid_count,distance_meters,discovered_grid_count,exploration_percentage";

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
  const snapshotUpload = userId
    ? await uploadSnapshotToStorage(supabase, userId, result)
    : { ok: true as const, path: undefined };
  if (!snapshotUpload.ok) {
    return { ok: false, error: snapshotUpload.error };
  }

  const sessionError = await saveSession(
    supabase,
    result,
    syncableGridIds.length,
    userId,
    snapshotUpload.path
  );
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

  return {
    ok: true,
    syncedAt: new Date().toISOString(),
    syncMode,
    userId,
    mapSnapshotStoragePath: snapshotUpload.path
  };
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

export async function syncLocalHistoryToSupabase(): Promise<SupabaseDataResult<number>> {
  const explorationSync = await syncLocalExplorationHistoryToSupabase();
  if (!explorationSync.ok) {
    return explorationSync;
  }

  const gridSync = await syncLocalAdminGridHistoryToSupabase();
  if (!gridSync.ok) {
    return gridSync;
  }

  return { ok: true, data: explorationSync.data + gridSync.data };
}

export async function syncLocalExplorationHistoryToSupabase(): Promise<SupabaseDataResult<number>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured.", reason: "not_configured" };
  }

  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return { ok: false, error: "Sign in to sync local history.", reason: "not_authenticated" };
  }

  const localHistory = getLocalExplorationHistory();
  if (localHistory.length === 0) {
    return { ok: true, data: 0 };
  }

  let syncedCount = 0;

  for (const localResult of localHistory) {
    const shouldKeepSessionId =
      localResult.userId === authUser.id && localResult.syncMode === "authenticated";
    const remoteSessionId = shouldKeepSessionId ? localResult.id : crypto.randomUUID();
    const alreadyExists = await getRemoteSessionExists(supabase, authUser.id, remoteSessionId);
    if (!alreadyExists.ok) {
      return { ok: false, error: formatSupabaseError("Failed to check remote history", alreadyExists.error) };
    }

    const resultForSync: ExplorationResult = {
      ...localResult,
      id: remoteSessionId,
      userId: authUser.id,
      syncMode: "authenticated",
      supabaseSyncError: undefined,
      supabaseSyncedAt: undefined
    };

    if (!alreadyExists.data) {
      const syncResult = await saveResultToSupabase(resultForSync);
      if (!syncResult.ok) {
        return { ok: false, error: syncResult.error };
      }

      resultForSync.supabaseSyncedAt = syncResult.syncedAt;
      resultForSync.mapSnapshotStoragePath = syncResult.mapSnapshotStoragePath;
      syncedCount += 1;
    } else {
      const snapshotUpload = await uploadSnapshotToStorage(supabase, authUser.id, resultForSync);
      if (!snapshotUpload.ok) {
        return { ok: false, error: snapshotUpload.error };
      }

      const updateResult = await updateRemoteSessionMetadata(
        supabase,
        authUser.id,
        resultForSync,
        snapshotUpload.path
      );
      if (updateResult) {
        return {
          ok: false,
          error: formatSupabaseError("Failed to update remote history", updateResult)
        };
      }

      resultForSync.mapSnapshotStoragePath = snapshotUpload.path;
      resultForSync.supabaseSyncedAt = new Date().toISOString();
    }

    if (localResult.id !== resultForSync.id) {
      deleteLocalExplorationResult(localResult.id);
    }
    saveExplorationHistory(resultForSync);
  }

  return { ok: true, data: syncedCount };
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

export async function getRemoteExplorationHistoryList(): Promise<
  SupabaseDataResult<HistorySummary[]>
> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured.", reason: "not_configured" };
  }

  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return { ok: false, error: "Sign in to view history.", reason: "not_authenticated" };
  }

  let rowsResult = await fetchHistorySessionRows(supabase, authUser.id, HISTORY_LIST_SELECT);
  if (!rowsResult.ok && isMissingColumnError(rowsResult.error)) {
    rowsResult = await fetchHistorySessionRows(supabase, authUser.id, LEGACY_HISTORY_LIST_SELECT);
  }

  if (!rowsResult.ok) {
    return {
      ok: false,
      error: formatSupabaseError("Failed to load exploration history", rowsResult.error)
    };
  }

  const summaries = rowsResult.data.map((session) => buildHistorySummaryFromSession(session, "remote"));

  return {
    ok: true,
    data: await attachSignedSnapshotUrls(supabase, summaries)
  };
}

export async function getRemoteExplorationSession(
  sessionId: string
): Promise<SupabaseDataResult<HistoryDetail>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured.", reason: "not_configured" };
  }

  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return { ok: false, error: "Sign in to view history.", reason: "not_authenticated" };
  }

  let sessionResult = await fetchHistorySession(
    supabase,
    authUser.id,
    sessionId,
    HISTORY_DETAIL_SELECT
  );
  if (!sessionResult.ok && isMissingColumnError(sessionResult.error)) {
    sessionResult = await fetchHistorySession(
      supabase,
      authUser.id,
      sessionId,
      LEGACY_HISTORY_DETAIL_SELECT
    );
  }

  if (!sessionResult.ok) {
    return {
      ok: false,
      error: formatSupabaseError("Failed to load exploration session", sessionResult.error)
    };
  }

  if (!sessionResult.data) {
    return { ok: false, error: "History record not found." };
  }

  const [{ data: pointRows, error: pointsError }, { data: gridRows, error: gridsError }] =
    await Promise.all([
      supabase
        .from("location_points")
        .select("session_id,lat,lng,timestamp")
        .eq("user_id", authUser.id)
        .eq("session_id", sessionId)
        .order("timestamp", { ascending: true }),
      supabase
        .from("discovered_grids")
        .select("session_id,grid_id")
        .eq("user_id", authUser.id)
        .eq("session_id", sessionId)
    ]);

  if (pointsError) {
    return { ok: false, error: formatSupabaseError("Failed to load location points", pointsError) };
  }

  if (gridsError) {
    return { ok: false, error: formatSupabaseError("Failed to load discovered grids", gridsError) };
  }

  const points = ((pointRows ?? []) as PointHistoryRow[]).map((point) => ({
    lat: point.lat,
    lng: point.lng,
    timestamp: point.timestamp
  }));
  const gridIds = ((gridRows ?? []) as GridHistoryRow[])
    .map((grid) => grid.grid_id)
    .filter(isGlobalGridId);

  const [summary] = await attachSignedSnapshotUrls(supabase, [
    buildHistorySummaryFromSession(sessionResult.data, "remote")
  ]);

  return {
    ok: true,
    data: {
      ...summary,
      points,
      discoveredGridIds: Array.from(new Set(gridIds))
    }
  };
}

export async function deleteRemoteExplorationSession(
  sessionId: string
): Promise<SupabaseDataResult<string>> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { ok: false, error: "Supabase is not configured.", reason: "not_configured" };
  }

  const authUser = await getCurrentAuthUser();
  if (!authUser) {
    return { ok: false, error: "Sign in to delete history.", reason: "not_authenticated" };
  }

  const snapshotPath = await getRemoteSnapshotStoragePath(supabase, authUser.id, sessionId);
  if (!snapshotPath.ok) {
    return { ok: false, error: formatSupabaseError("Failed to load snapshot metadata", snapshotPath.error) };
  }

  if (snapshotPath.data) {
    const { error: storageError } = await supabase.storage
      .from(SNAPSHOT_BUCKET)
      .remove([snapshotPath.data]);

    if (storageError) {
      return { ok: false, error: formatStorageError("Failed to delete map snapshot", storageError) };
    }
  }

  const gridsResult = await supabase
    .from("discovered_grids")
    .delete()
    .eq("user_id", authUser.id)
    .eq("session_id", sessionId);

  if (gridsResult.error) {
    return { ok: false, error: formatSupabaseError("Failed to delete discovered grids", gridsResult.error) };
  }

  const pointsResult = await supabase
    .from("location_points")
    .delete()
    .eq("user_id", authUser.id)
    .eq("session_id", sessionId);

  if (pointsResult.error) {
    return { ok: false, error: formatSupabaseError("Failed to delete location points", pointsResult.error) };
  }

  const sessionResult = await supabase
    .from("exploration_sessions")
    .delete()
    .eq("user_id", authUser.id)
    .eq("id", sessionId);

  if (sessionResult.error) {
    return { ok: false, error: formatSupabaseError("Failed to delete exploration session", sessionResult.error) };
  }

  return { ok: true, data: sessionId };
}

async function saveSession(
  supabase: SupabaseClient,
  result: ExplorationResult,
  discoveredGridCount: number,
  userId: string | undefined,
  snapshotStoragePath: string | undefined
) {
  const hierarchy = buildResultPlaceHierarchy(result);
  const baseRow = {
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
    exploration_percentage: result.explorationPercentage,
    map_snapshot_data_url: null,
    map_snapshot_storage_path: snapshotStoragePath,
    map_snapshot_version: result.mapSnapshotVersion
  };
  const { error } = await supabase.from("exploration_sessions").insert({
    ...baseRow,
    admin_area_display_name: hierarchy.title.en,
    place_parent_label_en: hierarchy.parentPath.en,
    place_parent_label_zh: hierarchy.parentPath.zh,
    place_full_label_en: hierarchy.fullPath.en,
    place_full_label_zh: hierarchy.fullPath.zh
  });

  if (error && isMissingColumnError(error)) {
    const { map_snapshot_data_url, map_snapshot_storage_path, map_snapshot_version, ...legacyRow } = baseRow;
    void map_snapshot_data_url;
    void map_snapshot_storage_path;
    void map_snapshot_version;
    const legacyResult = await supabase.from("exploration_sessions").insert(legacyRow);
    return legacyResult.error;
  }

  return error;
}

async function updateRemoteSessionMetadata(
  supabase: SupabaseClient,
  userId: string,
  result: ExplorationResult,
  snapshotStoragePath: string | undefined
) {
  const hierarchy = buildResultPlaceHierarchy(result);
  const baseRow = {
    city_name: result.cityName,
    admin_area_id: result.adminArea?.id,
    admin_area_name: result.adminArea?.localName ?? result.adminArea?.name,
    admin_area_display_name: hierarchy.title.en,
    admin_level: result.adminArea?.adminLevel,
    admin_source: result.adminArea?.source,
    admin_area_m2: result.adminArea?.areaM2,
    place_parent_label_en: hierarchy.parentPath.en,
    place_parent_label_zh: hierarchy.parentPath.zh,
    place_full_label_en: hierarchy.fullPath.en,
    place_full_label_zh: hierarchy.fullPath.zh,
    map_snapshot_data_url: snapshotStoragePath ? null : undefined,
    map_snapshot_storage_path: snapshotStoragePath,
    map_snapshot_version: result.mapSnapshotVersion,
    total_grid_count: result.totalGridCount ?? result.adminArea?.totalGridCount,
    distance_meters: result.distanceMeters,
    discovered_grid_count: result.discoveredGridIds.length,
    exploration_percentage: result.explorationPercentage
  };

  const { error } = await supabase
    .from("exploration_sessions")
    .update(baseRow)
    .eq("user_id", userId)
    .eq("id", result.id);

  if (error && isMissingColumnError(error)) {
    const { admin_area_display_name, place_parent_label_en, place_parent_label_zh, place_full_label_en, place_full_label_zh, map_snapshot_data_url, map_snapshot_storage_path, map_snapshot_version, ...legacyRow } = baseRow;
    void admin_area_display_name;
    void place_parent_label_en;
    void place_parent_label_zh;
    void place_full_label_en;
    void place_full_label_zh;
    void map_snapshot_data_url;
    void map_snapshot_storage_path;
    void map_snapshot_version;
    const legacyResult = await supabase
      .from("exploration_sessions")
      .update(legacyRow)
      .eq("user_id", userId)
      .eq("id", result.id);
    return legacyResult.error;
  }

  return error;
}

async function uploadSnapshotToStorage(
  supabase: SupabaseClient,
  userId: string,
  result: ExplorationResult
): Promise<{ ok: true; path?: string } | { ok: false; error: string }> {
  if (!result.mapSnapshotDataUrl) {
    return { ok: true, path: result.mapSnapshotStoragePath };
  }

  const path = buildSnapshotStoragePath(userId, result.id);

  try {
    const blob = await dataUrlToBlob(result.mapSnapshotDataUrl);
    const { error } = await supabase.storage.from(SNAPSHOT_BUCKET).upload(path, blob, {
      cacheControl: "31536000",
      contentType: "image/png",
      upsert: true
    });

    if (error) {
      return { ok: false, error: formatStorageError("Failed to upload map snapshot", error) };
    }
  } catch (error) {
    return { ok: false, error: formatStorageError("Failed to prepare map snapshot", error) };
  }

  return { ok: true, path };
}

async function attachSignedSnapshotUrls(
  supabase: SupabaseClient,
  summaries: HistorySummary[]
) {
  const paths = Array.from(
    new Set(
      summaries
        .map((summary) => summary.mapSnapshotStoragePath)
        .filter((path): path is string => Boolean(path))
    )
  );

  if (paths.length === 0) {
    return summaries;
  }

  const { data, error } = await supabase.storage
    .from(SNAPSHOT_BUCKET)
    .createSignedUrls(paths, SNAPSHOT_SIGNED_URL_TTL_SECONDS);

  if (error) {
    return summaries;
  }

  const signedUrlByPath = new Map<string, string>();
  (data ?? []).forEach((entry) => {
    const signedEntry = entry as { path?: string; signedUrl?: string; signedURL?: string };
    const signedUrl = signedEntry.signedUrl ?? signedEntry.signedURL;
    if (signedEntry.path && signedUrl) {
      signedUrlByPath.set(signedEntry.path, signedUrl);
    }
  });

  return summaries.map((summary) => ({
    ...summary,
    mapSnapshotPreviewUrl: summary.mapSnapshotStoragePath
      ? signedUrlByPath.get(summary.mapSnapshotStoragePath) ?? summary.mapSnapshotPreviewUrl
      : summary.mapSnapshotPreviewUrl
  }));
}

async function getRemoteSnapshotStoragePath(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<{ ok: true; data?: string } | { ok: false; error: PostgrestError }> {
  const { data, error } = await supabase
    .from("exploration_sessions")
    .select("map_snapshot_storage_path")
    .eq("user_id", userId)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    if (isMissingColumnError(error)) {
      return { ok: true, data: undefined };
    }

    return { ok: false, error };
  }

  return {
    ok: true,
    data: (data as { map_snapshot_storage_path?: string | null } | null)?.map_snapshot_storage_path ?? undefined
  };
}

function buildSnapshotStoragePath(userId: string, sessionId: string) {
  return `${userId}/${sessionId}.png`;
}

async function dataUrlToBlob(dataUrl: string) {
  const response = await fetch(dataUrl);
  if (!response.ok) {
    throw new Error(`Snapshot fetch failed with status ${response.status}`);
  }

  return response.blob();
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

async function fetchHistorySessionRows(
  supabase: SupabaseClient,
  userId: string,
  selectColumns: string
): Promise<{ ok: true; data: SessionHistoryRow[] } | { ok: false; error: PostgrestError }> {
  const rows: SessionHistoryRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("exploration_sessions")
      .select(selectColumns)
      .eq("user_id", userId)
      .order("ended_at", { ascending: false })
      .range(from, from + HISTORY_PAGE_SIZE - 1);

    if (error) {
      return { ok: false, error };
    }

    const pageRows = (data ?? []) as unknown as SessionHistoryRow[];
    rows.push(...pageRows);
    if (pageRows.length < HISTORY_PAGE_SIZE) {
      return { ok: true, data: rows };
    }

    from += HISTORY_PAGE_SIZE;
  }
}

async function fetchHistorySession(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string,
  selectColumns: string
): Promise<{ ok: true; data: SessionHistoryRow | null } | { ok: false; error: PostgrestError }> {
  const { data, error } = await supabase
    .from("exploration_sessions")
    .select(selectColumns)
    .eq("user_id", userId)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, data: data as unknown as SessionHistoryRow | null };
}

async function getRemoteSessionExists(
  supabase: SupabaseClient,
  userId: string,
  sessionId: string
): Promise<{ ok: true; data: boolean } | { ok: false; error: PostgrestError }> {
  const { data, error } = await supabase
    .from("exploration_sessions")
    .select("id")
    .eq("user_id", userId)
    .eq("id", sessionId)
    .maybeSingle();

  if (error) {
    return { ok: false, error };
  }

  return { ok: true, data: Boolean(data) };
}

function buildHistorySummaryFromSession(
  session: SessionHistoryRow,
  source: "remote"
): HistorySummary {
  const hierarchy = buildPlaceHierarchy({
    cityName: session.city_name,
    adminAreaName: session.admin_area_name,
    adminAreaDisplayName: session.admin_area_display_name,
    parentLabelEn: session.place_parent_label_en,
    parentLabelZh: session.place_parent_label_zh,
    fullLabelEn: session.place_full_label_en,
    fullLabelZh: session.place_full_label_zh
  });

  return {
    id: session.id,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    areaTitle: hierarchy.title,
    parentPath: hierarchy.parentPath,
    fullPlacePath: hierarchy.fullPath,
    source,
    userId: session.user_id,
    cityName: session.city_name ?? undefined,
    adminAreaId: session.admin_area_id ?? undefined,
    adminAreaName: session.admin_area_name ?? undefined,
    distanceMeters: session.distance_meters,
    durationSeconds: calculateDurationSeconds(session.started_at, session.ended_at),
    blockCount: session.discovered_grid_count,
    explorationPercentage: session.exploration_percentage,
    totalGridCount: session.total_grid_count ?? undefined,
    mapSnapshotDataUrl: session.map_snapshot_data_url ?? undefined,
    mapSnapshotStoragePath: session.map_snapshot_storage_path ?? undefined,
    mapSnapshotVersion: session.map_snapshot_version ?? undefined
  };
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

function isMissingColumnError(error: PostgrestError) {
  return (
    error.code === "42703" ||
    (error.message.toLowerCase().includes("column") &&
      error.message.toLowerCase().includes("does not exist"))
  );
}

function getSyncableGridIds(gridIds: string[]) {
  return gridIds.filter(isGlobalGridId);
}

function formatSupabaseError(label: string, error: PostgrestError) {
  return [label, error.message, error.code, error.details, error.hint].filter(Boolean).join(": ");
}

function formatStorageError(label: string, error: unknown) {
  if (error instanceof Error) {
    return `${label}: ${error.message}`;
  }

  if (error && typeof error === "object" && "message" in error) {
    return `${label}: ${String((error as { message?: unknown }).message)}`;
  }

  return label;
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
  anonymous_id?: string | null;
  user_id: string;
  started_at: string;
  ended_at: string;
  city_name: string | null;
  admin_area_id: string | null;
  admin_area_name: string | null;
  admin_area_display_name?: string | null;
  admin_level?: string | null;
  admin_source?: string | null;
  admin_area_m2?: number | null;
  place_parent_label_en?: string | null;
  place_parent_label_zh?: string | null;
  place_full_label_en?: string | null;
  place_full_label_zh?: string | null;
  map_snapshot_data_url?: string | null;
  map_snapshot_storage_path?: string | null;
  map_snapshot_version?: number | null;
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
