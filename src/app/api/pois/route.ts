import { NextRequest, NextResponse } from 'next/server';
import { searchPois } from '@/lib/poi';
import { PoiCategory } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get('category') as PoiCategory;
  const bbox = searchParams.get('bbox'); // "minLng,minLat,maxLng,maxLat"

  if (!category || !bbox) {
    return NextResponse.json({ error: 'Missing category or bbox' }, { status: 400 });
  }

  const bboxCoords = bbox.split(',').map(Number);
  if (bboxCoords.length !== 4 || bboxCoords.some(isNaN)) {
    return NextResponse.json({ error: 'Invalid bbox format' }, { status: 400 });
  }

  try {
    const pois = await searchPois(category, bboxCoords as [number, number, number, number]);
    return NextResponse.json(pois);
  } catch (err) {
    console.error('POI search failed:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}