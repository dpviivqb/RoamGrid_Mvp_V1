"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { createPulsingMarkerElement } from "@/components/PulsingMarker";
import { applyMapLanguage, formatPlaceLabel, resolvePlaceInfo } from "@/lib/mapbox";
import type { Language } from "@/lib/i18n";
import type { PlaceInfo } from "@/lib/types";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const FALLBACK_CENTER: [number, number] = [120.1551, 30.2741];
const PLACE_REFRESH_DISTANCE_METERS = 1000;

export function HomeLiveMapPreview({
  language,
  place,
  status,
  fallback
}: {
  language: Language;
  place: string;
  status: string;
  fallback: string;
}) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markerRef = useRef<mapboxgl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPlacePointRef = useRef<[number, number] | null>(null);
  const placeRequestIdRef = useRef(0);
  const [placeInfo, setPlaceInfo] = useState<PlaceInfo | null>(null);
  const [previewState, setPreviewState] = useState<"waiting" | "live" | "fallback">("waiting");

  const resolvePreviewPlace = useCallback((lat: number, lng: number) => {
    const previousPoint = lastPlacePointRef.current;
    if (
      previousPoint &&
      calculateDistanceMeters(previousPoint, [lat, lng]) < PLACE_REFRESH_DISTANCE_METERS
    ) {
      return;
    }

    lastPlacePointRef.current = [lat, lng];
    const requestId = placeRequestIdRef.current + 1;
    placeRequestIdRef.current = requestId;

    void resolvePlaceInfo(lat, lng).then((nextPlaceInfo) => {
      if (placeRequestIdRef.current === requestId) {
        setPlaceInfo(nextPlaceInfo);
      }
    });
  }, []);

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) {
      if (!mapboxToken) {
        setPreviewState("fallback");
      }
      return;
    }

    mapboxgl.accessToken = mapboxToken;
    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/dark-v11",
      center: FALLBACK_CENTER,
      zoom: 14.2,
      pitch: 45,
      bearing: -15,
      interactive: false
    });

    mapRef.current = map;
    map.on("error", (event) => {
      console.error("Home preview Mapbox error", event.error);
    });

    map.on("load", () => {
      applyMapLanguage(map, language);
      addPreviewLayers(map, FALLBACK_CENTER);
      markerRef.current = new mapboxgl.Marker({
        element: createPulsingMarkerElement(),
        anchor: "center"
      })
        .setLngLat(FALLBACK_CENTER)
        .addTo(map);

      if ("geolocation" in navigator) {
        const handlePosition = (position: GeolocationPosition) => {
          const center: [number, number] = [
            position.coords.longitude,
            position.coords.latitude
          ];
          markerRef.current?.setLngLat(center);
          updatePreviewLayers(map, center);
          map.easeTo({ center, zoom: 15.4, duration: 900, essential: true });
          resolvePreviewPlace(position.coords.latitude, position.coords.longitude);
          setPreviewState("live");
        };

        const handleLocationError = () => {
          setPreviewState("fallback");
        };

        const options: PositionOptions = {
          enableHighAccuracy: true,
          maximumAge: 10_000,
          timeout: 8000
        };

        navigator.geolocation.getCurrentPosition(handlePosition, handleLocationError, options);
        watchIdRef.current = navigator.geolocation.watchPosition(
          handlePosition,
          handleLocationError,
          options
        );
      } else {
        setPreviewState("fallback");
      }
    });

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // Mapbox preview is created once; language changes are applied by the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (map?.isStyleLoaded()) {
      applyMapLanguage(map, language);
    }
  }, [language]);

  const message = previewState === "fallback" ? fallback : status;
  const placeLabel = placeInfo ? formatPlaceLabel(placeInfo, language) : place;

  return (
    <div className="relative min-h-[460px] overflow-hidden rounded-lg border border-white/10 bg-[#07101a] shadow-hud">
      <div ref={mapContainerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.04)_42%,rgba(2,6,23,0.58)_100%)]" />
      <div className="absolute left-5 top-5 max-w-[78%] rounded-md border border-teal-200/20 bg-black/45 px-4 py-3 shadow-hud backdrop-blur">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-200">
          {message}
        </div>
        <div className="mt-1 truncate text-sm font-bold text-white">{placeLabel}</div>
      </div>
    </div>
  );
}

function calculateDistanceMeters(from: [number, number], to: [number, number]) {
  const earthRadiusMeters = 6_371_000;
  const fromLat = toRadians(from[0]);
  const toLat = toRadians(to[0]);
  const dLat = toRadians(to[0] - from[0]);
  const dLng = toRadians(to[1] - from[1]);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function addPreviewLayers(map: mapboxgl.Map, center: [number, number]) {
  map.addSource("preview-route", {
    type: "geojson",
    data: buildRoute(center)
  });
  map.addSource("preview-grids", {
    type: "geojson",
    data: buildGridFeatures(center)
  });
  map.addLayer({
    id: "preview-grid-fill",
    type: "fill",
    source: "preview-grids",
    paint: {
      "fill-color": "#2dd4bf",
      "fill-opacity": 0.28
    }
  });
  map.addLayer({
    id: "preview-grid-line",
    type: "line",
    source: "preview-grids",
    paint: {
      "line-color": "#99f6e4",
      "line-width": 2,
      "line-opacity": 0.85
    }
  });
  map.addLayer({
    id: "preview-route-line",
    type: "line",
    source: "preview-route",
    layout: {
      "line-cap": "round",
      "line-join": "round"
    },
    paint: {
      "line-color": "#7dd3fc",
      "line-width": 7,
      "line-blur": 1
    }
  });
}

function updatePreviewLayers(map: mapboxgl.Map, center: [number, number]) {
  const route = map.getSource("preview-route") as mapboxgl.GeoJSONSource | undefined;
  const grids = map.getSource("preview-grids") as mapboxgl.GeoJSONSource | undefined;
  route?.setData(buildRoute(center));
  grids?.setData(buildGridFeatures(center));
}

function buildRoute(center: [number, number]): GeoJSON.Feature<GeoJSON.LineString> {
  const [lng, lat] = center;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "LineString",
      coordinates: [
        [lng - 0.004, lat + 0.002],
        [lng - 0.0015, lat + 0.0008],
        [lng + 0.0012, lat - 0.0005],
        [lng + 0.004, lat - 0.002]
      ]
    }
  };
}

function buildGridFeatures(center: [number, number]): GeoJSON.FeatureCollection<GeoJSON.Polygon> {
  const [lng, lat] = center;
  const offsets = [
    [-0.003, 0.0016],
    [-0.001, 0.0002],
    [0.001, -0.0011],
    [0.003, -0.0024]
  ];
  const size = 0.00115;
  return {
    type: "FeatureCollection",
    features: offsets.map(([dx, dy]) => ({
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lng + dx, lat + dy],
            [lng + dx + size, lat + dy],
            [lng + dx + size, lat + dy + size],
            [lng + dx, lat + dy + size],
            [lng + dx, lat + dy]
          ]
        ]
      }
    }))
  };
}
