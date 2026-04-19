'use client';

import { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { Waypoint, RoutePreferences, RouteResult } from '@/lib/types';
import { decodeSharePayload } from '@/lib/share';
import RoutePanel from '@/components/RoutePanel';
import Navbar from '@/components/Navbar';

// Leaflet must be imported client-side only (no SSR)
const MapComponent = dynamic(() => import('@/components/MapComponent'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center bg-gray-100">
      <span className="text-gray-400">Kaart laden...</span>
    </div>
  ),
});

const DEFAULT_PREFERENCES: RoutePreferences = {
  vehicleProfile: 'driving-car',
  style: 'recommended',
  avoidHighways: true,
  avoidMotorways: false,
  avoidFerries: false,
  avoidTollways: false,
  avoidUnpaved: true,
};

function PlannerContent() {
  const searchParams = useSearchParams();
  const sharedParam = searchParams.get('shared');
  const routeIdParam = searchParams.get('routeId');
  const [dbRouteId, setDbRouteId] = useState<string | null>(null);
  const [dbOwnerId, setDbOwnerId] = useState<string | null>(null);
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);
  const [preferences, setPreferences] = useState<RoutePreferences>(DEFAULT_PREFERENCES);
  const [routeResult, setRouteResult] = useState<RouteResult | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number } | null>(null);
  const [poiResults, setPoiResults] = useState<PoiResult[]>([]);

  // Load shared route for editing
  useEffect(() => {
    if (!sharedParam) return;
    const p = decodeSharePayload(sharedParam);
    if (!p) return;
    setWaypoints(p.waypoints);
    setPreferences(p.preferences);
  }, [sharedParam]);

  // Load route from database
  useEffect(() => {
    if (!routeIdParam) return;
    fetch(`/api/routes/${routeIdParam}`).then(r => r.json()).then(data => {
      if (!data || data.error) return;
      setDbRouteId(data.id);
      setDbOwnerId(data.ownerId);
      setWaypoints(data.waypoints as Waypoint[]);
      setPreferences(data.preferences as RoutePreferences);
      if (data.coordinates && data.distance != null && data.duration != null) {
        setRouteResult({ coordinates: data.coordinates, distance: data.distance, duration: data.duration });
      }
    });
  }, [routeIdParam]);

  // Realtime SSE: ontvang updates van medewerkers
  useEffect(() => {
    if (!dbRouteId) return;
    const es = new EventSource(`/api/routes/${dbRouteId}/stream`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.waypoints) setWaypoints(data.waypoints as Waypoint[]);
        if (data.preferences) setPreferences(data.preferences as RoutePreferences);
        if (data.coordinates && data.distance != null && data.duration != null) {
          setRouteResult({ coordinates: data.coordinates, distance: data.distance, duration: data.duration });
        }
      } catch { /* ignore parse errors */ }
    };
    return () => es.close();
  }, [dbRouteId]);

  // --- Waypoint management ---

  const addWaypoint = useCallback((lat: number, lng: number, name?: string, type?: 'waypoint' | 'poi', poiCategory?: string) => {
    setWaypoints((prev) => [
      ...prev,
      { id: crypto.randomUUID(), lat, lng, name, type: type || 'waypoint', poiCategory },
    ]);
    setRouteResult(null);
    setError(null);
  }, []);

  const removeWaypoint = useCallback((id: string) => {
    setWaypoints((prev) => prev.filter((w) => w.id !== id));
    setRouteResult(null);
  }, []);

  const updateWaypointPosition = useCallback(
    (id: string, lat: number, lng: number) => {
      setWaypoints((prev) =>
        prev.map((w) => (w.id === id ? { ...w, lat, lng, name: undefined } : w))
      );
      setRouteResult(null);
    },
    []
  );

  const moveWaypoint = useCallback((fromIndex: number, toIndex: number) => {
    setWaypoints((prev) => {
      const next = [...prev];
      const [item] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, item);
      return next;
    });
    setRouteResult(null);
  }, []);

  // --- Route calculation ---

  const handleCalculate = useCallback(async () => {
    if (waypoints.length < 2) return;
    setIsCalculating(true);
    setError(null);

    try {
      const coordinates = waypoints.map(
        (w) => [w.lng, w.lat] as [number, number]
      );
      const res = await fetch('/api/calculate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coordinates, preferences }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Route berekening mislukt');
      }

      setRouteResult(data as RouteResult);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Onverwachte fout bij routeberekening'
      );
    } finally {
      setIsCalculating(false);
    }
  }, [waypoints, preferences]);

  // Auto-recalculate when a waypoint is dragged (if route was already calculated)
  const routeResultRef = useRef<RouteResult | null>(null);
  routeResultRef.current = routeResult;

  const pendingRecalcRef = useRef(false);

  const handleWaypointDrag = useCallback(
    (id: string, lat: number, lng: number) => {
      if (routeResultRef.current) pendingRecalcRef.current = true;
      updateWaypointPosition(id, lat, lng);
    },
    [updateWaypointPosition]
  );

  // Fire after waypoints state update from a drag
  useEffect(() => {
    if (!pendingRecalcRef.current || waypoints.length < 2) return;
    pendingRecalcRef.current = false;
    handleCalculate();
  }, [waypoints, handleCalculate]);

  const handleClearRoute = useCallback(() => {
    setWaypoints([]);
    setRouteResult(null);
    setError(null);
  }, []);

  const handleRouteDrag = useCallback(
    (lat: number, lng: number, insertAfterIndex: number) => {
      setWaypoints((prev) => {
        const next = [...prev];
        next.splice(insertAfterIndex + 1, 0, {
          id: crypto.randomUUID(),
          lat,
          lng,
        });
        return next;
      });
      pendingRecalcRef.current = true;
    },
    []
  );

  return (
    <main className="flex h-screen w-screen overflow-hidden">
      <Navbar />
      <RoutePanel
        waypoints={waypoints}
        preferences={preferences}
        routeResult={routeResult}
        isCalculating={isCalculating}
        error={error}
        onAddWaypoint={addWaypoint}
        onRemoveWaypoint={removeWaypoint}
        onMoveWaypoint={moveWaypoint}
        onPreferencesChange={setPreferences}
        onCalculate={handleCalculate}
        onClearRoute={handleClearRoute}
        onFlyTo={(lat, lng) => setFlyTo({ lat, lng })}
        dbRouteId={dbRouteId}
        poiResults={poiResults}
        onPoiResultsChange={setPoiResults}
      />
      <div className="flex-1 relative">
        <MapComponent
          waypoints={waypoints}
          routeResult={routeResult}
          onMapClick={addWaypoint}
          onWaypointDrag={handleWaypointDrag}
          onWaypointRightClick={removeWaypoint}
          onRouteDrag={handleRouteDrag}
          flyTo={flyTo}
          poiResults={poiResults}
        />
        {/* Hint overlay — disappears once waypoints are added */}
        {waypoints.length === 0 && (
          <div
            className="
              absolute bottom-6 left-1/2 -translate-x-1/2
              bg-white/90 backdrop-blur rounded-xl shadow-lg
              px-5 py-3 text-sm text-gray-600 pointer-events-none
              border border-gray-100
            "
          >
            🖱️ Klik op de kaart om een punt toe te voegen · Gebruik het zijpaneel voor adressen
          </div>
        )}
      </div>
    </main>
  );
}

export default function PlannerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <span className="text-gray-400">Laden...</span>
        </div>
      }
    >
      <PlannerContent />
    </Suspense>
  );
}
