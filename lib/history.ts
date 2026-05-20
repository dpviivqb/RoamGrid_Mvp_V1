import type {
  AdminArea,
  ExplorationResult,
  HistoryDetail,
  HistorySource,
  HistorySummary,
  LocalizedText,
  PlaceHierarchy,
  PlaceInfo
} from "@/lib/types";

const FALLBACK_TITLE: LocalizedText = {
  en: "Nearby Blocks",
  zh: "附近区域"
};

const FALLBACK_PARENT: LocalizedText = {
  en: "RoamGrid",
  zh: "RoamGrid"
};

type PlaceHierarchyInput = {
  placeInfo?: PlaceInfo;
  adminArea?: AdminArea;
  cityName?: string | null;
  adminAreaName?: string | null;
  adminAreaDisplayName?: string | null;
  parentLabelEn?: string | null;
  parentLabelZh?: string | null;
  fullLabelEn?: string | null;
  fullLabelZh?: string | null;
};

export function buildPlaceHierarchy(input: PlaceHierarchyInput): PlaceHierarchy {
  const title = buildTitle(input);
  const parentPath: LocalizedText = {
    en:
      cleanLabel(input.parentLabelEn) ??
      cleanParentPath(input.fullLabelEn, title.en) ??
      cleanParentPath(input.placeInfo?.localized.en, title.en) ??
      cleanParentPath(input.cityName, title.en) ??
      FALLBACK_PARENT.en,
    zh:
      cleanLabel(input.parentLabelZh) ??
      cleanParentPath(input.fullLabelZh, title.zh) ??
      cleanParentPath(input.placeInfo?.localized.zh, title.zh) ??
      cleanParentPath(input.cityName, title.zh) ??
      FALLBACK_PARENT.zh
  };

  const fullPath: LocalizedText = {
    en: cleanLabel(input.fullLabelEn) ?? joinPath(parentPath.en, title.en),
    zh: cleanLabel(input.fullLabelZh) ?? joinPath(parentPath.zh, title.zh)
  };

  return { title, parentPath, fullPath };
}

export function buildResultPlaceHierarchy(result: ExplorationResult) {
  return (
    result.placeHierarchy ??
    buildPlaceHierarchy({
      placeInfo: result.placeInfo,
      adminArea: result.adminArea,
      cityName: result.cityName
    })
  );
}

export function historySummaryFromResult(
  result: ExplorationResult,
  source: HistorySource = "local"
): HistorySummary {
  const hierarchy = buildResultPlaceHierarchy(result);

  return {
    id: result.id,
    startedAt: result.startedAt,
    endedAt: result.endedAt,
    areaTitle: hierarchy.title,
    parentPath: hierarchy.parentPath,
    fullPlacePath: hierarchy.fullPath,
    source,
    userId: result.userId,
    cityName: result.cityName,
    adminAreaId: result.adminArea?.id,
    adminAreaName: result.adminArea?.localName ?? result.adminArea?.name,
    distanceMeters: result.distanceMeters,
    durationSeconds: result.durationSeconds,
    blockCount: result.newlyClaimedGridCount ?? result.discoveredGridIds.length,
    explorationPercentage: result.explorationPercentage,
    totalGridCount: result.totalGridCount ?? result.adminArea?.totalGridCount,
    mapSnapshotDataUrl: result.mapSnapshotDataUrl
  };
}

export function historyDetailFromResult(
  result: ExplorationResult,
  source: HistorySource = "local"
): HistoryDetail {
  return {
    ...historySummaryFromResult(result, source),
    points: result.points,
    discoveredGridIds: result.discoveredGridIds,
    adminArea: result.adminArea,
    placeInfo: result.placeInfo
  };
}

export function mergeHistorySummaries(summaries: HistorySummary[]) {
  const merged = new Map<string, HistorySummary>();

  summaries.forEach((summary) => {
    const existing = merged.get(summary.id);
    if (!existing) {
      merged.set(summary.id, summary);
      return;
    }

    merged.set(summary.id, {
      ...existing,
      ...summary,
      source: mergeSources(existing.source, summary.source),
      mapSnapshotDataUrl: existing.mapSnapshotDataUrl ?? summary.mapSnapshotDataUrl
    });
  });

  return Array.from(merged.values()).sort(
    (left, right) => new Date(right.endedAt).getTime() - new Date(left.endedAt).getTime()
  );
}

export function mergeHistoryDetails(
  localDetail: HistoryDetail | null,
  remoteDetail: HistoryDetail | null
) {
  if (localDetail && remoteDetail) {
    return {
      ...remoteDetail,
      ...localDetail,
      source: "local_remote" as const,
      userId: remoteDetail.userId ?? localDetail.userId,
      blockCount: Math.max(localDetail.blockCount, remoteDetail.blockCount),
      discoveredGridIds:
        localDetail.discoveredGridIds.length > 0
          ? localDetail.discoveredGridIds
          : remoteDetail.discoveredGridIds
    };
  }

  return localDetail ?? remoteDetail;
}

export function hasLocalHistorySource(source: HistorySource) {
  return source === "local" || source === "local_remote";
}

export function hasRemoteHistorySource(source: HistorySource) {
  return source === "remote" || source === "local_remote";
}

export function calculateResultXp(distanceMeters: number) {
  return Math.max(1, Math.round(distanceMeters / 50));
}

function buildTitle(input: PlaceHierarchyInput): LocalizedText {
  const adminName = cleanLabel(input.adminAreaName);
  const adminDisplayName = cleanLabel(input.adminAreaDisplayName);
  const adminAreaName = cleanLabel(input.adminArea?.name);
  const adminLocalName = cleanLabel(input.adminArea?.localName);
  const cityName = cleanLastPathPart(input.cityName);

  return {
    en:
      adminDisplayName ??
      adminAreaName ??
      adminLocalName ??
      adminName ??
      cityName ??
      FALLBACK_TITLE.en,
    zh:
      adminLocalName ??
      adminDisplayName ??
      adminAreaName ??
      adminName ??
      cleanLastPathPart(input.placeInfo?.localized.zh) ??
      cityName ??
      FALLBACK_TITLE.zh
  };
}

function cleanParentPath(value: string | null | undefined, title: string) {
  const label = cleanLabel(value);
  if (!label) {
    return null;
  }

  const parts = splitPath(label);
  const titleKey = normalizeLabel(title);
  const filteredParts = parts.filter((part, index) => {
    if (index !== parts.length - 1) {
      return true;
    }

    return normalizeLabel(part) !== titleKey;
  });

  if (filteredParts.length === 0) {
    return null;
  }

  return filteredParts.join(" · ");
}

function cleanLastPathPart(value: string | null | undefined) {
  const label = cleanLabel(value);
  if (!label) {
    return null;
  }

  return splitPath(label).at(-1) ?? label;
}

function joinPath(parentPath: string, title: string) {
  if (!parentPath || normalizeLabel(parentPath) === normalizeLabel(title)) {
    return title;
  }

  if (splitPath(parentPath).some((part) => normalizeLabel(part) === normalizeLabel(title))) {
    return parentPath;
  }

  return `${parentPath} · ${title}`;
}

function splitPath(value: string) {
  return value
    .split("·")
    .map((part) => part.trim())
    .filter(Boolean);
}

function cleanLabel(value: string | null | undefined) {
  const label = value?.trim();
  return label ? label : null;
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase();
}

function mergeSources(left: HistorySource, right: HistorySource): HistorySource {
  if (left === right) {
    return left;
  }

  return "local_remote";
}
