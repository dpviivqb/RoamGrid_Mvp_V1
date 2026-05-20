import { calculateAdminTotalGridCount } from "@/lib/grid";
import type { AdminArea } from "@/lib/types";

type AdminAreaIndexEntry = AdminArea & {
  featurePath: string;
};

export type ResolvedAdminArea = {
  area: AdminArea;
  geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
};

type AdminAreaIndex = {
  source: string;
  sourceVersion: string;
  generatedAt: string;
  areas: AdminAreaIndexEntry[];
};

const DEFAULT_INDEX_PATH = "/gis/CHN/ADM3/index.json";
const featureCache = new Map<string, ResolvedAdminArea>();
let indexCache: Promise<AdminAreaIndex> | null = null;

export async function resolveAdminArea(lat: number, lng: number) {
  const index = await loadAdminAreaIndex();
  const candidates = index.areas.filter((area) => pointInBbox(lat, lng, area.bbox));

  for (const candidate of candidates) {
    const feature = await loadAdminAreaFeature(candidate);
    if (isPointInAdminArea(lat, lng, feature)) {
      return feature;
    }
  }

  return null;
}

export function isPointInAdminArea(lat: number, lng: number, feature: ResolvedAdminArea) {
  return isPointInGeometry([lng, lat], feature.geometry);
}

export function getAdminAreaFeatureCollection(feature: ResolvedAdminArea): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          id: feature.area.id,
          name: feature.area.name,
          adminLevel: feature.area.adminLevel
        },
        geometry: feature.geometry
      }
    ]
  };
}

export function getAdminAreaMaskFeatureCollection(feature: ResolvedAdminArea): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          id: `${feature.area.id}-outside-mask`
        },
        geometry: {
          type: "Polygon",
          coordinates: [
            orientRing(
              [
                [-180, -85],
                [180, -85],
                [180, 85],
                [-180, 85],
                [-180, -85]
              ],
              "ccw"
            ),
            ...getOuterRings(feature.geometry).map((ring) => orientRing(ring, "cw"))
          ]
        }
      }
    ]
  };
}

async function loadAdminAreaIndex() {
  if (!indexCache) {
    indexCache = fetch(DEFAULT_INDEX_PATH).then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load admin GIS index: HTTP ${response.status}`);
      }
      return (await response.json()) as AdminAreaIndex;
    });
  }

  return indexCache;
}

function getOuterRings(geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .map((polygon) => polygon[0])
    .filter((ring): ring is GeoJSON.Position[] => Array.isArray(ring) && ring.length > 0)
    .map(closeRing);
}

function closeRing(ring: GeoJSON.Position[]) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && first[0] === last[0] && first[1] === last[1]) {
    return ring;
  }

  return [...ring, first];
}

function orientRing(ring: GeoJSON.Position[], direction: "cw" | "ccw") {
  const closedRing = closeRing(ring);
  const isClockwise = getRingSignedArea(closedRing) < 0;

  if ((direction === "cw" && isClockwise) || (direction === "ccw" && !isClockwise)) {
    return closedRing;
  }

  return [...closedRing].reverse();
}

function getRingSignedArea(ring: GeoJSON.Position[]) {
  return ring.reduce((area, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return area + (point[0] * next[1] - next[0] * point[1]);
  }, 0);
}

async function loadAdminAreaFeature(entry: AdminAreaIndexEntry) {
  const cached = featureCache.get(entry.id);
  if (cached) {
    return cached;
  }

  const response = await fetch(entry.featurePath);
  if (!response.ok) {
    throw new Error(`Failed to load admin GIS feature ${entry.id}: HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    area: Omit<AdminArea, "totalGridCount"> & { totalGridCount?: number };
    geometry: GeoJSON.MultiPolygon | GeoJSON.Polygon;
  };

  const feature: ResolvedAdminArea = {
    area: {
      ...payload.area,
      totalGridCount: payload.area.totalGridCount ?? calculateAdminTotalGridCount(payload.area.areaM2)
    },
    geometry: payload.geometry
  };

  featureCache.set(entry.id, feature);
  return feature;
}

function pointInBbox(lat: number, lng: number, bbox: AdminArea["bbox"]) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return lng >= minLng && lng <= maxLng && lat >= minLat && lat <= maxLat;
}

function isPointInGeometry(point: GeoJSON.Position, geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.some((polygon) => isPointInPolygon(point, polygon));
}

function isPointInPolygon(point: GeoJSON.Position, polygon: GeoJSON.Position[][]) {
  const [lng, lat] = point;
  if (polygon.length === 0 || !isPointInRing(lng, lat, polygon[0], true)) {
    return false;
  }

  return !polygon.slice(1).some((ring) => isPointInRing(lng, lat, ring, true));
}

function isPointInRing(lng: number, lat: number, ring: GeoJSON.Position[], includeBoundary: boolean) {
  let inside = false;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [lngI, latI] = ring[i];
    const [lngJ, latJ] = ring[j];

    if (includeBoundary && isPointOnSegment(lng, lat, lngI, latI, lngJ, latJ)) {
      return true;
    }

    const intersects =
      latI > lat !== latJ > lat &&
      lng < ((lngJ - lngI) * (lat - latI)) / (latJ - latI) + lngI;

    if (intersects) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointOnSegment(
  lng: number,
  lat: number,
  startLng: number,
  startLat: number,
  endLng: number,
  endLat: number
) {
  const cross = (lat - startLat) * (endLng - startLng) - (lng - startLng) * (endLat - startLat);
  if (Math.abs(cross) > 1e-10) {
    return false;
  }

  return (
    lng >= Math.min(startLng, endLng) - 1e-10 &&
    lng <= Math.max(startLng, endLng) + 1e-10 &&
    lat >= Math.min(startLat, endLat) - 1e-10 &&
    lat <= Math.max(startLat, endLat) + 1e-10
  );
}
