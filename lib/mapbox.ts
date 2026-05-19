import mapboxgl from "mapbox-gl";
import type { ExpressionSpecification } from "mapbox-gl";
import type { Language } from "@/lib/i18n";
import type { PlaceInfo } from "@/lib/types";

const FALLBACK_PLACE: PlaceInfo = {
  label: "Nearby Blocks",
  localized: {
    en: "Nearby Blocks",
    zh: "附近区域"
  }
};

type MapboxContext = {
  id?: string;
  text?: string;
  text_en?: string;
  text_zh?: string;
  "text_zh-Hans"?: string;
};

type MapboxFeature = MapboxContext & {
  place_type?: string[];
  context?: MapboxContext[];
};

type MapboxGeocodingResponse = {
  features?: MapboxFeature[];
};

export async function resolvePlaceInfo(lat: number, lng: number): Promise<PlaceInfo> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  if (!token) {
    return FALLBACK_PLACE;
  }

  try {
    const params = new URLSearchParams({
      access_token: token,
      types: "country,region,place,locality,district",
      language: "en,zh-Hans",
      limit: "1"
    });
    const response = await fetch(
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?${params.toString()}`
    );

    if (!response.ok) {
      return FALLBACK_PLACE;
    }

    const data = (await response.json()) as MapboxGeocodingResponse;
    const feature = data.features?.[0];
    if (!feature) {
      return FALLBACK_PLACE;
    }

    return buildPlaceInfo(feature);
  } catch {
    return FALLBACK_PLACE;
  }
}

export function formatPlaceLabel(placeInfo: PlaceInfo | undefined, language: Language) {
  if (!placeInfo) {
    return FALLBACK_PLACE.localized[language];
  }

  return placeInfo.localized[language] || placeInfo.label || FALLBACK_PLACE.localized[language];
}

export function applyMapLanguage(map: mapboxgl.Map, language: Language) {
  const style = map.getStyle();
  const expression: ExpressionSpecification =
    language === "zh"
      ? ["coalesce", ["get", "name_zh-Hans"], ["get", "name_zh"], ["get", "name"]]
      : ["coalesce", ["get", "name_en"], ["get", "name"]];

  style.layers
    ?.filter((layer) => layer.type === "symbol" && layer.layout?.["text-field"])
    .forEach((layer) => {
      try {
        map.setLayoutProperty(layer.id, "text-field", expression);
      } catch {
        // Some style layers are not mutable at runtime. Ignore and keep fallback labels.
      }
    });
}

export function captureMapSnapshot(map: mapboxgl.Map | null) {
  if (!map) {
    return null;
  }

  try {
    return map.getCanvas().toDataURL("image/png");
  } catch {
    return null;
  }
}

function buildPlaceInfo(feature: MapboxFeature): PlaceInfo {
  const allParts = [feature, ...(feature.context ?? [])];
  const country = findPart(allParts, "country");
  const region = findPart(allParts, "region");
  const city =
    findPart(allParts, "place") ?? findPart(allParts, "locality") ?? findPart(allParts, "district");

  const countryEn = getText(country, "en");
  const regionEn = getText(region, "en");
  const cityEn = getText(city, "en");
  const countryZh = getText(country, "zh");
  const regionZh = getText(region, "zh");
  const cityZh = getText(city, "zh");

  const en = joinPlace([countryEn, regionEn, cityEn], FALLBACK_PLACE.localized.en);
  const zh = joinPlace([countryZh, regionZh, cityZh], FALLBACK_PLACE.localized.zh);

  return {
    country: countryEn,
    region: regionEn,
    city: cityEn,
    label: en,
    localized: { en, zh }
  };
}

function findPart(parts: MapboxFeature[], type: string) {
  return parts.find((part) => part.id?.startsWith(`${type}.`) || part.place_type?.includes(type));
}

function getText(part: MapboxContext | undefined, language: Language) {
  if (!part) {
    return undefined;
  }

  if (language === "zh") {
    return part["text_zh-Hans"] ?? part.text_zh ?? part.text;
  }

  return part.text_en ?? part.text;
}

function joinPlace(parts: Array<string | undefined>, fallback: string) {
  const compacted = parts.filter(Boolean) as string[];
  return compacted.length > 0 ? compacted.join(" · ") : fallback;
}
