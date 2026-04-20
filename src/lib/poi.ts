import { PoiResult, PoiCategory } from './types';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

const POI_QUERIES: Record<PoiCategory, string> = {
  restaurant: 'amenity=restaurant',
  fuel: 'amenity=fuel',
  cafe: 'amenity=cafe',
  hotel: 'tourism=hotel',
  attraction: 'tourism=attraction',
  parking: 'amenity=parking',
};

export async function searchPois(
  category: PoiCategory,
  bbox: [number, number, number, number], // [minLng, minLat, maxLng, maxLat]
  limit: number = 20
): Promise<PoiResult[]> {
  // Lightweight query: only nodes, minimal output (no meta)
  const query = `[out:json][timeout:10];node[${POI_QUERIES[category]}](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});out;`;
  const body = `data=${encodeURIComponent(query)}`;

  // Race all servers simultaneously — use whichever responds first
  const requests = OVERPASS_URLS.map((url) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    }).then(async (res) => {
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      const data = await res.json();
      if (!data.elements) throw new Error('No elements in response');
      return data;
    })
  );

  let data: { elements: any[] };
  try {
    data = await Promise.any(requests);
  } catch {
    throw new Error('POI servers zijn tijdelijk niet beschikbaar. Probeer het opnieuw.');
  }

  return (data.elements as any[])
    .filter((el) => el.tags?.name && el.lat && el.lon)
    .slice(0, limit)
    .map((el) => ({
      id: `${el.type}/${el.id}`,
      lat: el.lat as number,
      lng: el.lon as number,
      name: el.tags.name as string,
      category,
      tags: el.tags,
    }));
}