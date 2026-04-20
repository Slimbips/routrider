import { RoutePreferences, RouteResult } from './types';

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2';

// ---------------------------------------------------------------------------
// BRouter — used for the touristic mode. Free, open source, supports custom
// BRF profiles that can hard-block motorway/trunk and penalise primary roads.
// ---------------------------------------------------------------------------

// BRF profile: blocks motorway/trunk/motorroad, heavy penalty on primary,
// prefers secondary/tertiary/unclassified (typical NL country roads).
const TOURISTIC_BRF_PROFILE = `
---context:way

assign costfactor = \\
  if      highway == motorway      then -1 \\
  else if highway == motorway_link then -1 \\
  else if highway == trunk         then -1 \\
  else if highway == trunk_link    then -1 \\
  else if motorroad == yes         then -1 \\
  else if highway == primary       then 4 \\
  else if highway == primary_link  then 4 \\
  else if highway == secondary     then 0.8 \\
  else if highway == tertiary      then 0.8 \\
  else if highway == unclassified  then 0.9 \\
  else if highway == residential   then 1.0 \\
  else if highway == living_street then 1.2 \\
  else if highway == service       then 1.5 \\
  else if highway == track         then 3.0 \\
  else if highway == path          then -1 \\
  else if highway == footway       then -1 \\
  else if highway == steps         then -1 \\
  else if highway == cycleway      then -1 \\
  else                                  1.5 \\
  endif

---context:node

assign initialcost 0
`;

const BROUTER_URLS = [
  'https://brouter.de/brouter',
  'https://brouter.overkill.nu/brouter',
];

async function calculateRouteBRouter(
  coordinates: [number, number][], // [lng, lat]
): Promise<RouteResult> {
  const lonlats = coordinates.map(([lng, lat]) => `${lng},${lat}`).join('|');

  const params = new URLSearchParams({
    lonlats,
    profile: 'custom',
    format: 'geojson',
    pfile: TOURISTIC_BRF_PROFILE,
  });

  let lastError: Error | null = null;
  for (const baseUrl of BROUTER_URLS) {
    try {
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(text || res.statusText);
      }

      const data = await res.json();
      const feature = data?.features?.[0];
      if (!feature) throw new Error('Geen route gevonden (BRouter)');

      const coords: [number, number][] = (feature.geometry.coordinates as number[][]).map(
        ([lng, lat]) => [lng, lat] as [number, number]
      );

      const props = feature.properties as Record<string, string>;
      const distanceM = parseFloat(props['track-length'] ?? '0');
      const durationS = parseFloat(props['total-time'] ?? '0');

      return {
        coordinates: coords,
        distance: distanceM,
        duration: Math.round(durationS),
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error('BRouter niet beschikbaar');
}

type OrsFeature = {
  geometry: { coordinates: [number, number][] };
  properties: {
    summary: { distance: number; duration: number };
    extras?: {
      elevation?: { values?: [number, number, number][] };
      waytype?: { values?: [number, number, number][] };
      waytypes?: { values?: [number, number, number][] };
    };
  };
};

type OrsResponse = {
  features?: OrsFeature[];
};

function haversineKm(from: [number, number], to: [number, number]): number {
  const [lng1, lat1] = from;
  const [lng2, lat2] = to;
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return r * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function estimateRouteSpanKm(coordinates: [number, number][]): number {
  if (coordinates.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    total += haversineKm(coordinates[i - 1], coordinates[i]);
  }
  return total;
}

function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isTouristicMode(preferences: RoutePreferences): boolean {
  return (
    preferences.vehicleProfile === 'driving-car' &&
    preferences.style === 'recommended' &&
    preferences.avoidHighways &&
    preferences.avoidMotorways
  );
}

function createSquarePolygon(lng: number, lat: number, halfSizeDegrees: number) {
  return [[
    [lng - halfSizeDegrees, lat - halfSizeDegrees],
    [lng + halfSizeDegrees, lat - halfSizeDegrees],
    [lng + halfSizeDegrees, lat + halfSizeDegrees],
    [lng - halfSizeDegrees, lat + halfSizeDegrees],
    [lng - halfSizeDegrees, lat - halfSizeDegrees],
  ]];
}

function buildAvoidPolygonsFromMajorRoads(feature: OrsFeature): Record<string, unknown> | null {
  const coordinates = feature.geometry.coordinates;
  const waytypeValues = feature.properties.extras?.waytypes?.values ?? feature.properties.extras?.waytype?.values;

  if (!waytypeValues?.length || coordinates.length < 2) return null;

  const polygons: number[][][][] = [];
  // Check for waytype values 1-3: motorways, trunk, primary roads (N-roads, A-roads, E-roads all fall in this range)
  const MAJOR_ROAD_WAYTYPES = [0, 1, 2, 3];
  const halfSizeDegrees = 0.004; // ~400m buffer to force strong rerouting in NL

  for (const [startIndex, endIndex, value] of waytypeValues) {
    if (!MAJOR_ROAD_WAYTYPES.includes(value)) continue;

    const segmentLength = endIndex - startIndex;
    // Sample much more densely: every 50-100m instead of every 200m
    const step = Math.max(1, Math.floor(segmentLength / 8));

    for (let index = startIndex; index <= endIndex && index < coordinates.length; index += step) {
      const [lng, lat] = coordinates[index];
      polygons.push(createSquarePolygon(lng, lat, halfSizeDegrees));
      // Much higher limit to ensure full coverage of major roads
      if (polygons.length >= 50) break;
    }

    if (polygons.length >= 50) break;
  }

  if (polygons.length === 0) return null;

  return {
    type: 'MultiPolygon',
    coordinates: polygons,
  };
}

async function requestRoute(
  vehicleProfile: string,
  body: Record<string, unknown>,
  apiKey: string,
  coordinates: [number, number][]
): Promise<OrsResponse> {
  let response: Response | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(
      `${ORS_BASE_URL}/directions/${vehicleProfile}/geojson`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: apiKey,
        },
        body: JSON.stringify(body),
      }
    );

    if (response.ok) break;
    if (!isTransientStatus(response.status) || attempt === 1) break;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }

  if (!response) throw new Error('Geen antwoord van routeringsserver');

  if (!response.ok) {
    let message = response.statusText;
    try {
      const errData = await response.json();
      const orsMsg: string = errData?.error?.message ?? '';
      const pointMatch = orsMsg.match(/coordinate (\d+)/);
      if (pointMatch) {
        const idx = parseInt(pointMatch[1], 10);
        const label = idx === 0 ? 'startpunt' : idx === coordinates.length - 1 ? 'eindpunt' : `tussenstop ${idx}`;
        message = `Punt ${idx + 1} (${label}) ligt niet op of bij een rijdbare weg. Verplaats het punt iets.`;
      } else {
        message = orsMsg || message;
      }
    } catch {
      // use status text fallback
    }
    throw new Error(message);
  }

  return (await response.json()) as OrsResponse;
}

