import { NextRequest, NextResponse } from 'next/server';

const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');
  if (!q || q.trim().length < 2) {
    return NextResponse.json([]);
  }

  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`;

  const response = await fetch(url, {
    headers: {
      'User-Agent': 'RoutRider/0.1 (motorcycle route planner)',
      'Accept-Language': 'nl',
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.json([], { status: 200 });
  }

  const data = await response.json();
  const seen = new Set<string>();
  const results = (data as Array<{
    display_name: string;
    lat: string;
    lon: string;
  }>)
    .map((item) => ({
      name: item.display_name,
      lat: parseFloat(item.lat),
      lng: parseFloat(item.lon),
    }))
    .filter((item) => {
      // Dedupliceer puur op naam — zelfde naam = zelfde plek voor de gebruiker
      if (seen.has(item.name)) return false;
      seen.add(item.name);
      return true;
    });

  return NextResponse.json(results);
}
