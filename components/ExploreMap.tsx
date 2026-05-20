"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { AccountMenu } from "@/components/AccountMenu";
import { createPulsingMarkerElement } from "@/components/PulsingMarker";
import {
  getAdminAreaFeatureCollection,
  getAdminAreaMaskFeatureCollection,
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
import type { AdminArea, ExplorationResult, ExplorationSession, LocationPoint } from "@/lib/types";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

type AreaTransition = {
  from: string;
  to: string;
};

type CameraMoveMode = "jump" | "fly" | "ease";
type MapPerspective = "bird" | "top";
type ViewScope = "user" | "adminArea";

const USER_VIEW_ZOOM = 16;
const BIRD_PITCH = 45;
const BIRD_BEARING = -12;
const TOP_PITCH = 0;
const TOP_BEARING = 0;

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
  const areaTransitionTimeoutRef = useRef<number | null>(null);
  const locationRetryTimeoutRef = useRef<number | null>(null);
  const cameraMoveTimeoutRef = useRef<number | null>(null);
  const programmaticCameraMoveRef = useRef(false);
  const requestCurrentPositionRef = useRef<(() => void) | null>(null);
  const hasReceivedPositionRef = useRef(false);
  const hasCenteredOnUserRef = useRef(false);
  const remoteHistoryRequestRef = useRef(0);
  const viewScopeRef = useRef<ViewScope>("user");
  const perspectiveRef = useRef<MapPerspective>("bird");
  const isFollowingUserRef = useRef(true);

  const [session, setSession] = useState<ExplorationSession | null>(null);
  const [adminArea, setAdminArea] = useState<ResolvedAdminArea["area"] | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [status, setStatus] = useState("waitingLocation");
  const [error, setError] = useState<string | null>(null);
  const [historySyncError, setHistorySyncError] = useState<string | null>(null);
  const [canRetryLocation, setCanRetryLocation] = useState(false);
  const [viewScope, setViewScope] = useState<ViewScope>("user");
  const [perspective, setPerspective] = useState<MapPerspective>("bird");
  const [isFollowingUser, setIsFollowingUser] = useState(true);
  const [isFinishPromptOpen, setIsFinishPromptOpen] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [newGridId, setNewGridId] = useState<string | null>(null);
  const [areaTransition, setAreaTransition] = useState<AreaTransition | null>(null);
  const showAdminBoundary = viewScope === "adminArea";

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

    const maskSource = map.getSource("admin-area-mask") as mapboxgl.GeoJSONSource | undefined;
    maskSource?.setData(
      area
        ? getAdminAreaMaskFeatureCollection(area)
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

  const markProgrammaticCameraMove = useCallback((duration = 700) => {
    programmaticCameraMoveRef.current = true;
    if (cameraMoveTimeoutRef.current) {
      window.clearTimeout(cameraMoveTimeoutRef.current);
    }
    cameraMoveTimeoutRef.current = window.setTimeout(() => {
      programmaticCameraMoveRef.current = false;
      cameraMoveTimeoutRef.current = null;
    }, duration + 250);
  }, []);

  const moveToUserPoint = useCallback(
    (point: LocationPoint, mode: CameraMoveMode, nextPerspective = perspectiveRef.current) => {
      const map = mapRef.current;
      if (!map) {
        return;
      }

      viewScopeRef.current = "user";
      isFollowingUserRef.current = true;
      setViewScope("user");
      setIsFollowingUser(true);
      updateAdminBoundary(null);

      const camera = {
        center: [point.lng, point.lat] as [number, number],
        zoom: USER_VIEW_ZOOM,
        ...getCameraOrientation(nextPerspective)
      };

      if (mode === "jump") {
        markProgrammaticCameraMove(0);
        map.jumpTo(camera);
        return;
      }

      if (mode === "ease") {
        markProgrammaticCameraMove(450);
        map.easeTo({ ...camera, duration: 450, essential: true });
        return;
      }

      markProgrammaticCameraMove(700);
      map.flyTo({ ...camera, speed: 1.1, essential: true });
    },
    [markProgrammaticCameraMove, updateAdminBoundary]
  );

  const moveToUserView = useCallback(
    (mode: CameraMoveMode) => {
      const latestPoint = sessionRef.current?.points.at(-1);
      if (latestPoint) {
        moveToUserPoint(latestPoint, mode);
      }
    },
    [moveToUserPoint]
  );

  const moveToAdminAreaView = useCallback(
    (
      mode: Exclude<CameraMoveMode, "jump">,
      area = adminAreaRef.current,
      nextPerspective = perspectiveRef.current
    ) => {
      const map = mapRef.current;
      if (!map || !area) {
        return;
      }

      viewScopeRef.current = "adminArea";
      isFollowingUserRef.current = false;
      setViewScope("adminArea");
      setIsFollowingUser(false);
      updateAdminBoundary(area);

      const [minLng, minLat, maxLng, maxLat] = area.area.bbox;
      markProgrammaticCameraMove(mode === "ease" ? 550 : 800);
      map.fitBounds(
        [
          [minLng, minLat],
          [maxLng, maxLat]
        ],
        {
          duration: mode === "ease" ? 550 : 650,
          maxZoom: 12.5,
          padding: { top: 170, right: 86, bottom: 130, left: 80 },
          ...getCameraOrientation(nextPerspective)
        }
      );
    },
    [markProgrammaticCameraMove, updateAdminBoundary]
  );

  const applyPerspective = useCallback(
    (nextPerspective: MapPerspective) => {
      const map = mapRef.current;
      perspectiveRef.current = nextPerspective;
      setPerspective(nextPerspective);

      if (!map) {
        return;
      }

      if (viewScopeRef.current === "adminArea" && adminAreaRef.current) {
        moveToAdminAreaView("ease", adminAreaRef.current, nextPerspective);
        return;
      }

      markProgrammaticCameraMove(450);
      map.easeTo({
        ...getCameraOrientation(nextPerspective),
        duration: 450,
        essential: true
      });
    },
    [markProgrammaticCameraMove, moveToAdminAreaView]
  );

  const toggleAdminAreaView = useCallback(() => {
    if (viewScopeRef.current === "adminArea") {
      moveToUserView("fly");
      return;
    }

    moveToAdminAreaView("fly");
  }, [moveToAdminAreaView, moveToUserView]);

  const applyAdminArea = useCallback(
    async (nextAdminArea: ResolvedAdminArea | null) => {
      const requestId = remoteHistoryRequestRef.current + 1;
      remoteHistoryRequestRef.current = requestId;
      adminAreaRef.current = nextAdminArea;
      setAdminArea(nextAdminArea?.area ?? null);
      historicalGridIdsRef.current = nextAdminArea ? getAdminDiscoveredGrids(nextAdminArea.area.id) : [];
      updateAdminBoundary(viewScopeRef.current === "adminArea" ? nextAdminArea : null);
      if (viewScopeRef.current === "adminArea" && nextAdminArea) {
        moveToAdminAreaView("fly", nextAdminArea);
      }
      updateMap(sessionRef.current);

      if (!nextAdminArea) {
        if (viewScopeRef.current === "adminArea") {
          viewScopeRef.current = "user";
          setViewScope("user");
        }
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
    [language, moveToAdminAreaView, updateAdminBoundary, updateMap]
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
          activeSession.adminArea.id !== resolvedArea.area.id
        ) {
          setAreaTransition({
            from: getAdminAreaDisplayName(activeSession.adminArea),
            to: getAdminAreaDisplayName(resolvedArea.area)
          });
          if (areaTransitionTimeoutRef.current) {
            window.clearTimeout(areaTransitionTimeoutRef.current);
          }
          areaTransitionTimeoutRef.current = window.setTimeout(() => {
            setAreaTransition(null);
          }, 6200);
          if (activeSession.discoveredGridIds.length > 0) {
            mergeAdminDiscoveredGrids(
              activeSession.adminArea.id,
              activeSession.adminArea.localName ?? activeSession.adminArea.name,
              activeSession.discoveredGridIds
            );
          }
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
        moveToUserPoint(point, "jump");
        hasCenteredOnUserRef.current = true;
      } else if (isFollowingUserRef.current && viewScopeRef.current === "user") {
        moveToUserPoint(point, "ease");
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

    },
    [moveToUserPoint, resolveAdminAreaForPoint, updateMap, updateUserMarker]
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
      pitch: BIRD_PITCH,
      bearing: BIRD_BEARING,
      preserveDrawingBuffer: true
    });

    mapRef.current = map;
    map.on("error", (event) => {
      console.error("Mapbox error", event.error);
    });

    const pauseFollowingForManualCamera = () => {
      if (programmaticCameraMoveRef.current) {
        return;
      }

      isFollowingUserRef.current = false;
      setIsFollowingUser(false);
    };

    map.on("dragstart", pauseFollowingForManualCamera);
    map.on("zoomstart", pauseFollowingForManualCamera);
    map.on("rotatestart", pauseFollowingForManualCamera);
    map.on("pitchstart", pauseFollowingForManualCamera);

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

      map.addSource("admin-area-mask", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] }
      });

      map.addLayer({
        id: "admin-area-fill",
        type: "fill",
        source: "admin-area",
        paint: {
          "fill-color": "#2dd4bf",
          "fill-opacity": 0.13
        }
      });

      map.addLayer({
        id: "admin-area-outline-glow",
        type: "line",
        source: "admin-area",
        paint: {
          "line-color": "#5eead4",
          "line-width": 9,
          "line-blur": 7,
          "line-opacity": 0.48
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

      map.addLayer({
        id: "admin-area-outside-mask",
        type: "fill",
        source: "admin-area-mask",
        paint: {
          "fill-color": "#020617",
          "fill-opacity": 0.58
        }
      });

      map.addLayer({
        id: "admin-area-outline",
        type: "line",
        source: "admin-area",
        paint: {
          "line-color": "#ccfbf1",
          "line-width": 3.2,
          "line-opacity": 0.96
        }
      });

      updateAdminBoundary(showAdminBoundary ? adminAreaRef.current : null);
      updateMap(sessionRef.current);
    });

    return () => {
      if (unlockTimeoutRef.current) {
        window.clearTimeout(unlockTimeoutRef.current);
      }
      if (areaTransitionTimeoutRef.current) {
        window.clearTimeout(areaTransitionTimeoutRef.current);
      }
      if (locationRetryTimeoutRef.current) {
        window.clearTimeout(locationRetryTimeoutRef.current);
        locationRetryTimeoutRef.current = null;
      }
      if (cameraMoveTimeoutRef.current) {
        window.clearTimeout(cameraMoveTimeoutRef.current);
        cameraMoveTimeoutRef.current = null;
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
    viewScopeRef.current = "user";
    isFollowingUserRef.current = true;
    setViewScope("user");
    setIsFollowingUser(true);
    updateAdminBoundary(null);
    updateMap(sessionRef.current);
  }, [updateAdminBoundary, updateMap]);

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
    const visibleArea = showAdminBoundary ? adminAreaRef.current : null;
    updateAdminBoundary(visibleArea);
  }, [adminArea?.id, showAdminBoundary, updateAdminBoundary]);

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
            {showAdminBoundary && adminArea ? (
              <AreaModePanel areaName={getAdminAreaDisplayName(adminArea)} language={language} />
            ) : null}
            {areaTransition ? (
              <AreaTransitionPanel transition={areaTransition} language={language} />
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-start lg:justify-end">
            <div className="grid w-full min-w-0 grid-cols-4 gap-1.5 sm:gap-2 lg:w-auto">
              <HudCard label={t(language, "time")} value={formatDuration(elapsedSeconds)} />
              <HudCard label={t(language, "dist")} value={formatDistance(stats.distanceMeters)} />
              <HudCard label={t(language, "map")} value={formatPercentage(stats.explorationPercentage)} />
              <HudCard label={t(language, "blocks")} value={String(stats.discoveredGridCount)} />
            </div>
            <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
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

      <div className="absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-2 sm:right-5">
        <CameraToolButton
          label={language === "zh" ? "回到我" : "Me"}
          sublabel={
            language === "zh"
              ? viewScope === "user" && isFollowingUser
                ? "定位"
                : "返回"
              : viewScope === "user" && isFollowingUser
                ? "Lock"
                : "Return"
          }
          active={viewScope !== "user" || !isFollowingUser}
          disabled={!session?.points.length}
          onClick={() => moveToUserView("fly")}
        />
        <CameraToolButton
          label={language === "zh" ? "区界" : "Area"}
          sublabel={
            language === "zh"
              ? viewScope === "adminArea"
                ? "回到我"
                : "全区"
              : viewScope === "adminArea"
                ? "Me"
                : "Full"
          }
          active={viewScope === "adminArea"}
          disabled={!adminArea}
          onClick={toggleAdminAreaView}
        />
        <CameraToolButton
          label={perspective === "bird" ? "2D" : "3D"}
          sublabel={
            language === "zh"
              ? perspective === "bird"
                ? "平面"
                : "鸟瞰"
              : perspective === "bird"
                ? "Flat"
                : "Tilt"
          }
          active={perspective === "top"}
          onClick={() => applyPerspective(perspective === "bird" ? "top" : "bird")}
        />
      </div>

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

function CameraToolButton({
  label,
  sublabel,
  active = false,
  disabled = false,
  onClick
}: {
  label: string;
  sublabel: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={
        active
          ? "flex h-[58px] w-[64px] flex-col items-center justify-center rounded-md border border-teal-100/40 bg-teal-300 px-2 text-center font-black text-slate-950 shadow-glow transition disabled:cursor-not-allowed disabled:opacity-45"
          : "flex h-[58px] w-[64px] flex-col items-center justify-center rounded-md border border-white/10 bg-black/46 px-2 text-center font-black text-slate-100 shadow-hud backdrop-blur-md transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45"
      }
    >
      <span className="max-w-full truncate text-xs leading-none">{label}</span>
      <span
        className={
          active
            ? "mt-1 max-w-full truncate text-[9px] font-bold uppercase leading-none text-slate-800"
            : "mt-1 max-w-full truncate text-[9px] font-bold uppercase leading-none text-slate-400"
        }
      >
        {sublabel}
      </span>
    </button>
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

function AreaModePanel({ areaName, language }: { areaName: string; language: Language }) {
  return (
    <div className="min-w-0 rounded-md border border-teal-100/25 bg-black/48 px-3 py-3 text-xs text-slate-200 shadow-hud backdrop-blur-md lg:max-w-md">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-teal-200">
            {language === "zh" ? "行政区视图" : "Area View"}
          </div>
          <div className="mt-1 truncate text-sm font-black text-white">{areaName}</div>
        </div>
        <div className="shrink-0 rounded-md border border-teal-100/30 bg-teal-300/14 px-2 py-1 font-black text-teal-100">
          {language === "zh" ? "全区" : "Full"}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <LegendItem
          colorClass="bg-slate-950/80"
          label={language === "zh" ? "区外" : "Outside"}
        />
        <LegendItem
          colorClass="border border-teal-100 bg-teal-300/30 shadow-[0_0_12px_rgba(45,212,191,0.55)]"
          label={language === "zh" ? "行政区" : "Area"}
        />
        <LegendItem
          colorClass="border-2 border-white bg-sky-300 shadow-[0_0_14px_rgba(56,189,248,0.95)]"
          label={language === "zh" ? "你" : "You"}
        />
      </div>
    </div>
  );
}

function AreaTransitionPanel({
  transition,
  language
}: {
  transition: AreaTransition;
  language: Language;
}) {
  return (
    <div className="min-w-0 rounded-md border border-sky-200/25 bg-sky-300/12 px-3 py-3 text-xs text-sky-50 shadow-hud backdrop-blur-md lg:max-w-md">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-100">
        {language === "zh" ? "跨区探索" : "Cross-area run"}
      </div>
      <div className="mt-1 truncate text-sm font-black text-white">
        {transition.from} → {transition.to}
      </div>
      <div className="mt-1 text-sky-100/80">
        {language === "zh"
          ? "上一区域进度已保留，当前行政区重新计数。"
          : "Previous area progress is kept; the current area starts a fresh count."}
      </div>
    </div>
  );
}

function LegendItem({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-white/10 bg-white/5 px-2 py-2">
      <span className={`h-3 w-3 shrink-0 rounded-full ${colorClass}`} />
      <span className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-slate-300">
        {label}
      </span>
    </div>
  );
}

function getAdminAreaDisplayName(area: AdminArea) {
  return area.localName ?? area.name;
}

function getCameraOrientation(perspective: MapPerspective) {
  return perspective === "bird"
    ? { pitch: BIRD_PITCH, bearing: BIRD_BEARING }
    : { pitch: TOP_PITCH, bearing: TOP_BEARING };
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
