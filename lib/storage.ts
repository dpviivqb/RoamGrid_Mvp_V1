import type { ExplorationResult, ExplorationSession } from "@/lib/types";
import { isGlobalGridId } from "@/lib/grid";

export const STORAGE_KEYS = {
  anonymousId: "roamgrid_anonymous_id",
  currentSession: "roamgrid_current_session",
  lastResult: "roamgrid_last_result",
  discoveredGrids: "roamgrid_discovered_grids",
  language: "roamgrid_language"
} as const;

export function getAnonymousId() {
  if (typeof window === "undefined") {
    return "";
  }

  const existing = window.localStorage.getItem(STORAGE_KEYS.anonymousId);
  if (existing) {
    return existing;
  }

  const id = crypto.randomUUID();
  window.localStorage.setItem(STORAGE_KEYS.anonymousId, id);
  return id;
}

export function saveCurrentSession(session: ExplorationSession) {
  window.localStorage.setItem(STORAGE_KEYS.currentSession, JSON.stringify(session));
}

export function getCurrentSession() {
  const value = window.localStorage.getItem(STORAGE_KEYS.currentSession);
  return value ? (JSON.parse(value) as ExplorationSession) : null;
}

export function clearCurrentSession() {
  window.localStorage.removeItem(STORAGE_KEYS.currentSession);
}

export function saveLastResult(result: ExplorationResult) {
  window.localStorage.setItem(STORAGE_KEYS.lastResult, JSON.stringify(result));
}

export function getLastResult() {
  if (typeof window === "undefined") {
    return null;
  }

  const value = window.localStorage.getItem(STORAGE_KEYS.lastResult);
  return value ? (JSON.parse(value) as ExplorationResult) : null;
}

export function mergeDiscoveredGrids(gridIds: string[]) {
  const existingValue = window.localStorage.getItem(STORAGE_KEYS.discoveredGrids);
  const existing = parseGridIds(existingValue);
  const merged = Array.from(new Set([...existing, ...gridIds])).filter(isGlobalGridId);
  window.localStorage.setItem(STORAGE_KEYS.discoveredGrids, JSON.stringify(merged));
  return merged;
}

export function getDiscoveredGrids() {
  if (typeof window === "undefined") {
    return [];
  }

  const value = window.localStorage.getItem(STORAGE_KEYS.discoveredGrids);
  const gridIds = parseGridIds(value);
  const globalGridIds = gridIds.filter(isGlobalGridId);

  if (gridIds.length !== globalGridIds.length) {
    if (globalGridIds.length === 0) {
      window.localStorage.removeItem(STORAGE_KEYS.discoveredGrids);
    } else {
      window.localStorage.setItem(STORAGE_KEYS.discoveredGrids, JSON.stringify(globalGridIds));
    }
  }

  return globalGridIds;
}

function parseGridIds(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
