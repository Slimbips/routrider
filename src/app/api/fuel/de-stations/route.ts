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
  onlyOpen?: boolean;
  includeReturnTrip?: boolean;
  sortBy?: 'saving' | 'total' | 'distance' | 'fuelPrice';
};

const BORDER_ANCHORS = [
  { lat: 51.1808, lng: 6.4428, name: 'Mönchengladbach (DE grens)' },
  { lat: 51.8386, lng: 6.2426, name: 'Emmerich am Rhein (DE grens)' },
  { lat: 51.9496, lng: 7.0071, name: 'Gronau (DE grens)' },
  { lat: 52.3135, lng: 7.1579, name: 'Nordhorn (DE grens)' },
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

function stationAddress(s: TankerListStation): string {
  const house = s.houseNumber ? ` ${s.houseNumber}` : '';
  const city = s.place || '';
  const zip = s.postCode ? `${s.postCode}` : '';
  return `${s.street || ''}${house}, ${zip} ${city}`.replace(/^,\s*/, '').trim();
}

export async function POST(request: NextRequest) {
  const orsApiKey = process.env.ORS_API_KEY;
  const tankerApiKey = process.env.TANKERKOENIG_API_KEY;

  if (!orsApiKey) {
    return NextResponse.json(
      { error: 'ORS_API_KEY is niet geconfigureerd.' },
      { status: 503 }
    );
  }
  if (!tankerApiKey) {
    return NextResponse.json(
      { error: 'TANKERKOENIG_API_KEY ontbreekt. Voeg deze toe in je .env/.Vercel.' },
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

  try {
    const nearestAnchor = pickNearestAnchor(start);

    const [stationsNearAnchor, stationsNearStart] = await Promise.all([
      fetchStationsAround(nearestAnchor.lat, nearestAnchor.lng, fuelType, tankerApiKey),
      fetchStationsAround(start.lat, start.lng, fuelType, tankerApiKey).catch(() => []),
    ]);

    const deduped = new Map<string, TankerListStation>();
    [...stationsNearAnchor, ...stationsNearStart].forEach((s) => {
      if (!deduped.has(s.id)) deduped.set(s.id, s);
    });

    const filteredStations = [...deduped.values()]
      .filter((s) => !onlyOpen || s.isOpen === true);

    const candidates = filteredStations
      .sort((a, b) => (a.price ?? 999) - (b.price ?? 999))
      .slice(0, 8);

    if (candidates.length === 0) {
      return NextResponse.json({ options: [] as GermanFuelOption[] });
    }

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
        const fuelCost = litersToTank * (station.price as number);
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
          fuelPrice: station.price as number,
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
    return NextResponse.json({ options });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Onbekende fout bij tankstation-zoekopdracht';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
