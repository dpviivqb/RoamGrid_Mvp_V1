import type { GridCell, LocationPoint } from "@/lib/types";

export const GRID_SIZE_METERS = 150;
export const EXPLORATION_AREA_METERS = 5000;
export const GRID_COLUMNS = 34;
export const TOTAL_GRID_COUNT = GRID_COLUMNS * GRID_COLUMNS;

const METERS_PER_DEGREE_LAT = 111_320;

type Origin = {
  lat: number;
  lng: number;
};

function metersPerDegreeLng(lat: number) {
  return METERS_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180);
}

export function getGridId(lat: number, lng: number, origin: Origin) {
  const xMeters = (lng - origin.lng) * metersPerDegreeLng(origin.lat);
  const yMeters = (lat - origin.lat) * METERS_PER_DEGREE_LAT;
  const x = Math.floor((xMeters + EXPLORATION_AREA_METERS / 2) / GRID_SIZE_METERS);
  const y = Math.floor((yMeters + EXPLORATION_AREA_METERS / 2) / GRID_SIZE_METERS);
  return `${x}:${y}`;
}

export function getGridPolygon(gridId: string, origin: Origin): GeoJSON.Position[] {
  const [x, y] = gridId.split(":").map(Number);
  const minXMeters = x * GRID_SIZE_METERS - EXPLORATION_AREA_METERS / 2;
  const minYMeters = y * GRID_SIZE_METERS - EXPLORATION_AREA_METERS / 2;
  const maxXMeters = minXMeters + GRID_SIZE_METERS;
  const maxYMeters = minYMeters + GRID_SIZE_METERS;
  const lngMeters = metersPerDegreeLng(origin.lat);

  const minLng = origin.lng + minXMeters / lngMeters;
  const maxLng = origin.lng + maxXMeters / lngMeters;
  const minLat = origin.lat + minYMeters / METERS_PER_DEGREE_LAT;
  const maxLat = origin.lat + maxYMeters / METERS_PER_DEGREE_LAT;

  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat]
  ];
}

export function buildGridCells(gridIds: string[], origin: Origin): GridCell[] {
  return gridIds
    .filter((id) => {
      const [x, y] = id.split(":").map(Number);
      return x >= 0 && x < GRID_COLUMNS && y >= 0 && y < GRID_COLUMNS;
    })
    .map((id) => ({
      id,
      polygon: getGridPolygon(id, origin)
    }));
}

export function calculateDistance(points: LocationPoint[]) {
  if (points.length < 2) {
    return 0;
  }

  return points.slice(1).reduce((total, point, index) => {
    return total + haversineMeters(points[index], point);
  }, 0);
}

export function calculateExplorationPercentage(
  discoveredGridCount: number,
  totalGridCount = TOTAL_GRID_COUNT
) {
  return Math.min(100, (discoveredGridCount / totalGridCount) * 100);
}

function haversineMeters(start: LocationPoint, end: LocationPoint) {
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(end.lat - start.lat);
  const dLng = toRadians(end.lng - start.lng);
  const startLat = toRadians(start.lat);
  const endLat = toRadians(end.lat);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(startLat) *
      Math.cos(endLat) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMeters * c;
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}
