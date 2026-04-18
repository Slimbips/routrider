import { PoiResult, PoiCategory } from './types';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
// Alternative servers if main one is busy
const OVERPASS_URLS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.fr/api/interpreter',
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
  // Simplified query - only nodes, smaller area, shorter timeout
  const query = `
    [out:json][timeout:15];
    node[${POI_QUERIES[category]}](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});
    out meta;
  `;

  let lastError: Error | null = null;

  // Try different servers
  for (const url of OVERPASS_URLS) {
    try {
      const timeout = url.includes('overpass-api.de') ? 20000 : 10000; // Longer timeout for main server
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RouteRider/1.0 (https://routerider.app)',
        },
        body: `data=${encodeURIComponent(query)}`,
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const errorText = await response.text();
        lastError = new Error(`Server ${url} error: ${response.status}`);
        continue; // Try next server
      }

      const data = await response.json();

      const pois = data.elements
        .filter((el: any) => el.tags?.name) // only named POI's
        .slice(0, limit)
        .map((el: any) => ({
          id: `${el.type}/${el.id}`,
          lat: el.lat,
          lng: el.lon,
          name: el.tags.name,
          category,
          tags: el.tags,
        }))
        .filter((poi: PoiResult) => poi.lat && poi.lng); // filter out invalid coords

      return pois;

    } catch (err) {
      lastError = err as Error;
      continue;
    }
  }

  // All servers failed
  throw lastError || new Error('All Overpass servers are unavailable');
}