import { RouteResult, Waypoint } from './types';

/**
 * Formats seconds into a human-readable duration string (e.g. "2u 34min")
 */
export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h}u`;
  return `${h}u ${m}min`;
}

/**
 * Formats meters into kilometers (e.g. "123.4 km")
 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function gpxHeader(name: string): string {
  const now = new Date().toISOString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="RoutRider"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(name)}</name>
    <time>${now}</time>
  </metadata>`;
}

/**
 * GPX Track — exacte lijn, maximale overeenkomst tussen apparaten.
 * Aanbevolen voor de meeste gebruikers.
 */
export function generateGpxTrack(
  name: string,
  result: RouteResult
): string {
  const trackPoints = result.coordinates
    .map(([lng, lat]) => `    <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"/>`)
    .join('\n');

  return `${gpxHeader(name)}
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trackPoints}
    </trkseg>
  </trk>
</gpx>`;
}

/**
 * GPX Route — alleen waypoints, toestel berekent zelf de weg.
 * Geschikt voor turn-by-turn navigatie, maar kan per apparaat afwijken.
 */
export function generateGpxRoute(
  name: string,
  waypoints: Waypoint[]
): string {
  const routePoints = waypoints
    .map((wp, i) => {
      const label =
        wp.name ||
        (i === 0 ? 'Start' : i === waypoints.length - 1 ? 'Einde' : `Via ${i}`);
      return `    <rtept lat="${wp.lat.toFixed(6)}" lon="${wp.lng.toFixed(6)}">\n      <name>${escapeXml(label)}</name>\n    </rtept>`;
    })
    .join('\n');

  return `${gpxHeader(name)}
  <rte>
    <name>${escapeXml(name)}</name>
${routePoints}
  </rte>
</gpx>`;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function triggerDownload(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
}

/** Download als GPX Track (exacte lijn). */
export function downloadGpxTrack(name: string, result: RouteResult): void {
  triggerDownload(generateGpxTrack(name, result), `${safeFilename(name)}_track.gpx`, 'application/gpx+xml');
}

/** Download als GPX Route (waypoints voor turn-by-turn). */
export function downloadGpxRoute(name: string, waypoints: Waypoint[]): void {
  triggerDownload(generateGpxRoute(name, waypoints), `${safeFilename(name)}_route.gpx`, 'application/gpx+xml');
}
