"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import mapboxgl from "mapbox-gl";
import { createPulsingMarkerElement } from "@/components/PulsingMarker";
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
  getAnonymousId,
  getDiscoveredGrids,
  mergeDiscoveredGrids,
  saveCurrentSession,
  saveLastResult
} from "@/lib/storage";
import { saveResultToSupabase } from "@/lib/supabase";
import { applyMapLanguage, captureMapSnapshot, formatPlaceLabel, resolvePlaceInfo } from "@/lib/mapbox";
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
  const historicalGridIdsRef = useRef<string[]>([]);
  const resolvingCityRef = useRef(false);
  const unlockTimeoutRef = useRef<number | null>(null);
  const hasCenteredOnUserRef = useRef(false);

  const [session, setSession] = useState<ExplorationSession | null>(null);
  const [language, setLanguage] = useState<Language>("en");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [status, setStatus] = useState("waitingLocation");
  const [error, setError] = useState<string | null>(null);
  const [isFinishing, setIsFinishing] = useState(false);
  const [newGridId, setNewGridId] = useState<string | null>(null);

  const stats = useMemo(() => {
    const discoveredGridCount = session?.discoveredGridIds.length ?? 0;
    return {
      distanceMeters: session?.distanceMeters ?? 0,
      discoveredGridCount,
      explorationPercentage:
        session?.explorationPercentage ?? calculateExplorationPercentage(discoveredGridCount)
    };
  }, [session]);

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

  const handlePosition = useCallback(
    (position: GeolocationPosition) => {
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

      const current = sessionRef.current;
      const anonymousId = getAnonymousId();
      const origin = current?.origin ?? { lat: point.lat, lng: point.lng };
      const gridId = getGridId(point.lat, point.lng);
      const currentGridIds = current?.discoveredGridIds ?? [];
      const isNewGrid =
        !historicalGridIdsRef.current.includes(gridId) && !currentGridIds.includes(gridId);
      const points = [...(current?.points ?? []), point];
      const discoveredGridIds = isNewGrid
        ? Array.from(new Set([...currentGridIds, gridId]))
        : currentGridIds;
      const distanceMeters = calculateDistance(points);
      const explorationPercentage = calculateExplorationPercentage(discoveredGridIds.length);

      const nextSession: ExplorationSession = current
        ? {
            ...current,
            points,
            discoveredGridIds,
            distanceMeters,
            explorationPercentage,
            newlyClaimedGridCount: discoveredGridIds.length
          }
        : {
            id: crypto.randomUUID(),
            anonymousId,
            startedAt: new Date().toISOString(),
            cityName: "Nearby Blocks",
            origin,
            points,
            discoveredGridIds,
            distanceMeters,
            explorationPercentage,
            newlyClaimedGridCount: discoveredGridIds.length
          };

      sessionRef.current = nextSession;
      setSession(nextSession);
      saveCurrentSession(nextSession);
      updateMap(nextSession, isNewGrid ? gridId : undefined);
      setStatus("explorationActive");

      if (isNewGrid) {
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
          setStatus("explorationActive");
        });
      }

      if (mapRef.current && nextSession.points.length <= 2) {
        centerOnUser(point, "fly");
      }
    },
    [centerOnUser, updateMap, updateUserMarker]
  );

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

      updateMap(sessionRef.current);
    });

    return () => {
      if (unlockTimeoutRef.current) {
        window.clearTimeout(unlockTimeoutRef.current);
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
    historicalGridIdsRef.current = getDiscoveredGrids();
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
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      handlePosition,
      (geoError) => {
        setError(
          geoError.code === geoError.PERMISSION_DENIED
            ? t(language, "locationDenied")
            : geoError.message
        );
        setStatus("locationUnavailable");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 12000
      }
    );

    watchIdRef.current = navigator.geolocation.watchPosition(handlePosition, (geoError) => {
      setError(
        geoError.code === geoError.PERMISSION_DENIED
          ? t(language, "locationDenied")
          : geoError.message
      );
      setStatus("locationUnavailable");
    }, {
      enableHighAccuracy: true,
      maximumAge: 1000,
      timeout: 15000
    });

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [handlePosition, language]);

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

  async function finishExploration() {
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

    const endedAt = new Date().toISOString();
    const mapSnapshotDataUrl = captureMapSnapshot(mapRef.current) ?? undefined;
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
      durationSeconds: Math.max(
        1,
        Math.floor((new Date(endedAt).getTime() - new Date(current.startedAt).getTime()) / 1000)
      ),
      explorationPercentage: current.explorationPercentage
    };

    mergeDiscoveredGrids(result.discoveredGridIds);
    saveLastResult(result);
    clearCurrentSession();
    const syncResult = await saveResultToSupabase(result);
    saveLastResult(
      syncResult.ok
        ? { ...result, supabaseSyncedAt: syncResult.syncedAt }
        : { ...result, supabaseSyncError: syncResult.error }
    );
    router.push("/result");
  }

  const statusMessage =
    error ?? t(language, status as "waitingLocation" | "explorationActive" | "locationUnavailable");

  return (
    <main className="explore-map relative h-[100dvh] min-h-screen w-screen overflow-hidden bg-slate-950">
      <div ref={mapContainerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.01)_36%,rgba(2,6,23,0.42)_100%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(15,23,42,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(15,23,42,0.08)_1px,transparent_1px)] bg-[size:52px_52px]" />
      {newGridId ? <div className="pointer-events-none absolute inset-0 animate-territory-flash" /> : null}

      <section className="absolute left-3 right-3 top-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 flex flex-col gap-2 sm:left-5 sm:right-5 sm:top-5 sm:gap-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 rounded-md border border-teal-200/20 bg-black/32 px-3 py-2 shadow-hud backdrop-blur-md sm:max-w-[48vw]">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-teal-200">
              RoamGrid
            </div>
            <div className="mt-1 line-clamp-2 text-base font-black leading-snug text-white sm:line-clamp-none sm:truncate sm:text-xl">
              {t(language, "exploring", {
                place: formatPlaceLabel(session?.placeInfo, language)
              })}
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <div className="grid min-w-0 grid-cols-4 gap-1.5 sm:gap-2">
              <HudCard label={t(language, "time")} value={formatDuration(elapsedSeconds)} />
              <HudCard label={t(language, "dist")} value={formatDistance(stats.distanceMeters)} />
              <HudCard label={t(language, "map")} value={formatPercentage(stats.explorationPercentage)} />
              <HudCard label={t(language, "blocks")} value={String(stats.discoveredGridCount)} />
            </div>
            <div className="flex items-start gap-2 sm:block">
              <div className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200 shadow-hud backdrop-blur-md sm:hidden">
                <div className="truncate">{statusMessage}</div>
              </div>
              <LanguageToggle
                language={language}
                onChange={(nextLanguage) => {
                  setLanguage(nextLanguage);
                  saveLanguage(nextLanguage);
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="absolute left-5 top-24 z-10 hidden max-w-md rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-slate-200 shadow-hud backdrop-blur-md sm:block">
        <div>{statusMessage}</div>
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
          onClick={finishExploration}
          disabled={isFinishing}
          className="w-full rounded-lg bg-teal-300 px-5 py-4 text-base font-black text-slate-950 shadow-glow transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isFinishing ? t(language, "saving") : t(language, "finishExploration")}
        </button>
      </div>
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
