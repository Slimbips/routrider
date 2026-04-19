'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { decodeSharePayload } from '@/lib/share';
import { RouteResult, Waypoint, RoutePreferences, SharePayload } from '@/lib/types';
import { formatDistance, formatDuration, downloadGpxTrack } from '@/lib/gpx';

const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-gray-100">
      <span className="text-gray-400">Kaart laden...</span>
    </div>
  ),
});

export default function SharePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const encoded = searchParams.get('r');

  const [payload, setPayload] = useState<SharePayload | null>(null);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decodeError, setDecodeError] = useState(false);

  useEffect(() => {
    if (!encoded) { setDecodeError(true); return; }
    const p = decodeSharePayload(encoded);
    if (!p) { setDecodeError(true); return; }
    setPayload(p);
  }, [encoded]);

  const calculateRoute = useCallback(
    async (waypoints: Waypoint[], preferences: RoutePreferences) => {
      if (waypoints.length < 2) return;
      setIsCalculating(true);
      setError(null);
      try {
        const coordinates = waypoints.map((w) => [w.lng, w.lat] as [number, number]);
        const res = await fetch('/api/calculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coordinates, preferences }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Route berekening mislukt');
        setRouteResult(data as RouteResult);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fout bij routeberekening');
      } finally {
        setIsCalculating(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!payload) return;
    calculateRoute(payload.waypoints, payload.preferences);
  }, [payload, calculateRoute]);

  if (decodeError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center p-8">
          <span className="text-4xl mb-4 block">🗺️</span>
          <h1 className="text-xl font-bold text-gray-800 mb-2">Ongeldige routelink</h1>
          <p className="text-gray-500 mb-6">Deze deellink is niet geldig of verlopen.</p>
          <button
            onClick={() => router.push('/')}
            className="px-5 py-2.5 bg-brand-500 text-white rounded-xl font-semibold hover:bg-brand-600 transition-colors"
          >
            Ga naar routeplanner
          </button>
        </div>
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <span className="text-gray-400">Route laden...</span>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="bg-brand-500 text-white px-5 py-3 flex items-center gap-3 shadow-md z-10">
        <span className="text-xl">🏍️</span>
        <div className="flex-1">
          <h1 className="text-lg font-bold leading-tight">{payload.name}</h1>
          {routeResult && (
            <p className="text-brand-100 text-xs">
              {formatDistance(routeResult.distance)} · {formatDuration(routeResult.duration)}
            </p>
          )}
          {isCalculating && (
            <p className="text-brand-100 text-xs animate-pulse">Route berekenen...</p>
          )}
        </div>
        <div className="flex gap-2">
          {routeResult && (
            <button
              onClick={() => downloadGpxTrack(payload.name, routeResult)}
              className="flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium hover:bg-white/30 transition-colors"
            >
              📥 GPX
            </button>
          )}
          <button
            onClick={() => router.push(`/?shared=${encoded}`)}
            className="flex items-center gap-1.5 rounded-lg bg-white/20 px-3 py-1.5 text-sm font-medium hover:bg-white/30 transition-colors"
          >
            ✏️ Bewerken
          </button>
        </div>
      </header>

      <div className="flex-1 relative" style={{ minHeight: '400px' }}>
        {error && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-700 shadow">
            {error}
          </div>
        )}
        <MapComponent
          waypoints={payload.waypoints}
          routeResult={routeResult}
          onMapClick={() => {}}
          onWaypointDrag={() => {}}
          onWaypointRightClick={() => {}}
          poiResults={[]}
        />
      </div>

      {payload.waypoints.length > 0 && (
        <footer className="bg-white border-t border-gray-100 px-4 py-3">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {payload.waypoints.map((wp, i) => {
              const isFirst = i === 0;
              const isLast = i === payload.waypoints.length - 1;
              const dotColor = isFirst ? '#22c55e' : isLast ? '#ef4444' : '#3b82f6';
              return (
                <div key={wp.id} className="flex items-center gap-1 flex-shrink-0">
                  {i > 0 && <span className="text-gray-300 mx-1">→</span>}
                  <span
                    className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ background: dotColor }}
                  />
                  <span className="text-xs text-gray-600 whitespace-nowrap">
                    {wp.name || `${wp.lat.toFixed(3)}, ${wp.lng.toFixed(3)}`}
                  </span>
                </div>
              );
            })}
          </div>
        </footer>
      )}
    </div>
  );
}
