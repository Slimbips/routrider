import { RoutePreferences, RouteResult } from './types';

const ORS_BASE_URL = 'https://api.openrouteservice.org/v2';

export async function calculateRoute(
  coordinates: [number, number][], // [lng, lat] pairs
  preferences: RoutePreferences,
  apiKey: string
): Promise<RouteResult> {
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
    // -1 = onbeperkt zoekradius: ORS snapt altijd naar de dichtstbijzijnde weg
    radiuses: coordinates.map(() => -1),
    instructions: false,
    elevation: true,
    preference: preferenceMap[preferences.style],
  };

  if (avoidFeatures.length > 0) {
    body.options = { avoid_features: avoidFeatures };
  }

  const response = await fetch(
    `${ORS_BASE_URL}/directions/driving-car/geojson`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    let message = response.statusText;
    try {
      const errData = await response.json();
      const orsMsg: string = errData?.error?.message ?? '';
      // Verander de technische ORS-fout naar een begrijpelijke melding
      const pointMatch = orsMsg.match(/coordinate (\d+)/);
      if (pointMatch) {
        const idx = parseInt(pointMatch[1], 10);
        const label = idx === 0 ? 'startpunt' : idx === coordinates.length - 1 ? 'eindpunt' : `tussenstop ${idx}`;
        message = `Punt ${idx + 1} (${label}) ligt niet op of bij een rijdbare weg. Verplaats het punt iets.`;
      } else {
        message = orsMsg || message;
      }
    } catch { /* gebruik statusText als fallback */ }
    throw new Error(message);
  }

  const data = await response.json();
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
