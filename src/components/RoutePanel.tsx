'use client';

import { useState, useEffect } from 'react';
import { Waypoint, RoutePreferences, RouteResult, SavedRoute, PoiResult, PoiCategory } from '@/lib/types';
import { formatDistance, formatDuration, downloadGpxTrack, downloadGpxRoute } from '@/lib/gpx';
import { buildShareUrl } from '@/lib/share';
import AddressInput from './AddressInput';

interface RoutePanelProps {
  waypoints: Waypoint[];
  preferences: RoutePreferences;
  routeResult: RouteResult | null;
  isCalculating: boolean;
  error: string | null;
  onAddWaypoint: (lat: number, lng: number, name?: string, type?: 'waypoint' | 'poi', poiCategory?: string) => void;
  onRemoveWaypoint: (id: string) => void;
  onMoveWaypoint: (fromIndex: number, toIndex: number) => void;
  onPreferencesChange: (p: RoutePreferences) => void;
  onCalculate: () => void;
  onClearRoute: () => void;
  onFlyTo: (lat: number, lng: number) => void;
  dbRouteId?: string | null;
  poiResults?: PoiResult[];
  onPoiResultsChange?: (results: PoiResult[]) => void;
}

export default function RoutePanel({
  waypoints,
  preferences,
  routeResult,
  isCalculating,
  error,
  onAddWaypoint,
  onRemoveWaypoint,
  onMoveWaypoint,
  onPreferencesChange,
  onCalculate,
  onClearRoute,
  onFlyTo,
  dbRouteId,
  poiResults = [],
  onPoiResultsChange,
}: RoutePanelProps) {
  const [routeName, setRouteName] = useState('Mijn Route');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [currentUser, setCurrentUser] = useState<{ id: string } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me').then(r => r.json()).then(u => setCurrentUser(u));
  }, []);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [poiLoading, setPoiLoading] = useState(false);
  const [poiError, setPoiError] = useState<string | null>(null);

  // Address input values per waypoint (separate from Waypoint.name)
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  const handlePrefChange = (key: keyof RoutePreferences, value: boolean | string) => {
    onPreferencesChange({ ...preferences, [key]: value });
  };

  const PROFILES = [
    {
      id: 'toer',
      label: '🏍️ Toer',
      title: 'Toermotor — geen snelwegen, asfalt',
      prefs: { vehicleProfile: 'driving-car', style: 'recommended', avoidHighways: true, avoidMotorways: false, avoidFerries: false, avoidTollways: false, avoidUnpaved: true },
    },
    {
      id: 'sport',
      label: '⚡ Sport',
      title: 'Sportmotor — snelste route',
      prefs: { vehicleProfile: 'driving-car', style: 'fastest', avoidHighways: false, avoidMotorways: false, avoidFerries: false, avoidTollways: false, avoidUnpaved: true },
    },
    {
      id: 'cross',
      label: '🏁 Cross',
      title: 'Cross / Enduro — zoekt gravel, paden en onverharde wegen',
      prefs: { vehicleProfile: 'cycling-mountain', style: 'recommended', avoidHighways: false, avoidMotorways: false, avoidFerries: false, avoidTollways: false, avoidUnpaved: false },
    },
  ] as const;

  const activeProfile = PROFILES.find((p) =>
    (Object.keys(p.prefs) as (keyof RoutePreferences)[]).every(
      (k) => preferences[k] === p.prefs[k]
    )
  )?.id ?? null;

  const handleShare = () => {
    const url = buildShareUrl({
      name: routeName,
      waypoints,
      preferences,
    });
    setShareUrl(url);
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  const handleGpxTrack = () => {
    if (!routeResult) return;
    downloadGpxTrack(routeName, routeResult);
  };

  const handleGpxRoute = () => {
    downloadGpxRoute(routeName, waypoints);
  };

  const handleSearchPois = async (category: PoiCategory) => {
    if (waypoints.length < 2) return;

    setPoiLoading(true);
    setPoiError(null);
    try {
      // Calculate bbox from route waypoints - larger area for more results
      const lats = waypoints.map(w => w.lat);
      const lngs = waypoints.map(w => w.lng);
      const minLat = Math.min(...lats) - 0.02; // 2km buffer
      const maxLat = Math.max(...lats) + 0.02;
      const minLng = Math.min(...lngs) - 0.02;
      const maxLng = Math.max(...lngs) + 0.02;

      const bbox = `${minLng},${minLat},${maxLng},${maxLat}`;
      const res = await fetch(`/api/pois?category=${category}&bbox=${bbox}`);

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to search POIs');
      }

      const pois: PoiResult[] = await res.json();
      onPoiResultsChange?.(pois);
      
      if (pois.length === 0) {
        setPoiError('Geen POI\'s gevonden in dit gebied. Probeer een langere route of ander gebied.');
        setTimeout(() => setPoiError(null), 5000);
      }
    } catch (err) {
      console.error('POI search failed:', err);
      // Show error to user
      setPoiError(err instanceof Error ? err.message : 'POI search failed');
      setTimeout(() => setPoiError(null), 5000); // Clear error after 5 seconds
    } finally {
      setPoiLoading(false);
    }
  };

  const handleAddPoi = (poi: PoiResult) => {
    onAddWaypoint(poi.lat, poi.lng, poi.name, 'poi', poi.category);
    onPoiResultsChange?.([]); // clear results after adding
  };

  // Calculate distance between two coordinates (in meters) using haversine formula
  const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371; // Earth's radius in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c * 1000; // return in meters
  };

  const handleSaveLocal = async () => {
    if (!routeResult) return;

    // Opslaan in database als ingelogd
    if (currentUser) {
      setSaveStatus('saving');
      try {
        if (dbRouteId) {
          // Update bestaande route
          await fetch(`/api/routes/${dbRouteId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: routeName, waypoints, preferences,
              coordinates: routeResult.coordinates,
              distance: routeResult.distance,
              duration: routeResult.duration,
            }),
          });
        } else {
          // Nieuwe route aanmaken
          await fetch('/api/routes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: routeName, waypoints, preferences,
              coordinates: routeResult.coordinates,
              distance: routeResult.distance,
              duration: routeResult.duration,
            }),
          });
        }
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2500);
      } catch {
        setSaveStatus('idle');
        alert('Opslaan mislukt.');
      }
      return;
    }

    // Fallback: lokale opslag
    const saved: SavedRoute = {
      id: crypto.randomUUID(),
      name: routeName,
      waypoints,
      preferences,
      routeResult,
      createdAt: new Date().toISOString(),
    };
    const existing: SavedRoute[] = JSON.parse(
      localStorage.getItem('routrider_routes') ?? '[]'
    );
    existing.push(saved);
    localStorage.setItem('routrider_routes', JSON.stringify(existing));
    alert(`Route "${routeName}" lokaal opgeslagen!`);
  };

  // Drag-to-reorder state
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => setDragIndex(index);
  const handleDrop = (index: number) => {
    if (dragIndex === null || dragIndex === index) return;
    onMoveWaypoint(dragIndex, index);
    setDragIndex(null);
  };

  return (
    <>
      {/* Toggle button (mobile / collapse) */}
      <button
        onClick={() => setIsPanelOpen((v) => !v)}
        className="
          absolute top-4 left-4 z-[1000] flex h-10 w-10 items-center justify-center
          rounded-full bg-brand-500 text-white shadow-lg
          hover:bg-brand-600 transition-colors md:hidden
        "
        aria-label="Toggle panel"
      >
        {isPanelOpen ? '✕' : '☰'}
      </button>

      <aside
        className={`
          absolute left-0 top-0 z-[900] flex h-full w-[340px] flex-col
          bg-white shadow-2xl transition-transform duration-300
          ${isPanelOpen ? 'translate-x-0' : '-translate-x-full'}
          md:relative md:translate-x-0 md:shadow-none md:border-r md:border-gray-100
        `}
      >
        {/* Header */}
        <div className="flex items-center gap-2 bg-brand-500 px-4 py-3">
          <span className="text-xl">🏍️</span>
          <span className="text-lg font-bold tracking-wide text-white">RoutRider</span>
          <button
            onClick={() => setIsPanelOpen(false)}
            className="ml-auto text-white/70 hover:text-white md:hidden"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          {/* Route naam */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
              Naam route
            </label>
            <input
              type="text"
              value={routeName}
              onChange={(e) => setRouteName(e.target.value)}
              className="
                w-full rounded-lg border border-gray-200 px-3 py-2 text-sm
                focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500
              "
            />
          </div>

          {/* Tussenstops */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500">
                Stops
              </label>
              <span className="text-xs text-gray-400">Klik op de kaart om toe te voegen</span>
            </div>

            {waypoints.length === 0 && (
              <p className="text-sm text-gray-400 italic py-2">
                Klik op de kaart om een start te zetten, of zoek een adres hieronder.
              </p>
            )}

            <ul className="space-y-2">
              {waypoints.map((wp, index) => {
                const isFirst = index === 0;
                const isLast = index === waypoints.length - 1;
                const isPoi = wp.type === 'poi';

                // POI icons
                const poiIcons: Record<string, string> = {
                  restaurant: '🍽️',
                  fuel: '⛽',
                  cafe: '☕',
                  hotel: '🏨',
                  attraction: '🎭',
                  parking: '🅿️',
                };

                const dotColor = isPoi ? 'bg-orange-500' : isFirst ? 'bg-green-500' : isLast ? 'bg-red-500' : 'bg-blue-500';
                const label = isPoi
                  ? poiIcons[wp.poiCategory || ''] || '📍'
                  : isFirst
                  ? 'S'
                  : isLast
                  ? 'E'
                  : index.toString();

                return (
                  <li
                    key={wp.id}
                    draggable={!isPoi} // POI waypoints are not draggable
                    onDragStart={() => !isPoi && handleDragStart(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => !isPoi && handleDrop(index)}
                    className={`flex items-center gap-2 group ${isPoi ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'}`}
                  >
                    <span
                      className={`flex-shrink-0 w-5 h-5 rounded-full ${dotColor} flex items-center justify-center text-white text-[10px] font-bold`}
                    >
                      {label}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span
                        className="block text-sm text-gray-700 truncate cursor-pointer hover:text-brand-600"
                        title={wp.name || `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`}
                        onClick={() => onFlyTo(wp.lat, wp.lng)}
                      >
                        {wp.name || `${wp.lat.toFixed(4)}, ${wp.lng.toFixed(4)}`}
                      </span>
                    </div>
                    <button
                      onClick={() => onRemoveWaypoint(wp.id)}
                      className="flex-shrink-0 text-gray-300 hover:text-red-500 transition-colors"
                      title="Verwijder stop"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* Address search */}
            <div className="mt-3">
              <AddressInput
                placeholder="Zoek adres of plaats..."
                onSelect={(lat, lng, name) => onAddWaypoint(lat, lng, name)}
              />
            </div>
          </div>

          {/* POI Search */}
          {waypoints.length >= 2 && (
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
                Onderweg stoppen bij
              </label>
              <div className="grid grid-cols-2 gap-2 mb-4">
                {[
                  { category: 'restaurant' as PoiCategory, label: '🍽️ Restaurant', icon: '🍽️' },
                  { category: 'fuel' as PoiCategory, label: '⛽ Tankstation', icon: '⛽' },
                  { category: 'cafe' as PoiCategory, label: '☕ Café', icon: '☕' },
                  { category: 'hotel' as PoiCategory, label: '🏨 Hotel', icon: '🏨' },
                  { category: 'attraction' as PoiCategory, label: '🎭 Attractie', icon: '🎭' },
                  { category: 'parking' as PoiCategory, label: '🅿️ Parkeren', icon: '🅿️' },
                ].map(({ category, label, icon }) => (
                  <button
                    key={category}
                    onClick={() => handleSearchPois(category)}
                    disabled={poiLoading}
                    className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white py-2 px-3 text-sm font-medium text-gray-700 hover:border-brand-300 hover:bg-brand-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <span>{icon}</span>
                    <span>{label.split(' ')[1]}</span>
                  </button>
                ))}
              </div>

              {poiLoading && (
                <div className="text-sm text-gray-500 mb-2">Zoeken...</div>
              )}

              {poiError && (
                <div className="text-sm text-red-500 mb-2">{poiError}</div>
              )}

              {poiResults.length > 0 && (
                <div className="mb-4">
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {poiResults.map((poi) => {
                      const poiIcons: Record<PoiCategory, string> = {
                        restaurant: '🍽️',
                        fuel: '⛽',
                        cafe: '☕',
                        hotel: '🏨',
                        attraction: '🎭',
                        parking: '🅿️',
                      };
                      const distance = waypoints.length > 0 
                        ? calculateDistance(waypoints[0].lat, waypoints[0].lng, poi.lat, poi.lng)
                        : 0;
                      return (
                        <button
                          key={poi.id}
                          type="button"
                          onClick={() => handleAddPoi(poi)}
                          className="w-full text-left flex items-center justify-between gap-3 p-2 rounded border bg-gray-50 hover:bg-gray-100 cursor-pointer transition-colors"
                        >
                          <div className="flex items-center gap-3">
                            <span className="flex-shrink-0 text-lg">{poiIcons[poi.category] || '📍'}</span>
                            <div className="min-w-0">
                              <div className="text-sm font-medium text-gray-800 truncate">{poi.name}</div>
                              <div className="text-xs text-gray-500 truncate">{poi.category}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">
                              {Math.round(distance / 1000)}km
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onFlyTo(poi.lat, poi.lng);
                              }}
                              className="text-xs text-brand-600 hover:text-brand-800"
                            >
                              👁️
                            </button>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Route voorkeuren */}
          <div>
            {/* Rijdersprofiel */}
            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Rijdersprofiel
            </label>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {PROFILES.map((p) => (
                <button
                  key={p.id}
                  title={p.title}
                  onClick={() => onPreferencesChange({ ...preferences, ...p.prefs })}
                  className={`
                    flex-1 rounded-xl py-2 text-sm font-semibold border transition-colors
                    ${activeProfile === p.id
                      ? 'bg-brand-500 text-white border-brand-500 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
                    }
                  `}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
              Routestijl
            </label>
            <div className="flex gap-2 flex-wrap">
              {(['fastest', 'recommended', 'shortest'] as const).map((style) => {
                const labels: Record<string, string> = {
                  fastest: 'Snel',
                  recommended: 'Aangeraden',
                  shortest: 'Kort',
                };
                return (
                  <button
                    key={style}
                    onClick={() => handlePrefChange('style', style)}
                    className={`
                      px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                      ${preferences.style === style
                        ? 'bg-brand-500 text-white border-brand-500'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
                      }
                    `}
                  >
                    {labels[style]}
                  </button>
                );
              })}
              <button
                title="Toeristisch — vermijdt alle snelwegen, autowegen en tol. Rijdt via kleine wegen."
                onClick={() => onPreferencesChange({ ...preferences, style: 'recommended', avoidHighways: true, avoidMotorways: true, avoidTollways: true, avoidUnpaved: true })}
                className={`
                  px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                  ${preferences.avoidMotorways && preferences.avoidTollways && preferences.avoidHighways
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
                  }
                `}
              >
                🌄 Toeristisch
              </button>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mt-3 mb-2">
              Vermijden
            </label>
            <div className={`space-y-2 ${preferences.vehicleProfile === 'cycling-mountain' ? 'opacity-40 pointer-events-none' : ''}`}>
              {[
                {
                  key: 'avoidHighways',
                  label: 'Geen snelwegen',
                  description: 'Vermijd autosnelwegen (A-wegen)',
                },
                {
                  key: 'avoidMotorways',
                  label: 'Geen autowegen',
                  description: 'Vermijd autowegen (N-wegen met scheiding)',
                },
                {
                  key: 'avoidTollways',
                  label: 'Geen tolwegen',
                  description: 'Vermijd tolplichtige wegen',
                },
                {
                  key: 'avoidFerries',
                  label: 'Geen veerboten',
                  description: 'Vermijd veerpont verbindingen',
                },

              ].map(({ key, label, description }) => (
                <label
                  key={key}
                  className="flex items-start gap-3 cursor-pointer group"
                >
                  <input
                    type="checkbox"
                    checked={preferences[key as keyof RoutePreferences] as boolean}
                    onChange={(e) => handlePrefChange(key as keyof RoutePreferences, e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-brand-500 cursor-pointer"
                  />
                  <div>
                    <span className="text-sm font-medium text-gray-700 group-hover:text-brand-600">
                      {label}
                    </span>
                    <p className="text-xs text-gray-400">{description}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* POI error */}
          {poiError && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-700">
              {poiError}
            </div>
          )}

          {/* Route resultaat */}
          {routeResult && (
            <div className="rounded-xl bg-brand-50 border border-brand-100 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-700 mb-2">
                Route berekend
              </p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="flex items-center gap-1.5 text-gray-700">
                  <span>📏</span>
                  <span className="font-semibold">{formatDistance(routeResult.distance)}</span>
                </div>
                <div className="flex items-center gap-1.5 text-gray-700">
                  <span>⏱</span>
                  <span className="font-semibold">
                    {preferences.vehicleProfile === 'cycling-mountain'
                      ? formatDuration(routeResult.duration / 3)
                      : formatDuration(routeResult.duration)}
                  </span>
                </div>
                {routeResult.ascent !== undefined && (
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <span>⬆️</span>
                    <span className="font-semibold">{routeResult.ascent} m</span>
                  </div>
                )}
                {routeResult.descent !== undefined && (
                  <div className="flex items-center gap-1.5 text-gray-700">
                    <span>⬇️</span>
                    <span className="font-semibold">{routeResult.descent} m</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Actions footer */}
        <div className="border-t border-gray-100 px-4 py-3 space-y-2 bg-gray-50">
          {/* Calculate */}
          <button
            onClick={onCalculate}
            disabled={waypoints.length < 2 || isCalculating}
            className="
              w-full flex items-center justify-center gap-2
              rounded-xl bg-brand-500 py-2.5 text-sm font-semibold text-white
              hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors shadow-md shadow-brand-200
            "
          >
            {isCalculating ? (
              <>
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                Berekenen...
              </>
            ) : (
              <>🗺️ Bereken Route</>
            )}
          </button>

          {/* Save + Share + GPX (only when route is calculated) */}
          {routeResult && (
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={handleSaveLocal}
                className="
                  flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white
                  py-2 text-xs font-medium text-gray-600 hover:border-brand-300 hover:text-brand-600
                  transition-colors disabled:opacity-50
                "
                disabled={saveStatus === 'saving'}
              >
                <span>{saveStatus === 'saved' ? '✅' : '💾'}</span>
                <span>{saveStatus === 'saving' ? 'Bezig…' : saveStatus === 'saved' ? 'Opgeslagen!' : 'Opslaan'}</span>
              </button>
              <button
                onClick={handleShare}
                className="
                  flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white
                  py-2 text-xs font-medium text-gray-600 hover:border-brand-300 hover:text-brand-600
                  transition-colors
                "
              >
                <span>{copied ? '✅' : '🔗'}</span>
                <span>{copied ? 'Gekopieerd!' : 'Delen'}</span>
              </button>
              <button
                onClick={handleGpxTrack}
                title="Exacte lijn — aanbevolen voor Garmin, TomTom en de meeste apps"
                className="
                  flex flex-col items-center gap-1 rounded-lg border border-brand-300 bg-brand-50
                  py-2 text-xs font-medium text-brand-700 hover:bg-brand-100
                  transition-colors
                "
              >
                <span>📥</span>
                <span>GPX Track</span>
              </button>
              <button
                onClick={handleGpxRoute}
                title="Waypoints voor turn-by-turn — toestel herberekent zelf de weg"
                className="
                  flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-white
                  py-2 text-xs font-medium text-gray-600 hover:border-brand-300 hover:text-brand-600
                  transition-colors
                "
              >
                <span>🗺️</span>
                <span>GPX Route</span>
              </button>
            </div>
          )}

          {/* Clear */}
          {waypoints.length > 0 && (
            <button
              onClick={onClearRoute}
              className="w-full text-xs text-gray-400 hover:text-red-500 py-1 transition-colors"
            >
              Route wissen
            </button>
          )}
        </div>
      </aside>
    </>
  );
}
