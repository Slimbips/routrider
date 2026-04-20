import { RoutePreferences, RouteResult } from './types';

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2';

// ---------------------------------------------------------------------------
// Valhalla — used for touristic mode. Free, no API key needed.
// use_highways:0 blocks motorway + trunk (all A-roads in NL).
// N-wegen (primary) cannot be hard-blocked by any free public API,
// but lowering use_highways forces the router onto secondary/tertiary roads.
// ---------------------------------------------------------------------------

const VALHALLA_URLS = [
  'https://valhalla1.openstreetmap.de',
  'https://valhalla.openstreetmap.de',
];

async function calculateRouteValhalla(
  coordinates: [number, number][], // [lng, lat]
  avoidFerries: boolean,
  avoidTollways: boolean,
): Promise<RouteResult> {
  const locations = coordinates.map(([lng, lat]) => ({ lon: lng, lat }));

  const body = {
    locations,
    costing: 'auto',
    costing_options: {
      auto: {
        use_highways: 0.0,   // blocks motorway + trunk (A-roads)
        use_tolls: avoidTollways ? 0.0 : 1.0,
        use_ferry: avoidFerries ? 0.0 : 1.0,
        use_living_streets: 0.5,
      },
    },
    units: 'km',
  };

  let lastError: Error | null = null;
  for (const base of VALHALLA_URLS) {
    try {
      const res = await fetch(`${base}/route`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });

      const data = await res.json() as Record<string, unknown>;
      if (!res.ok) {
        throw new Error((data.error as string) ?? res.statusText);
      }

      const trip = data.trip as Record<string, unknown> | undefined;
      if (!trip) throw new Error('Geen route gevonden (Valhalla)');

      const summary = trip.summary as Record<string, number>;
      const legs = trip.legs as Array<{ shape: string }>;

      // Valhalla returns encoded polyline6 — decode it
      const coords = legs.flatMap(l => l.shape ? decodePolyline6Str(l.shape) : []);

      return {
        coordinates: coords,
        distance: Math.round(summary.length * 1000),   // km → m
        duration: Math.round(summary.time),             // already seconds
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError ?? new Error('Valhalla niet beschikbaar');
}

function decodePolyline6Str(encoded: string): [number, number][] {
  const coords: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let b: number;
    let shift = 0;
    let result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coords.push([lng / 1e6, lat / 1e6]); // [lng, lat] to match ORS format
  }
  return coords;
}

type OrsFeature = {
  geometry: { coordinates: [number, number][] };
  properties: {
    summary: { distance: number; duration: number };
    extras?: {
      elevation?: { values?: [number, number, number][] };
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
  // Touristic mode: use Valhalla which blocks motorway + trunk (all A-roads).
  // Primary roads (N-wegen) cannot be hard-blocked by any free public API.
  if (isTouristicMode(preferences)) {
    try {
      return await calculateRouteValhalla(
        coordinates,
        preferences.avoidFerries,
        preferences.avoidTollways,
      );
    } catch (valhallaErr) {
      // Fall through to ORS so the user always gets a route
      console.warn('Valhalla touristic route failed, falling back to ORS:', valhallaErr);
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
