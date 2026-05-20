"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { AccountMenu } from "@/components/AccountMenu";
import { createPulsingMarkerElement } from "@/components/PulsingMarker";
import {
  getAdminAreaFeatureCollection,
  isPointInAdminArea,
  resolveAdminArea,
  type ResolvedAdminArea
} from "@/lib/admin-gis";
import {
  buildGridCells,
  calculateDistance,
  calculateExplorationPercentage,
  getGridId
} from "@/lib/grid";
import { formatDistance, formatDuration, formatPercentage } from "@/lib/format";
import { LanguageToggle } from "@/components/LanguageToggle";
import {
  clearCurrentSession,
  clearLegacyDiscoveredGrids,
  getAnonymousId,
  getAdminDiscoveredGrids,
  mergeAdminDiscoveredGrids,
  saveCurrentSession,
  saveExplorationHistory,
  saveLastResult
} from "@/lib/storage";
import { getRemoteAdminDiscoveredGrids, saveResultToSupabase } from "@/lib/supabase";
import {
  applyMapLanguage,
  captureExplorationMapSnapshot,
  formatPlaceLabel,
  resolvePlaceInfo
} from "@/lib/mapbox";
import { buildResultPlaceHierarchy } from "@/lib/history";
import { getInitialLanguage, saveLanguage, t, type Language } from "@/lib/i18n";
import type { ExplorationResult, ExplorationSession, LocationPoint } from "@/lib/types";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

