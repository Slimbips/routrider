import { NextRequest, NextResponse } from 'next/server';
import { calculateRoute } from '@/lib/routing';
import { RoutePreferences } from '@/lib/types';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const apiKey = process.env.ORS_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ORS_API_KEY is niet geconfigureerd. Voeg hem toe aan .env.local.' },
      { status: 503 }
    );
  }

  let body: { coordinates: [number, number][]; preferences: RoutePreferences };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Ongeldige JSON invoer' }, { status: 400 });
  }

  const { coordinates, preferences } = body;

  if (!coordinates || coordinates.length < 2) {
    return NextResponse.json(
      { error: 'Minimaal 2 punten zijn vereist voor een route' },
      { status: 400 }
    );
  }

  const ghApiKey = process.env.GRAPHHOPPER_API_KEY;

  try {
    const result = await calculateRoute(coordinates, preferences, apiKey, ghApiKey);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Onbekende fout';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
