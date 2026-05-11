import { NextRequest, NextResponse } from 'next/server';
import { calculateRoute } from '@/lib/routing';
import { FuelType, GermanFuelOption, RoutePreferences } from '@/lib/types';

export const maxDuration = 60;

type TankerListStation = {
  id: string;
  name?: string;
  brand?: string;
  street?: string;
  houseNumber?: string;
  postCode?: number;
  place?: string;
  lat: number;
  lng: number;
  price?: number;
  isOpen?: boolean;
};

type TankerListResponse = {
  ok?: boolean;
  stations?: TankerListStation[];
  message?: string;
};

type RequestBody = {
  start: { lat: number; lng: number };
  fuelType: FuelType;
  consumptionKmPerL: number;
  litersToTank: number;
  nlPricePerLiter: number;
  deEstimatedPricePerLiter?: number;
  maxBorderDistanceKm?: number;
  onlyOpen?: boolean;
  includeReturnTrip?: boolean;
  sortBy?: 'saving' | 'total' | 'distance' | 'fuelPrice';
};

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

type OverpassResponse = {
  elements?: OverpassElement[];
};

type NominatimEntry = {
  place_id: number;
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  address?: {
    road?: string;
    house_number?: string;
    postcode?: string;
    city?: string;
    town?: string;
    village?: string;
  };
};

const BORDER_ANCHORS = [
  { lat: 51.1808, lng: 6.4428, name: 'Mönchengladbach (DE grens)' },
  { lat: 51.8386, lng: 6.2426, name: 'Emmerich am Rhein (DE grens)' },
  { lat: 51.9496, lng: 7.0071, name: 'Gronau (DE grens)' },
  { lat: 52.3135, lng: 7.1579, name: 'Nordhorn (DE grens)' },
  { lat: 53.1818, lng: 7.2772, name: 'Bunde (DE grens)' },
  { lat: 53.2468, lng: 7.4619, name: 'Leer (DE grens)' },
];

const FASTEST_PREFS: RoutePreferences = {
  style: 'fastest',
  vehicleProfile: 'driving-car',
  avoidHighways: false,
  avoidMotorways: false,
  avoidFerries: false,
  avoidTollways: false,
  avoidUnpaved: true,
};

function haversineKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const r = 6371;
  const dLat = ((to.lat - from.lat) * Math.PI) / 180;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((from.lat * Math.PI) / 180) *
      Math.cos((to.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return r * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function pickNearestAnchor(start: { lat: number; lng: number }) {
  return BORDER_ANCHORS
    .map((anchor) => ({ anchor, distKm: haversineKm(start, anchor) }))
    .sort((a, b) => a.distKm - b.distKm)[0].anchor;
}

async function fetchStationsAround(
  lat: number,
  lng: number,
  fuelType: FuelType,
  apiKey: string,
): Promise<TankerListStation[]> {
  const url = new URL('https://creativecommons.tankerkoenig.de/json/list.php');
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lng', String(lng));
  url.searchParams.set('rad', '25');
  url.searchParams.set('sort', 'dist');
  url.searchParams.set('type', fuelType);
  url.searchParams.set('apikey', apiKey);

  const response = await fetch(url.toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(12000),
    next: { revalidate: 60 },
  });

  if (!response.ok) {
    throw new Error(`Tankerkönig fout (${response.status})`);
  }

  const data = (await response.json()) as TankerListResponse;
  if (!data.ok) {
    throw new Error(data.message || 'Tankerkönig antwoordde met een fout');
  }

  return (data.stations ?? [])
    .filter((s) => typeof s.price === 'number' && s.price > 0)
    .filter((s) => typeof s.lat === 'number' && typeof s.lng === 'number');
}

async function fetchStationsAroundOverpass(lat: number, lng: number): Promise<TankerListStation[]> {
  const query = `[out:json][timeout:20];(node["amenity"="fuel"](around:25000,${lat},${lng});way["amenity"="fuel"](around:25000,${lat},${lng});relation["amenity"="fuel"](around:25000,${lat},${lng}););out center tags;`;
  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
  ];

  const body = `data=${encodeURIComponent(query)}`;
  let response: OverpassResponse;
  try {
    response = await Promise.any(
      endpoints.map((url) =>
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
          signal: AbortSignal.timeout(13000),
        }).then(async (res) => {
          if (!res.ok) throw new Error(`${url}: ${res.status}`);
          return (await res.json()) as OverpassResponse;
        })
      )
    );
  } catch {
    return fetchStationsAroundNominatim(lat, lng);
  }

  return (response.elements ?? [])
    .map((el) => {
      const latValue = el.lat ?? el.center?.lat;
      const lngValue = el.lon ?? el.center?.lon;
      if (typeof latValue !== 'number' || typeof lngValue !== 'number') return null;
      return {
        id: `${el.type}/${el.id}`,
        name: el.tags?.name || el.tags?.brand || 'Tankstation',
        brand: el.tags?.brand,
        street: el.tags?.['addr:street'],
        houseNumber: el.tags?.['addr:housenumber'],
        postCode: Number(el.tags?.['addr:postcode']) || undefined,
        place: el.tags?.['addr:city'] || el.tags?.['addr:place'],
        lat: latValue,
        lng: lngValue,
        isOpen: el.tags?.opening_hours ? el.tags.opening_hours.includes('24/7') : true,
      } as TankerListStation;
    })
    .filter((s): s is TankerListStation => Boolean(s));
}

