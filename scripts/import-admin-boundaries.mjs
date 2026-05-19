import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const COUNTRY_ISO3 = "CHN";
const ADMIN_LEVEL = "ADM3";
const GRID_SIZE_METERS = 100;
const SOURCE = "geoBoundaries gbOpen";
const SOURCE_VERSION = "geoBoundaries-CHN-ADM3_simplified";
const DOWNLOAD_URL =
  "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/CHN/ADM3/geoBoundaries-CHN-ADM3_simplified.geojson";
const OUT_DIR = path.join(process.cwd(), "public", "gis", COUNTRY_ISO3, ADMIN_LEVEL);
const FEATURES_DIR = path.join(OUT_DIR, "features");
const EARTH_RADIUS_METERS = 6_371_008.8;

async function main() {
  console.log(`Downloading ${SOURCE_VERSION}...`);
  const response = await fetch(DOWNLOAD_URL);
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const collection = await response.json();
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("Unexpected GeoJSON payload.");
  }

  await rm(FEATURES_DIR, { recursive: true, force: true });
  await mkdir(FEATURES_DIR, { recursive: true });

  const areas = [];
  const usedIds = new Set();

  for (const [index, feature] of collection.features.entries()) {
    if (!feature.geometry || !["Polygon", "MultiPolygon"].includes(feature.geometry.type)) {
      continue;
    }

    const rawId =
      feature.properties?.shapeID ??
      feature.properties?.shapeISO ??
      feature.properties?.shapeName ??
      `${COUNTRY_ISO3}_${ADMIN_LEVEL}_${index}`;
    const id = makeUniqueId(`${COUNTRY_ISO3}_${ADMIN_LEVEL}_${sanitizeId(String(rawId))}`, usedIds);
    const name = String(feature.properties?.shapeName ?? id);
    const bbox = getGeometryBbox(feature.geometry);
    const areaM2 = Math.round(getGeometryAreaM2(feature.geometry));
    const totalGridCount = Math.max(1, Math.round(areaM2 / (GRID_SIZE_METERS * GRID_SIZE_METERS)));
    const featurePath = `/gis/${COUNTRY_ISO3}/${ADMIN_LEVEL}/features/${id}.json`;
    const area = {
      id,
      countryIso3: COUNTRY_ISO3,
      adminLevel: ADMIN_LEVEL,
      name,
      localName: name,
      bbox,
      areaM2,
      totalGridCount,
      source: SOURCE,
      sourceVersion: SOURCE_VERSION,
      featurePath
    };

    await writeFile(
      path.join(FEATURES_DIR, `${id}.json`),
      JSON.stringify({
        area,
        geometry: feature.geometry
      })
    );

    areas.push(area);
  }

  areas.sort((a, b) => a.id.localeCompare(b.id));
  await writeFile(
    path.join(OUT_DIR, "index.json"),
    JSON.stringify({
      source: SOURCE,
      sourceVersion: SOURCE_VERSION,
      generatedAt: new Date().toISOString(),
      countryIso3: COUNTRY_ISO3,
      adminLevel: ADMIN_LEVEL,
      areas
    })
  );

  console.log(`Imported ${areas.length} ${COUNTRY_ISO3} ${ADMIN_LEVEL} boundaries.`);
}

function sanitizeId(value) {
  return value
    .normalize("NFKD")
    .replace(/[^\w-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
}

function makeUniqueId(baseId, usedIds) {
  let id = baseId || `${COUNTRY_ISO3}_${ADMIN_LEVEL}`;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${baseId}_${index}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
}

function getGeometryBbox(geometry) {
  const positions = [];
  walkPositions(geometry.coordinates, positions);
  const lngs = positions.map((position) => position[0]);
  const lats = positions.map((position) => position[1]);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

function getGeometryAreaM2(geometry) {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.reduce((total, polygon) => total + getPolygonAreaM2(polygon), 0);
}

function getPolygonAreaM2(polygon) {
  if (!Array.isArray(polygon) || polygon.length === 0) {
    return 0;
  }

  const outerArea = Math.abs(getRingAreaM2(polygon[0]));
  const holesArea = polygon.slice(1).reduce((total, ring) => total + Math.abs(getRingAreaM2(ring)), 0);
  return Math.max(0, outerArea - holesArea);
}

function getRingAreaM2(ring) {
  let area = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const current = ring[index];
    const next = ring[(index + 1) % ring.length];
    area +=
      toRadians(next[0] - current[0]) *
      (Math.sin(toRadians(current[1])) + Math.sin(toRadians(next[1])));
  }
  return (area * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2;
}

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function walkPositions(value, output) {
  if (!Array.isArray(value)) {
    return;
  }

  if (typeof value[0] === "number" && typeof value[1] === "number") {
    output.push(value);
    return;
  }

  value.forEach((item) => walkPositions(item, output));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
