'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Waypoint, RoutePreferences, RouteResult, SavedRoute, PoiResult, PoiCategory, FuelType, GermanFuelOption } from '@/lib/types';
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
  onSetRouteToFuelStation: (lat: number, lng: number, name: string) => void;
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
  onSetRouteToFuelStation,
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
  const [activePoiCategory, setActivePoiCategory] = useState<PoiCategory | null>(null);
  const lastPoiRouteKeyRef = useRef<string | null>(null);
  const [fuelType, setFuelType] = useState<FuelType>('e10');
  const [consumptionKmPerL, setConsumptionKmPerL] = useState('15');
  const [litersToTank, setLitersToTank] = useState('40');
  const [nlPricePerLiter, setNlPricePerLiter] = useState('2.05');
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelError, setFuelError] = useState<string | null>(null);
  const [fuelOptions, setFuelOptions] = useState<GermanFuelOption[]>([]);

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

  const POI_QUERIES: Record<PoiCategory, string> = {
    restaurant: 'amenity=restaurant',
    fuel: 'amenity=fuel',
    cafe: 'amenity=cafe',
    hotel: 'tourism=hotel',
    attraction: 'tourism=attraction',
    parking: 'amenity=parking',
  };

  const OVERPASS_URLS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.openstreetmap.fr/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  ];

  const fetchOverpass = async (query: string, timeoutMs: number) => {
    const body = `data=${encodeURIComponent(query)}`;
    const requests = OVERPASS_URLS.map((url) =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      }).then(async (res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        const data = await res.json();
        if (!data.elements) throw new Error('No elements');
        return data;
      })
    );

    return Promise.any(requests);
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
    return R * c * 1000;
  };

  const getPoiRouteKey = useCallback(() => {
    if (routeResult?.coordinates?.length) {
      const first = routeResult.coordinates[0];
      const last = routeResult.coordinates[routeResult.coordinates.length - 1];
      return [
        'route',
        routeResult.distance,
        routeResult.duration,
        routeResult.coordinates.length,
        first?.[0],
        first?.[1],
        last?.[0],
        last?.[1],
      ].join(':');
    }

    return [
      'wp',
      ...waypoints.map((w) => `${w.lat.toFixed(5)},${w.lng.toFixed(5)}`),
    ].join('|');
  }, [routeResult, waypoints]);

  const handleSearchPois = useCallback(async (category: PoiCategory) => {
    if (waypoints.length < 2) return;

    setActivePoiCategory(category);
    lastPoiRouteKeyRef.current = getPoiRouteKey();
    setPoiLoading(true);
    setPoiError(null);
    try {
      // Sample evenly-spaced points along the route (or straight-line between waypoints).
      // This avoids giant bounding-box queries that time-out on long routes like Veendam→Antwerpen.
      const routeCoords: [number, number][] = routeResult?.coordinates?.length
        ? (routeResult.coordinates as [number, number][])
        : waypoints.map(w => [w.lng, w.lat]);

      const totalPoints = routeCoords.length;
      const NUM_SAMPLES = Math.min(20, Math.max(6, Math.ceil(totalPoints / 40)));
      const sampleStep = Math.floor(totalPoints / NUM_SAMPLES);

      const sampledPoints: { lat: number; lng: number }[] = [];
      for (let i = 0; i < NUM_SAMPLES; i++) {
        const idx = Math.min(i * sampleStep, totalPoints - 1);
        const [lng, lat] = routeCoords[idx];
        sampledPoints.push({ lat, lng });
      }
      // Always include the last coordinate
      const [lastLng, lastLat] = routeCoords[totalPoints - 1];
      if (sampledPoints[sampledPoints.length - 1].lat !== lastLat) {
        sampledPoints.push({ lat: lastLat, lng: lastLng });
      }

      // Radius per sample point: enough to bridge the gap between consecutive samples + a margin
      const routeLengthKm = routeResult?.distance
        ? routeResult.distance / 1000
        : calculateDistance(waypoints[0].lat, waypoints[0].lng, waypoints[waypoints.length - 1].lat, waypoints[waypoints.length - 1].lng) / 1000;
      const gapKm = routeLengthKm / sampledPoints.length;
      const radiusM = Math.round(Math.min(15000, Math.max(4000, gapKm * 700)));

      const tag = POI_QUERIES[category];
      const aroundFilters = sampledPoints
        .map(p => `node[${tag}](around:${radiusM},${p.lat},${p.lng});`)
        .join('');

      const nwrQuery = `[out:json][timeout:20];(${aroundFilters});out;`;
      const fallbackAroundFilters = sampledPoints
        .filter((_, i) => i % 2 === 0) // half the points for lighter fallback
        .map(p => `node[${tag}](around:${radiusM + 2000},${p.lat},${p.lng});`)
        .join('');
      const nodeFallbackQuery = `[out:json][timeout:15];(${fallbackAroundFilters});out;`;

      let data: any;
      try {
        data = await fetchOverpass(nwrQuery, 14000);
      } catch {
        data = await fetchOverpass(nodeFallbackQuery, 12000);
      }

      const seen = new Set<string>();
      const pois: PoiResult[] = (data.elements as any[])
        .map((el: any) => {
          const lat = el.lat ?? el.center?.lat;
          const lng = el.lon ?? el.center?.lon;
          return { el, lat, lng };
        })
        .filter(({ el, lat, lng }: any) => el.tags?.name && typeof lat === 'number' && typeof lng === 'number')
        .map(({ el, lat, lng }: any) => ({
          id: `${el.type}/${el.id}`,
          lat: lat as number,
          lng: lng as number,
          name: el.tags.name as string,
          category,
          tags: el.tags,
        }))
        .filter((poi) => {
          if (seen.has(poi.id)) return false;
          seen.add(poi.id);
          return true;
        })
        .slice(0, 120);

      onPoiResultsChange?.(pois);

      if (pois.length === 0) {
        setPoiError('Geen resultaten gevonden in dit gebied.');
        setTimeout(() => setPoiError(null), 5000);
      }
    } catch (err) {
      console.error('POI search failed:', err);
      setPoiError('Zoeken mislukt. Probeer het opnieuw.');
      setTimeout(() => setPoiError(null), 5000);
    } finally {
      setPoiLoading(false);
    }
  }, [waypoints, routeResult, onPoiResultsChange, getPoiRouteKey]);

  useEffect(() => {
    if (!activePoiCategory) {
      lastPoiRouteKeyRef.current = getPoiRouteKey();
      return;
    }
    if (waypoints.length < 2) return;
    if (poiLoading) return;

    const nextKey = getPoiRouteKey();
    if (!lastPoiRouteKeyRef.current) {
      lastPoiRouteKeyRef.current = nextKey;
      return;
    }

    if (lastPoiRouteKeyRef.current !== nextKey) {
      lastPoiRouteKeyRef.current = nextKey;
      void handleSearchPois(activePoiCategory);
    }
  }, [activePoiCategory, poiLoading, routeResult, waypoints, getPoiRouteKey, handleSearchPois]);

  const handleAddPoi = (poi: PoiResult) => {
    onAddWaypoint(poi.lat, poi.lng, poi.name, 'poi', poi.category);
    onPoiResultsChange?.([]); // clear results after adding
  };

  const formatEuro = (value: number) => `EUR ${value.toFixed(2)}`;

  const handleSearchGermanFuel = async () => {
    if (waypoints.length < 1) {
      setFuelError('Zet eerst een startpunt op de kaart.');
      setTimeout(() => setFuelError(null), 4000);
      return;
    }

    const consumption = Number(consumptionKmPerL);
    const liters = Number(litersToTank);
    const nlPrice = Number(nlPricePerLiter);

    if (!Number.isFinite(consumption) || consumption <= 0) {
      setFuelError('Verbruik moet groter zijn dan 0 (bijv. 15 km/l).');
      return;
    }
    if (!Number.isFinite(liters) || liters <= 0) {
      setFuelError('Aantal liters moet groter zijn dan 0.');
      return;
    }
    if (!Number.isFinite(nlPrice) || nlPrice <= 0) {
      setFuelError('NL prijs per liter moet groter zijn dan 0.');
      return;
    }

    const start = waypoints[0];

    setFuelLoading(true);
    setFuelError(null);
    try {
      const response = await fetch('/api/fuel/de-stations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: { lat: start.lat, lng: start.lng },
          fuelType,
          consumptionKmPerL: consumption,
          litersToTank: liters,
          nlPricePerLiter: nlPrice,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? 'Zoeken naar Duitse tankstations mislukt');
      }

      const options = (data.options ?? []) as GermanFuelOption[];
      setFuelOptions(options);
      if (options.length === 0) {
        setFuelError('Geen geschikte Duitse tankstations gevonden.');
      }
    } catch (err) {
      setFuelError(err instanceof Error ? err.message : 'Onverwachte fout bij tankstation-zoekopdracht');
    } finally {
      setFuelLoading(false);
    }
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
                    draggable={true} // Allow dragging all waypoints including POIs
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(index)}
                    className="flex items-center gap-2 group cursor-grab active:cursor-grabbing"
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

          {/* Duitsland tanken planner */}
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">
                Tankplanner Duitsland
              </label>
              <p className="text-xs text-gray-500">
                Berekent meerdere Duitse tankstations en wat het totaal kost inclusief heenrit.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-600">
                Brandstof
                <select
                  value={fuelType}
                  onChange={(e) => setFuelType(e.target.value as FuelType)}
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white"
                >
                  <option value="e5">E5</option>
                  <option value="e10">E10</option>
                  <option value="diesel">Diesel</option>
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Verbruik (km/l)
                <input
                  type="number"
                  min="1"
                  step="0.1"
                  value={consumptionKmPerL}
                  onChange={(e) => setConsumptionKmPerL(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white"
                />
              </label>
              <label className="text-xs text-gray-600">
                Liters tanken
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={litersToTank}
                  onChange={(e) => setLitersToTank(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white"
                />
              </label>
              <label className="text-xs text-gray-600">
                NL prijs/liter
                <input
                  type="number"
                  min="0.5"
                  step="0.01"
                  value={nlPricePerLiter}
                  onChange={(e) => setNlPricePerLiter(e.target.value)}
                  className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white"
                />
              </label>
            </div>

            <button
              onClick={handleSearchGermanFuel}
              disabled={fuelLoading || waypoints.length < 1}
              className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {fuelLoading ? 'Zoeken...' : 'Vind Duitse tankstations'}
            </button>

            {fuelError && <div className="text-xs text-red-600">{fuelError}</div>}

            {fuelOptions.length > 0 && (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {fuelOptions.slice(0, 8).map((option) => (
                  <div key={option.id} className="rounded-lg border border-gray-200 bg-white p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-800 truncate">{option.name}</div>
                        <div className="text-xs text-gray-500 truncate">{option.address}</div>
                      </div>
                      <div className="text-xs font-semibold text-emerald-700">{option.fuelPrice.toFixed(3)} /L</div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                      <span>Rit: {formatDistance(option.routeDistanceM)}</span>
                      <span>Tijd: {formatDuration(option.routeDurationS)}</span>
                      <span>Ritkosten: {formatEuro(option.driveCost)}</span>
                      <span>Tankkosten: {formatEuro(option.fuelCost)}</span>
                      <span className="font-semibold text-gray-800">Totaal: {formatEuro(option.totalCost)}</span>
                      <span className={`font-semibold ${option.netSaving >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {option.netSaving >= 0 ? `Besparing ${formatEuro(option.netSaving)}` : `Meerprijs ${formatEuro(Math.abs(option.netSaving))}`}
                      </span>
                    </div>
                    <button
                      onClick={() => onSetRouteToFuelStation(option.lat, option.lng, option.name)}
                      className="mt-2 w-full rounded border border-emerald-300 bg-emerald-50 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    >
                      Gebruik als bestemming
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

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
            {(() => {
              const isTouristicSelected =
                preferences.style === 'recommended' &&
                preferences.avoidHighways &&
                preferences.avoidMotorways &&
                preferences.avoidTollways &&
                preferences.avoidFerries;

              return (
            <div className="flex gap-2 flex-wrap">
              {(['fastest', 'recommended', 'shortest'] as const).map((style) => {
                const labels: Record<string, string> = {
                  fastest: 'Snel',
                  recommended: 'Aangeraden',
                  shortest: 'Kort',
                };

                const isRegularStyleActive =
                  preferences.style === style && !(isTouristicSelected && style === 'recommended');

                return (
                  <button
                    key={style}
                    onClick={() => handlePrefChange('style', style)}
                    className={`
                      px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                      ${isRegularStyleActive
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
                title="Toeristisch — vermijdt snelwegen, autowegen, tolwegen en veerboten. Rijdt via kleinere wegen."
                onClick={() => onPreferencesChange({ ...preferences, style: 'recommended', avoidHighways: true, avoidMotorways: true, avoidTollways: true, avoidFerries: true, avoidUnpaved: true })}
                className={`
                  px-3 py-1.5 rounded-full text-sm font-medium border transition-colors
                  ${isTouristicSelected
                    ? 'bg-brand-500 text-white border-brand-500'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300'
                  }
                `}
              >
                🌄 Toeristisch
              </button>
            </div>
              );
            })()}

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

          {/* Route error */}
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
              {error}
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