async function fetchStationsAroundNominatim(lat: number, lng: number): Promise<TankerListStation[]> {
  const delta = 0.35; // ~30-40km box
  const viewbox = `${lng - delta},${lat + delta},${lng + delta},${lat - delta}`;
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', 'fuel station');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '25');
  url.searchParams.set('countrycodes', 'de');
  url.searchParams.set('bounded', '1');
  url.searchParams.set('viewbox', viewbox);
  url.searchParams.set('addressdetails', '1');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'SlimTanken-fuel-planner/1.0',
      'Accept-Language': 'nl,en;q=0.8',
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!response.ok) return [];

  const data = (await response.json()) as NominatimEntry[];
  return data
    .map((entry) => {
      const latValue = Number(entry.lat);
      const lngValue = Number(entry.lon);
      if (!Number.isFinite(latValue) || !Number.isFinite(lngValue)) return null;
      return {
        id: `nominatim/${entry.place_id}`,
        name: entry.name || entry.display_name?.split(',')[0] || 'Tankstation',
        street: entry.address?.road,
        houseNumber: entry.address?.house_number,
        postCode: Number(entry.address?.postcode) || undefined,
        place: entry.address?.city || entry.address?.town || entry.address?.village,
        lat: latValue,
        lng: lngValue,
        isOpen: true,
      } as TankerListStation;
    })
    .filter((s): s is TankerListStation => Boolean(s));
}

function stationAddress(s: TankerListStation): string {
  const house = s.houseNumber ? ` ${s.houseNumber}` : '';
  const city = s.place || '';
  const zip = s.postCode ? `${s.postCode}` : '';
  return `${s.street || ''}${house}, ${zip} ${city}`.replace(/^,\s*/, '').trim();
}

