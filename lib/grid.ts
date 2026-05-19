import type { GridCell, LocationPoint } from "@/lib/types";

export const GRID_SIZE_METERS = 100;
export const EXPLORATION_AREA_METERS = 5000;
export const GRID_COLUMNS = EXPLORATION_AREA_METERS / GRID_SIZE_METERS;
export const TOTAL_GRID_COUNT = GRID_COLUMNS * GRID_COLUMNS;

const EARTH_RADIUS_METERS = 6_378_137;
const MAX_MERCATOR_LAT = 85.05112878;
const GRID_ID_PREFIX = "g100";

export function getGridId(lat: number, lng: number) {
  const x = Math.floor(lngToMercatorX(lng) / GRID_SIZE_METERS);
  const y = Math.floor(latToMercatorY(lat) / GRID_SIZE_METERS);
  return `${GRID_ID_PREFIX}:${x}:${y}`;
}

export function getGridPolygon(gridId: string): GeoJSON.Position[] {
  const parsed = parseGridId(gridId);
  if (!parsed) {
    return [];
  }

  const minXMeters = parsed.x * GRID_SIZE_METERS;
  const minYMeters = parsed.y * GRID_SIZE_METERS;
  const maxXMeters = minXMeters + GRID_SIZE_METERS;
  const maxYMeters = minYMeters + GRID_SIZE_METERS;

  const minLng = mercatorXToLng(minXMeters);
  const maxLng = mercatorXToLng(maxXMeters);
  const minLat = mercatorYToLat(minYMeters);
  const maxLat = mercatorYToLat(maxYMeters);

  return [
    [minLng, minLat],
    [maxLng, minLat],
    [maxLng, maxLat],
    [minLng, maxLat],
    [minLng, minLat]
  ];
}

export function buildGridCells(gridIds: string[]): GridCell[] {
  return gridIds
    .filter(isGlobalGridId)
    .map((id) => ({
      id,
      polygon: getGridPolygon(id)
    }))
    .filter((cell) => cell.polygon.length > 0);
}

export function isGlobalGridId(gridId: string) {
  return parseGridId(gridId) !== null;
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

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function clampLat(lat: number) {
  return Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
}

function lngToMercatorX(lng: number) {
  return EARTH_RADIUS_METERS * toRadians(lng);
}

function latToMercatorY(lat: number) {
  const clampedLat = clampLat(lat);
  return EARTH_RADIUS_METERS * Math.log(Math.tan(Math.PI / 4 + toRadians(clampedLat) / 2));
}

function mercatorXToLng(x: number) {
  return toDegrees(x / EARTH_RADIUS_METERS);
}

function mercatorYToLat(y: number) {
  return toDegrees(2 * Math.atan(Math.exp(y / EARTH_RADIUS_METERS)) - Math.PI / 2);
}

function parseGridId(gridId: string) {
  const [prefix, x, y] = gridId.split(":");
  const parsedX = Number(x);
  const parsedY = Number(y);

  if (
    prefix !== GRID_ID_PREFIX ||
    !Number.isInteger(parsedX) ||
    !Number.isInteger(parsedY)
  ) {
    return null;
  }

  return { x: parsedX, y: parsedY };
}
