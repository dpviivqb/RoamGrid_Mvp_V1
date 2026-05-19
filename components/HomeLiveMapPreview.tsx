"use client";

import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { createPulsingMarkerElement } from "@/components/PulsingMarker";
import { applyMapLanguage } from "@/lib/mapbox";
import type { Language } from "@/lib/i18n";

const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
const FALLBACK_CENTER: [number, number] = [120.1551, 30.2741];

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
  const [message, setMessage] = useState(status);

  useEffect(() => {
    if (!mapboxToken || !mapContainerRef.current || mapRef.current) {
      if (!mapboxToken) {
        setMessage(fallback);
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
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const center: [number, number] = [
              position.coords.longitude,
              position.coords.latitude
            ];
            markerRef.current?.setLngLat(center);
            updatePreviewLayers(map, center);
            map.easeTo({ center, zoom: 15.4, duration: 900, essential: true });
            setMessage(status);
          },
          () => {
            setMessage(fallback);
          },
          { enableHighAccuracy: true, maximumAge: 10_000, timeout: 8000 }
        );
      } else {
        setMessage(fallback);
      }
    });

    return () => {
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

  return (
    <div className="relative min-h-[460px] overflow-hidden rounded-lg border border-white/10 bg-[#07101a] shadow-hud">
      <div ref={mapContainerRef} className="absolute inset-0" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(2,6,23,0.04)_42%,rgba(2,6,23,0.58)_100%)]" />
      <div className="absolute left-5 top-5 max-w-[78%] rounded-md border border-teal-200/20 bg-black/45 px-4 py-3 shadow-hud backdrop-blur">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-teal-200">
          {message}
        </div>
        <div className="mt-1 truncate text-sm font-bold text-white">{place}</div>
      </div>
    </div>
  );
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
