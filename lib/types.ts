export type LocationPoint = {
  lat: number;
  lng: number;
  timestamp: string;
};

export type PlaceInfo = {
  country?: string;
  region?: string;
  city?: string;
  label: string;
  localized: {
    en: string;
    zh: string;
  };
};

export type AdminArea = {
  id: string;
  countryIso3: string;
  adminLevel: string;
  name: string;
  localName?: string;
  bbox: [number, number, number, number];
  areaM2: number;
  totalGridCount: number;
  source: string;
  sourceVersion: string;
};

export type ExplorationSession = {
  id: string;
  anonymousId: string;
  startedAt: string;
  endedAt?: string;
  cityName: string;
  placeInfo?: PlaceInfo;
  adminArea?: AdminArea;
  origin: {
    lat: number;
    lng: number;
  };
  points: LocationPoint[];
  discoveredGridIds: string[];
  distanceMeters: number;
  explorationPercentage: number;
  totalGridCount?: number;
  newlyClaimedGridCount?: number;
  mapSnapshotDataUrl?: string;
};

export type ExplorationResult = Required<
  Pick<ExplorationSession, "id" | "anonymousId" | "startedAt" | "endedAt" | "cityName">
> & {
  points: LocationPoint[];
  discoveredGridIds: string[];
  distanceMeters: number;
  durationSeconds: number;
  explorationPercentage: number;
  totalGridCount?: number;
  newlyClaimedGridCount?: number;
  mapSnapshotDataUrl?: string;
  placeInfo?: PlaceInfo;
  adminArea?: AdminArea;
  supabaseSyncError?: string;
  supabaseSyncedAt?: string;
};

export type GridCell = {
  id: string;
  polygon: GeoJSON.Position[];
};
