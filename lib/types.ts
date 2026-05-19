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

export type AuthUser = {
  id: string;
  email?: string;
};

export type AuthState = {
  user: AuthUser | null;
  isLoading: boolean;
};

export type ExplorationSession = {
  id: string;
  anonymousId: string;
  userId?: string;
  syncMode?: "anonymous" | "authenticated";
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
  userId?: string;
  syncMode?: "anonymous" | "authenticated";
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

export type RemoteAdminGridHistory = {
  adminAreaId: string;
  gridIds: string[];
};

export type RemoteExplorationHistoryItem = {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string;
  cityName?: string;
  adminAreaId?: string;
  adminAreaName?: string;
  distanceMeters: number;
  durationSeconds: number;
  discoveredGridCount: number;
  explorationPercentage: number;
  totalGridCount?: number;
  points: LocationPoint[];
  discoveredGridIds: string[];
};
