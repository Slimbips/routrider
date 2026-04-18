import { PoiResult, PoiCategory } from './types';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

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
  const query = `
    [out:json][timeout:25];
    (
      node[${POI_QUERIES[category]}](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});
      way[${POI_QUERIES[category]}](${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]});
    );
    out center meta;
  `;

  const response = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();

  return data.elements
    .filter((el: any) => el.tags?.name) // only named POI's
    .slice(0, limit)
    .map((el: any) => ({
      id: `${el.type}/${el.id}`,
      lat: el.lat || el.center?.lat,
      lng: el.lon || el.center?.lon,
      name: el.tags.name,
      category,
      tags: el.tags,
    }))
    .filter((poi: PoiResult) => poi.lat && poi.lng); // filter out invalid coords
}