export async function calculateRoute(
  coordinates: [number, number][], // [lng, lat] pairs
  preferences: RoutePreferences,
  apiKey: string,
  _ghApiKey?: string  // kept for API compatibility, no longer used
): Promise<RouteResult> {
  // Touristic mode: use BRouter with custom BRF profile to properly block
  // motorway/trunk and penalise primary roads (N-wegen).
  if (isTouristicMode(preferences)) {
    try {
      return await calculateRouteBRouter(coordinates);
    } catch (brouterErr) {
      // Fall through to ORS so the user always gets a route
      console.warn('BRouter touristic route failed, falling back to ORS:', brouterErr);
    }
  }

  const avoidFeatures: string[] = [];
  if (preferences.avoidHighways || preferences.avoidMotorways)
    avoidFeatures.push('highways');
  if (preferences.avoidFerries) avoidFeatures.push('ferries');
  if (preferences.avoidTollways) avoidFeatures.push('tollways');

  // Map style to ORS preference
  const preferenceMap: Record<RoutePreferences['style'], string> = {
    fastest: 'fastest',
    recommended: 'recommended',
    shortest: 'shortest',
  };

  const body: Record<string, unknown> = {
    coordinates,
    radiuses: coordinates.map(() => -1),
    instructions: false,
    elevation: true,
    preference: preferenceMap[preferences.style],
  };

  if (avoidFeatures.length > 0) {
    body.options = { avoid_features: avoidFeatures };
  }

  const vehicleProfile = preferences.vehicleProfile ?? 'driving-car';
  const spanKm = estimateRouteSpanKm(coordinates);

  if (spanKm > 140) {
    body.elevation = false;
  }

  const data = await requestRoute(vehicleProfile, body, apiKey, coordinates);
  const feature = data.features?.[0];

  if (!feature) throw new Error('Geen route gevonden');

  const coords = feature.geometry.coordinates as [number, number][];
  const summary = feature.properties.summary as {
    distance: number;
    duration: number;
  };
  const extras = feature.properties.extras as
    | { elevation?: { values?: [number, number, number][] } }
    | undefined;

  // Compute ascent/descent from elevation data if available
  let ascent = 0;
  let descent = 0;
  if (extras?.elevation?.values) {
    const elevValues = extras.elevation.values;
    for (let i = 1; i < elevValues.length; i++) {
      const diff = elevValues[i][2] - elevValues[i - 1][2];
      if (diff > 0) ascent += diff;
      else descent += Math.abs(diff);
    }
  }

  return {
    coordinates: coords,
    distance: summary.distance,
    duration: summary.duration,
    ascent: ascent > 0 ? Math.round(ascent) : undefined,
    descent: descent > 0 ? Math.round(descent) : undefined,
  };
}