export async function POST(request: NextRequest) {
  const orsApiKey = process.env.ORS_API_KEY;
  const tankerApiKey = (process.env.TANKERKOENIG_API_KEY ?? '').trim().replace(/^['\"]|['\"]$/g, '');

  if (!orsApiKey) {
    return NextResponse.json(
      { error: 'ORS_API_KEY is niet geconfigureerd.' },
      { status: 503 }
    );
  }

  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON invoer' }, { status: 400 });
  }

  const {
    start,
    fuelType,
    consumptionKmPerL,
    litersToTank,
    nlPricePerLiter,
    deEstimatedPricePerLiter,
    maxBorderDistanceKm = 20,
    onlyOpen = false,
    includeReturnTrip = false,
    sortBy = 'saving',
  } = body;

  if (!start || typeof start.lat !== 'number' || typeof start.lng !== 'number') {
    return NextResponse.json({ error: 'Startpunt ontbreekt of is ongeldig.' }, { status: 400 });
  }
  if (!['e5', 'e10', 'diesel'].includes(fuelType)) {
    return NextResponse.json({ error: 'Brandstoftype moet e5, e10 of diesel zijn.' }, { status: 400 });
  }
  if (!Number.isFinite(consumptionKmPerL) || consumptionKmPerL <= 0) {
    return NextResponse.json({ error: 'Verbruik moet groter zijn dan 0 km/l.' }, { status: 400 });
  }
  if (!Number.isFinite(litersToTank) || litersToTank <= 0) {
    return NextResponse.json({ error: 'Aantal liters moet groter zijn dan 0.' }, { status: 400 });
  }
  if (!Number.isFinite(nlPricePerLiter) || nlPricePerLiter <= 0) {
    return NextResponse.json({ error: 'NL literprijs moet groter zijn dan 0.' }, { status: 400 });
  }
  if (deEstimatedPricePerLiter !== undefined && (!Number.isFinite(deEstimatedPricePerLiter) || deEstimatedPricePerLiter <= 0)) {
    return NextResponse.json({ error: 'Geschatte DE literprijs moet groter zijn dan 0.' }, { status: 400 });
  }
  if (!Number.isFinite(maxBorderDistanceKm) || maxBorderDistanceKm < 5 || maxBorderDistanceKm > 80) {
    return NextResponse.json({ error: 'Max afstand over de grens moet tussen 5 en 80 km liggen.' }, { status: 400 });
  }

  try {
    const nearestAnchor = pickNearestAnchor(start);

    let useLivePricing = Boolean(tankerApiKey);
    const dePrice = deEstimatedPricePerLiter ?? Math.max(1.3, nlPricePerLiter * 0.87);

    let stationsNearAnchor: TankerListStation[] = [];
    let stationsNearStart: TankerListStation[] = [];

    if (useLivePricing) {
      try {
        [stationsNearAnchor, stationsNearStart] = await Promise.all([
          fetchStationsAround(nearestAnchor.lat, nearestAnchor.lng, fuelType, tankerApiKey),
          fetchStationsAround(start.lat, start.lng, fuelType, tankerApiKey).catch(() => []),
        ]);
      } catch {
        // Invalid, disabled, or temporarily failing Tankerkonig keys should not break the planner.
        useLivePricing = false;
      }
    }

    if (!useLivePricing) {
      [stationsNearAnchor, stationsNearStart] = await Promise.all([
        fetchStationsAroundOverpass(nearestAnchor.lat, nearestAnchor.lng),
        fetchStationsAroundOverpass(start.lat, start.lng).catch(() => []),
      ]);
    }

    const deduped = new Map<string, TankerListStation>();
    [...stationsNearAnchor, ...stationsNearStart].forEach((s) => {
      if (!deduped.has(s.id)) deduped.set(s.id, s);
    });

    const filteredStations = [...deduped.values()]
      .filter((s) => !onlyOpen || s.isOpen === true);

    if (filteredStations.length === 0) {
      return NextResponse.json({ options: [] as GermanFuelOption[] });
    }

    // Border-first candidate selection to avoid options far inside Germany.
    const borderDistance = (s: TankerListStation) => haversineKm(nearestAnchor, s);

    // Prefer stations close to the border anchor based on user-selected max depth over the border.
    const nearBorder = filteredStations
      .filter((s) => borderDistance(s) <= maxBorderDistanceKm)
      .sort((a, b) => borderDistance(a) - borderDistance(b));

    // Keep an explicit border-closest set so options stay near the border by default.
    const borderClosest = [...filteredStations]
      .sort((a, b) => borderDistance(a) - borderDistance(b))
      .slice(0, 16);

    // Within the border-near band, still favor cheaper prices.
    const cheapestNearBorder = [...nearBorder]
      .sort((a, b) => (a.price ?? 999) - (b.price ?? 999))
      .slice(0, 8);

    // Include a few closest to the user's start for practical options.
    const closestToStart = [...filteredStations]
      .sort((a, b) => haversineKm(start, a) - haversineKm(start, b))
      .slice(0, 4);

    const candidateSet = new Map<string, TankerListStation>();
    [...borderClosest, ...cheapestNearBorder, ...closestToStart].forEach((s) => {
      if (!candidateSet.has(s.id)) candidateSet.set(s.id, s);
    });

    const candidates = [...candidateSet.values()].slice(0, 16);

    const nlFuelCost = litersToTank * nlPricePerLiter;

    const optionsRaw = await Promise.all(
      candidates.map(async (station) => {
        const route = await calculateRoute(
          [
            [start.lng, start.lat],
            [station.lng, station.lat],
          ],
          FASTEST_PREFS,
          orsApiKey,
        );

        const distanceMultiplier = includeReturnTrip ? 2 : 1;
        const driveDistanceM = route.distance * distanceMultiplier;
        const driveDurationS = route.duration * distanceMultiplier;
        const driveDistanceKm = driveDistanceM / 1000;
        const driveLiters = driveDistanceKm / consumptionKmPerL;
        const driveCost = driveLiters * nlPricePerLiter;
        const stationPrice = useLivePricing ? (station.price as number) : dePrice;
        const fuelCost = litersToTank * stationPrice;
        const totalCost = driveCost + fuelCost;

        const option: GermanFuelOption = {
          id: station.id,
          name: station.name || station.brand || 'Tankstation',
          brand: station.brand,
          address: stationAddress(station),
          lat: station.lat,
          lng: station.lng,
          isOpen: station.isOpen === true,
          fuelType,
          fuelPrice: stationPrice,
          routeDistanceM: route.distance,
          routeDurationS: route.duration,
          evaluatedDriveDistanceM: driveDistanceM,
          evaluatedDriveDurationS: driveDurationS,
          includeReturnTrip,
          driveCost,
          fuelCost,
          totalCost,
          nlFuelCost,
          netSaving: nlFuelCost - totalCost,
        };

        return option;
      })
    );

    const options = [...optionsRaw].sort((a, b) => {
      switch (sortBy) {
        case 'total':
          return a.totalCost - b.totalCost;
        case 'distance':
          return a.evaluatedDriveDistanceM - b.evaluatedDriveDistanceM;
        case 'fuelPrice':
          return a.fuelPrice - b.fuelPrice;
        case 'saving':
        default:
          return b.netSaving - a.netSaving;
      }
    });
    return NextResponse.json({
      options,
      priceSource: useLivePricing ? 'live' : 'estimated',
      estimatedPriceUsed: useLivePricing ? null : dePrice,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout bij tankstation-zoekopdracht';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