export function ExploreMap() {
  const router = useRouter();
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastRecordedAtRef = useRef(0);
  const sessionRef = useRef<ExplorationSession | null>(null);
  const adminAreaRef = useRef<ResolvedAdminArea | null>(null);
  const historicalGridIdsRef = useRef<string[]>([]);
  const resolvingAdminAreaRef = useRef(false);
  const resolvingCityRef = useRef(false);
  const unlockTimeoutRef = useRef<number | null>(null);
  const locationRetryTimeoutRef = useRef<number | null>(null);
  const requestCurrentPositionRef = useRef<(() => void) | null>(null);
  const hasReceivedPositionRef = useRef(false);
  const hasCenteredOnUserRef = useRef(false);
  const remoteHistoryRequestRef = useRef(0);

  const [session, setSession] = useState<ExplorationSession | null>(null);
  const [adminArea, setAdminArea] = useState<ResolvedAdminArea["area"] | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [status, setStatus] = useState("waitingLocation");
  const [error, setError] = useState<string | null>(null);
  const [historySyncError, setHistorySyncError] = useState<string | null>(null);
  const [canRetryLocation, setCanRetryLocation] = useState(false);
  const [showAdminBoundary, setShowAdminBoundary] = useState(false);
  const [isFinishPromptOpen, setIsFinishPromptOpen] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [newGridId, setNewGridId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const discoveredGridCount = session?.discoveredGridIds.length ?? 0;
    const totalGridCount = session?.totalGridCount ?? adminArea?.totalGridCount;
    return {
      distanceMeters: session?.distanceMeters ?? 0,
      discoveredGridCount,
      explorationPercentage:
        session?.explorationPercentage ??
        (totalGridCount ? calculateExplorationPercentage(discoveredGridCount, totalGridCount) : 0)
    };
  }, [adminArea, session]);

  const updateAdminBoundary = useCallback((area: ResolvedAdminArea | null) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const source = map.getSource("admin-area") as mapboxgl.GeoJSONSource | undefined;
    source?.setData(
      area
        ? getAdminAreaFeatureCollection(area)
        : { type: "FeatureCollection", features: [] }
    );
  }, []);

  const updateMap = useCallback((nextSession: ExplorationSession | null, activeGridId?: string) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) {
      return;
    }

    const routeSource = map.getSource("route") as mapboxgl.GeoJSONSource | undefined;
    routeSource?.setData({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: nextSession?.points.map((point) => [point.lng, point.lat]) ?? []
      }
    });

    const sessionGridIds = nextSession?.discoveredGridIds ?? [];
    const historicalGridIds = historicalGridIdsRef.current;
    const sessionGridIdSet = new Set(sessionGridIds);
    const historicalGridIdSet = new Set(historicalGridIds);
    const gridCells = buildGridCells(Array.from(new Set([...historicalGridIds, ...sessionGridIds])));
    const gridSource = map.getSource("discovered-grids") as mapboxgl.GeoJSONSource | undefined;
    gridSource?.setData({
      type: "FeatureCollection",
      features: gridCells.map((cell) => ({
        type: "Feature",
        properties: {
          id: cell.id,
          isHistorical: historicalGridIdSet.has(cell.id) && !sessionGridIdSet.has(cell.id),
          isNew: cell.id === activeGridId
        },
        geometry: {
          type: "Polygon",
          coordinates: [cell.polygon]
        }
      }))
    });
  }, []);

  const applyAdminArea = useCallback(
    async (nextAdminArea: ResolvedAdminArea | null) => {
      const requestId = remoteHistoryRequestRef.current + 1;
      remoteHistoryRequestRef.current = requestId;
      adminAreaRef.current = nextAdminArea;
      setAdminArea(nextAdminArea?.area ?? null);
      historicalGridIdsRef.current = nextAdminArea ? getAdminDiscoveredGrids(nextAdminArea.area.id) : [];
      updateAdminBoundary(showAdminBoundary ? nextAdminArea : null);
      updateMap(sessionRef.current);

      if (!nextAdminArea) {
        setHistorySyncError(null);
        return;
      }

      setHistorySyncError(null);
      const remoteHistory = await getRemoteAdminDiscoveredGrids(nextAdminArea.area.id);
      if (
        remoteHistoryRequestRef.current !== requestId ||
        adminAreaRef.current?.area.id !== nextAdminArea.area.id
      ) {
        return;
      }

      if (!remoteHistory.ok) {
        if (remoteHistory.reason !== "not_authenticated" && remoteHistory.reason !== "not_configured") {
          setHistorySyncError(
            t(language, "remoteHistorySyncFailed", { error: remoteHistory.error })
          );
        }
        return;
      }

      if (remoteHistory.data.length > 0) {
        historicalGridIdsRef.current = mergeAdminDiscoveredGrids(
          nextAdminArea.area.id,
          nextAdminArea.area.localName ?? nextAdminArea.area.name,
          remoteHistory.data
        );
        updateMap(sessionRef.current);
      }
    },
    [language, showAdminBoundary, updateAdminBoundary, updateMap]
  );

  const resolveAdminAreaForPoint = useCallback(
    async (point: LocationPoint) => {
      const currentArea = adminAreaRef.current;
      if (currentArea && isPointInAdminArea(point.lat, point.lng, currentArea)) {
        return currentArea;
      }

      if (resolvingAdminAreaRef.current) {
        return null;
      }

      resolvingAdminAreaRef.current = true;
      try {
        const resolvedArea = await resolveAdminArea(point.lat, point.lng);
        if (!resolvedArea) {
          await applyAdminArea(null);
          setStatus("adminAreaUnsupported");
          return null;
        }

        const activeSession = sessionRef.current;
        if (
          activeSession?.adminArea &&
          activeSession.adminArea.id !== resolvedArea.area.id &&
          activeSession.discoveredGridIds.length > 0
        ) {
          mergeAdminDiscoveredGrids(
            activeSession.adminArea.id,
            activeSession.adminArea.localName ?? activeSession.adminArea.name,
            activeSession.discoveredGridIds
          );
        }

        await applyAdminArea(resolvedArea);
        return resolvedArea;
      } catch (adminError) {
        console.error("Failed to resolve admin area", adminError);
        setError(t(language, "adminAreaLoadFailed"));
        return null;
      } finally {
        resolvingAdminAreaRef.current = false;
      }
    },
    [applyAdminArea, language]
  );

  const updateUserMarker = useCallback((point: LocationPoint) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (!markerRef.current) {
      markerRef.current = new mapboxgl.Marker({
        element: createPulsingMarkerElement(),
        anchor: "center"
      })
        .setLngLat([point.lng, point.lat])
        .addTo(map);
      return;
    }

    markerRef.current.setLngLat([point.lng, point.lat]);
  }, []);

  const centerOnUser = useCallback((point: LocationPoint, mode: "jump" | "fly") => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const camera = {
      center: [point.lng, point.lat] as [number, number],
      zoom: Math.max(map.getZoom(), 16),
      pitch: 45,
      bearing: map.getBearing()
    };

    if (mode === "jump") {
      map.jumpTo(camera);
      return;
    }

    map.flyTo({ ...camera, speed: 1.1, essential: true });
  }, []);

  const fitAdminAreaOnMap = useCallback((area: ResolvedAdminArea) => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    const [minLng, minLat, maxLng, maxLat] = area.area.bbox;
    map.fitBounds(
      [
        [minLng, minLat],
        [maxLng, maxLat]
      ],
      {
        duration: 650,
        maxZoom: 12.5,
        padding: { top: 170, right: 80, bottom: 130, left: 80 }
      }
    );
  }, []);

  const toggleAdminBoundary = useCallback(() => {
    const nextValue = !showAdminBoundary;
    setShowAdminBoundary(nextValue);
    updateAdminBoundary(nextValue ? adminAreaRef.current : null);

    if (nextValue && adminAreaRef.current) {
      fitAdminAreaOnMap(adminAreaRef.current);
      return;
    }

    const latestPoint = sessionRef.current?.points.at(-1);
    if (latestPoint) {
      centerOnUser(latestPoint, "fly");
    }
  }, [centerOnUser, fitAdminAreaOnMap, showAdminBoundary, updateAdminBoundary]);

  const handlePosition = useCallback(
    async (position: GeolocationPosition) => {
      hasReceivedPositionRef.current = true;
      setCanRetryLocation(false);
      if (locationRetryTimeoutRef.current) {
        window.clearTimeout(locationRetryTimeoutRef.current);
        locationRetryTimeoutRef.current = null;
      }
      setError(null);

      const point: LocationPoint = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        timestamp: new Date(position.timestamp || Date.now()).toISOString()
      };

      updateUserMarker(point);
      if (!hasCenteredOnUserRef.current) {
        centerOnUser(point, "jump");
        hasCenteredOnUserRef.current = true;
      }

      const now = Date.now();
      if (lastRecordedAtRef.current && now - lastRecordedAtRef.current < 3000) {
        return;
      }
      lastRecordedAtRef.current = now;

      const matchedAdminArea = await resolveAdminAreaForPoint(point);
      const current = sessionRef.current;
      const anonymousId = getAnonymousId();
      const origin = current?.origin ?? { lat: point.lat, lng: point.lng };
      const currentGridIds =
        current && current.adminArea?.id === matchedAdminArea?.area.id
          ? current.discoveredGridIds
          : [];
      const gridId = matchedAdminArea ? getGridId(point.lat, point.lng) : null;
      const isNewGrid = Boolean(
        gridId &&
          matchedAdminArea &&
          !historicalGridIdsRef.current.includes(gridId) &&
          !currentGridIds.includes(gridId)
      );
      const points = [...(current?.points ?? []), point];
      const discoveredGridIds = isNewGrid && gridId
        ? Array.from(new Set([...currentGridIds, gridId]))
        : currentGridIds;
      const distanceMeters = calculateDistance(points);
      const totalGridCount = matchedAdminArea?.area.totalGridCount;
      const explorationPercentage = totalGridCount
        ? calculateExplorationPercentage(discoveredGridIds.length, totalGridCount)
        : 0;

      const nextSession: ExplorationSession = current
        ? {
            ...current,
            adminArea: matchedAdminArea?.area,
            points,
            discoveredGridIds,
            distanceMeters,
            explorationPercentage,
            totalGridCount,
            newlyClaimedGridCount: discoveredGridIds.length
          }
        : {
            id: crypto.randomUUID(),
            anonymousId,
            startedAt: new Date().toISOString(),
            cityName: "Nearby Blocks",
            adminArea: matchedAdminArea?.area,
            origin,
            points,
            discoveredGridIds,
            distanceMeters,
            explorationPercentage,
            totalGridCount,
            newlyClaimedGridCount: discoveredGridIds.length
          };

      sessionRef.current = nextSession;
      setSession(nextSession);
      saveCurrentSession(nextSession);
      updateMap(nextSession, isNewGrid && gridId ? gridId : undefined);
      if (matchedAdminArea) {
        setStatus("explorationActive");
      }

      if (isNewGrid && gridId) {
        setNewGridId(gridId);
        if (unlockTimeoutRef.current) {
          window.clearTimeout(unlockTimeoutRef.current);
        }
        unlockTimeoutRef.current = window.setTimeout(() => {
          setNewGridId((currentGridId) => (currentGridId === gridId ? null : currentGridId));
          updateMap(sessionRef.current ?? nextSession);
        }, 800);
      }

      if (!current && !resolvingCityRef.current) {
        resolvingCityRef.current = true;
        void resolvePlaceInfo(point.lat, point.lng).then((placeInfo) => {
          const latest = sessionRef.current;
          if (!latest) {
            return;
          }

          const updatedSession = { ...latest, placeInfo, cityName: placeInfo.label };
          sessionRef.current = updatedSession;
          setSession(updatedSession);
          saveCurrentSession(updatedSession);
          if (adminAreaRef.current) {
            setStatus("explorationActive");
          }
        });
      }

      if (mapRef.current && nextSession.points.length <= 2) {
        centerOnUser(point, "fly");
      }
    },
    [centerOnUser, resolveAdminAreaForPoint, updateMap, updateUserMarker]
  );

  const scheduleLocationRetry = useCallback(() => {
    if (locationRetryTimeoutRef.current) {
      return;
    }

    locationRetryTimeoutRef.current = window.setTimeout(() => {
      locationRetryTimeoutRef.current = null;
      requestCurrentPositionRef.current?.();
    }, 3000);
  }, []);

  const handleLocationError = useCallback(
    (geoError: GeolocationPositionError) => {
      if (geoError.code === geoError.PERMISSION_DENIED) {
        setError(t(language, "locationDenied"));
        setStatus("locationUnavailable");
        setCanRetryLocation(true);
        return;
      }

      if (hasReceivedPositionRef.current) {
        scheduleLocationRetry();
        return;
      }

      setError(t(language, "locationRetrying"));
      setStatus("waitingLocation");
      setCanRetryLocation(true);
      scheduleLocationRetry();
    },
    [language, scheduleLocationRetry]
  );

  const requestCurrentPosition = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setError(t(language, "geolocationUnavailable"));
      setStatus("locationUnavailable");
      setCanRetryLocation(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(handlePosition, handleLocationError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 20000
    });
  }, [handleLocationError, handlePosition, language]);

  useEffect(() => {
    requestCurrentPositionRef.current = requestCurrentPosition;
  }, [requestCurrentPosition]);

  useEffect(() => {
    if (!mapboxToken) {
      setError(t(language, "missingMapToken"));
      return;
    }

    if (!mapContainerRef.current || mapRef.current) {
      return;
    }

    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: [0, 0],
      zoom: 14,
      pitch: 45,
      bearing: -12,
      preserveDrawingBuffer: true
    });

    mapRef.current = map;
    map.on("error", (event) => {
      console.error("Mapbox error", event.error);
    });
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");

    map.on("load", () => {
      applyMapLanguage(map, language);
      map.addSource("route", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [] }
        }
      });

      map.addSource("discovered-grids", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      map.addSource("admin-area", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      map.addLayer({
        id: "admin-area-fill",
        type: "fill",
        source: "admin-area",
        paint: {
          "fill-color": "#14b8a6",
          "fill-opacity": 0.08
        }
      });

      map.addLayer({
        id: "admin-area-outline",
        type: "line",
        source: "admin-area",
        paint: {
          "line-color": "#5eead4",
          "line-width": 2,
          "line-opacity": 0.8
        }
      });

      map.addLayer({
        id: "discovered-grid-glow",
        type: "line",
        source: "discovered-grids",
        paint: {
          "line-color": ["case", ["==", ["get", "isNew"], true], "#f0fdfa", "#5eead4"],
          "line-width": ["case", ["==", ["get", "isNew"], true], 12, 7],
          "line-blur": ["case", ["==", ["get", "isNew"], true], 12, 9],
          "line-opacity": [
            "case",
            ["==", ["get", "isNew"], true],
            0.95,
            ["==", ["get", "isHistorical"], true],
            0.28,
            0.55
          ]
        }
      });

      map.addLayer({
        id: "discovered-grid-fill",
        type: "fill",
        source: "discovered-grids",
        paint: {
          "fill-color": ["case", ["==", ["get", "isNew"], true], "#67e8f9", "#2dd4bf"],
          "fill-opacity": [
            "case",
            ["==", ["get", "isNew"], true],
            0.58,
            ["==", ["get", "isHistorical"], true],
            0.18,
            0.32
          ]
        }
      });

      map.addLayer({
        id: "discovered-grid-outline",
        type: "line",
        source: "discovered-grids",
        paint: {
          "line-color": ["case", ["==", ["get", "isNew"], true], "#ffffff", "#99f6e4"],
          "line-width": [
            "case",
            ["==", ["get", "isNew"], true],
            3.5,
            ["==", ["get", "isHistorical"], true],
            1.4,
            2
          ],
          "line-opacity": ["case", ["==", ["get", "isHistorical"], true], 0.62, 0.94]
        }
      });

      map.addLayer({
        id: "route-halo",
        type: "line",
        source: "route",
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": "#0ea5e9",
          "line-width": 14,
          "line-blur": 10,
          "line-opacity": 0.45
        }
      });

      map.addLayer({
        id: "route-line",
        type: "line",
        source: "route",
        layout: {
          "line-cap": "round",
          "line-join": "round"
        },
        paint: {
          "line-color": "#38bdf8",
          "line-width": 6,
          "line-blur": 1
        }
      });

      updateAdminBoundary(showAdminBoundary ? adminAreaRef.current : null);
      updateMap(sessionRef.current);
    });

    return () => {
      if (unlockTimeoutRef.current) {
        window.clearTimeout(unlockTimeoutRef.current);
      }
      if (locationRetryTimeoutRef.current) {
        window.clearTimeout(locationRetryTimeoutRef.current);
        locationRetryTimeoutRef.current = null;
      }
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Mapbox instance is created once; language changes are applied by the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    clearLegacyDiscoveredGrids();
    historicalGridIdsRef.current = [];
    sessionRef.current = null;
    lastRecordedAtRef.current = 0;
    resolvingCityRef.current = false;
    hasCenteredOnUserRef.current = false;
    updateMap(sessionRef.current);
  }, [updateMap]);

  useEffect(() => {
    if (!mapboxToken || !("geolocation" in navigator)) {
      if (!("geolocation" in navigator)) {
        setError(t(language, "geolocationUnavailable"));
        setStatus("locationUnavailable");
        setCanRetryLocation(false);
      }
      return;
    }

    requestCurrentPosition();

    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, handleLocationError, {
      enableHighAccuracy: true,
      maximumAge: 10000,
      timeout: 30000
    });

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      if (locationRetryTimeoutRef.current) {
        window.clearTimeout(locationRetryTimeoutRef.current);
        locationRetryTimeoutRef.current = null;
      }
    };
  }, [handleLocationError, handlePosition, language, requestCurrentPosition]);

  function retryLocation() {
    setCanRetryLocation(false);
    setError(t(language, "locationRetrying"));
    setStatus("waitingLocation");
    requestCurrentPosition();
  }

  useEffect(() => {
    setLanguage(getInitialLanguage());
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) {
      applyMapLanguage(map, language);
    }
  }, [language]);

  useEffect(() => {
    updateAdminBoundary(showAdminBoundary ? adminAreaRef.current : null);
  }, [showAdminBoundary, updateAdminBoundary]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const current = sessionRef.current;
      if (!current) {
        return;
      }

      setElapsedSeconds(
        Math.max(0, Math.floor((Date.now() - new Date(current.startedAt).getTime()) / 1000))
      );
    }, 1000);

    return () => window.clearInterval(timer);
  }, []);

  function openFinishPrompt() {
    const current = sessionRef.current;
    if (!current || current.points.length === 0) {
      setError(t(language, "noPoints"));
      return;
    }

    setIsFinishPromptOpen(true);
  }

  async function finishExploration(shouldSave: boolean) {
    const current = sessionRef.current;
    if (!current || current.points.length === 0) {
      setError(t(language, "noPoints"));
      return;
    }

    setIsFinishing(true);
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    if (!shouldSave) {
      clearCurrentSession();
      sessionRef.current = null;
      setSession(null);
      router.push("/");
      return;
    }

    const endedAt = new Date().toISOString();
    const mapSnapshotDataUrl =
      (await captureExplorationMapSnapshot(
        mapRef.current,
        current.discoveredGridIds,
        current.points
      )) ?? undefined;
    const result: ExplorationResult = {
      id: current.id,
      anonymousId: current.anonymousId,
      startedAt: current.startedAt,
      endedAt,
      cityName: current.cityName,
      placeInfo: current.placeInfo,
      points: current.points,
      discoveredGridIds: current.discoveredGridIds,
      distanceMeters: current.distanceMeters,
      newlyClaimedGridCount: current.discoveredGridIds.length,
      mapSnapshotDataUrl,
      mapSnapshotVersion: mapSnapshotDataUrl ? 2 : undefined,
      durationSeconds: Math.max(
        1,
        Math.floor((new Date(endedAt).getTime() - new Date(current.startedAt).getTime()) / 1000)
      ),
      explorationPercentage: current.explorationPercentage,
      totalGridCount: current.totalGridCount,
      adminArea: current.adminArea,
      userId: current.userId,
      syncMode: current.syncMode,
      placeHierarchy: buildResultPlaceHierarchy({
        id: current.id,
        anonymousId: current.anonymousId,
        startedAt: current.startedAt,
        endedAt,
        cityName: current.cityName,
        placeInfo: current.placeInfo,
        points: current.points,
        discoveredGridIds: current.discoveredGridIds,
        distanceMeters: current.distanceMeters,
        newlyClaimedGridCount: current.discoveredGridIds.length,
        durationSeconds: Math.max(
          1,
          Math.floor((new Date(endedAt).getTime() - new Date(current.startedAt).getTime()) / 1000)
        ),
        explorationPercentage: current.explorationPercentage,
        totalGridCount: current.totalGridCount,
        adminArea: current.adminArea
      })
    };

    if (current.adminArea) {
      mergeAdminDiscoveredGrids(
        current.adminArea.id,
        current.adminArea.localName ?? current.adminArea.name,
        result.discoveredGridIds
      );
    }
    saveLastResult(result);
    saveExplorationHistory(result);
    clearCurrentSession();
    const syncResult = await saveResultToSupabase(result);
    const syncedResult = syncResult.ok
      ? {
          ...result,
          userId: syncResult.userId,
          syncMode: syncResult.syncMode,
          supabaseSyncedAt: syncResult.syncedAt
        }
      : { ...result, supabaseSyncError: syncResult.error };
    saveLastResult(syncedResult);
    saveExplorationHistory(syncedResult);
    router.push("/result");
  }

  const statusMessage =
    error ??
    historySyncError ??
    t(
      language,
      status as
        | "waitingLocation"
        | "explorationActive"
        | "locationUnavailable"
        | "adminAreaUnsupported"
    );

  return (
    <main className="explore-map relative h-[100dvh] min-h-screen w-screen overflow-hidden bg-slate-950">
      <div ref={mapContainerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.01)_36%,rgba(2,6,23,0.42)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.08)_1px,transparent_1px)] bg-[size:52px_52px]" />
      {newGridId ? <div className="pointer-events-none absolute inset-0 animate-territory-flash" /> : null}

      <section className="absolute left-3 right-3 top-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 sm:left-5 sm:right-5 sm:top-5">
        <div className="grid gap-2 lg:grid-cols-[minmax(18rem,32rem)_minmax(0,1fr)] lg:items-start lg:gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="min-w-0 rounded-md border border-teal-200/20 bg-black/32 px-3 py-2 shadow-hud backdrop-blur-md">
              <div className="text-[11px] font-black uppercase tracking-[0.22em] text-teal-200">
                RoamGrid
              </div>
              <div className="mt-1 line-clamp-2 text-base font-black leading-snug text-white sm:line-clamp-none sm:truncate sm:text-xl">
                {t(language, "exploring", { place: getExplorePlaceLabel(session, adminArea, language) })}
              </div>
            </div>
            <div className="min-w-0 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200 shadow-hud backdrop-blur-md lg:max-w-md">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <div className="truncate">{statusMessage}</div>
                {canRetryLocation ? (
                  <button
                    type="button"
                    onClick={retryLocation}
                    className="shrink-0 rounded-md border border-teal-200/20 bg-teal-300/12 px-2 py-1 text-[11px] font-black text-teal-100 transition hover:bg-teal-300/20"
                  >
                    {t(language, "retryLocation")}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-start lg:justify-end">
            <div className="grid w-full min-w-0 grid-cols-4 gap-1.5 sm:gap-2 lg:w-auto">
              <HudCard label={t(language, "time")} value={formatDuration(elapsedSeconds)} />
              <HudCard label={t(language, "dist")} value={formatDistance(stats.distanceMeters)} />
              <HudCard label={t(language, "map")} value={formatPercentage(stats.explorationPercentage)} />
              <HudCard label={t(language, "blocks")} value={String(stats.discoveredGridCount)} />
            </div>
            <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
              <button
                type="button"
                onClick={toggleAdminBoundary}
                className={
                  showAdminBoundary
                    ? "rounded-md bg-teal-300 px-2.5 py-2 text-xs font-black text-slate-950 shadow-glow"
                    : "rounded-md border border-white/10 bg-black/40 px-2.5 py-2 text-xs font-bold text-slate-100 shadow-hud backdrop-blur-md transition hover:bg-white/10"
                }
              >
                {language === "zh" ? "区界" : "Area"}
              </button>
              <LanguageToggle
                language={language}
                onChange={(nextLanguage) => {
                  setLanguage(nextLanguage);
                  saveLanguage(nextLanguage);
                }}
              />
              <AccountMenu language={language} compact />
            </div>
          </div>
        </div>
      </section>

      {error && !mapboxToken ? (
        <div className="absolute inset-0 z-20 grid place-items-center bg-slate-950/92 px-6 text-center">
          <div className="max-w-lg rounded-lg border border-white/10 bg-white/5 p-6 shadow-hud">
            <h1 className="text-2xl font-bold text-white">{t(language, "mapTokenRequired")}</h1>
            <p className="mt-3 text-slate-300">{error}</p>
          </div>
        </div>
      ) : null}

      {newGridId ? (
        <div className="pointer-events-none absolute bottom-28 left-1/2 z-10 -translate-x-1/2 rounded-md border border-teal-100/30 bg-teal-300/16 px-6 py-4 text-center shadow-glow backdrop-blur-md">
          <div className="text-[11px] font-black uppercase tracking-[0.2em] text-teal-100">
            {t(language, "gridDiscovered")}
          </div>
          <div className="mt-1 text-2xl font-black text-white">{t(language, "plusOneBlock")}</div>
        </div>
      ) : null}

      <div className="absolute bottom-3 bottom-[calc(env(safe-area-inset-bottom)+0.75rem)] left-3 right-3 z-10 sm:bottom-5 sm:left-1/2 sm:right-auto sm:w-[360px] sm:-translate-x-1/2">
        <button
          type="button"
          onClick={openFinishPrompt}
          disabled={isFinishing}
          className="w-full rounded-lg bg-teal-300 px-5 py-4 text-base font-black text-slate-950 shadow-glow transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isFinishing ? t(language, "saving") : t(language, "finishExploration")}
        </button>
      </div>

      {isFinishPromptOpen ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-slate-950/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-white/10 bg-slate-950 p-5 shadow-hud">
            <h2 className="text-2xl font-black text-white">
              {language === "zh" ? "保存本次探索？" : "Save this exploration?"}
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {language === "zh"
                ? "技术测试时可以丢弃无效记录。保存后会写入本地历史和 Supabase；不保存会清除本次轨迹。"
                : "For technical tests, discard invalid runs. Saving writes this session to local history and Supabase; discarding clears this route."}
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <button
                type="button"
                onClick={() => void finishExploration(true)}
                disabled={isFinishing}
                className="rounded-lg bg-teal-300 px-4 py-3 font-black text-slate-950 shadow-glow disabled:cursor-not-allowed disabled:opacity-60"
              >
                {language === "zh" ? "保存" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void finishExploration(false)}
                disabled={isFinishing}
                className="rounded-lg border border-rose-200/20 bg-rose-300/10 px-4 py-3 font-bold text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {language === "zh" ? "不保存" : "Discard"}
              </button>
              <button
                type="button"
                onClick={() => setIsFinishPromptOpen(false)}
                disabled={isFinishing}
                className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {language === "zh" ? "继续探索" : "Continue"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function HudCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-white/10 bg-black/38 px-2 py-2 text-center shadow-hud backdrop-blur-md sm:min-w-[92px] sm:px-3">
      <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400 sm:text-[10px]">
        {label}
      </div>
      <div className="mt-1 truncate text-sm font-black text-white sm:text-lg">{value}</div>
    </div>
  );
}

function getExplorePlaceLabel(
  session: ExplorationSession | null,
  adminArea: ResolvedAdminArea["area"] | null,
  language: Language
) {
  const basePlace = formatPlaceLabel(session?.placeInfo, language);
  const adminName =
    adminArea?.localName ??
    adminArea?.name ??
    session?.adminArea?.localName ??
    session?.adminArea?.name;

  if (adminName && basePlace && !basePlace.toLowerCase().includes(adminName.toLowerCase())) {
    return `${basePlace} · ${adminName}`;
  }

  return adminName ?? basePlace;
}
