'use client';

import { useState } from 'react';
import { Waypoint, RoutePreferences, RouteResult, PoiResult, FuelType, GermanFuelOption } from '@/lib/types';
import { formatDistance, formatDuration } from '@/lib/gpx';
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
  onSetRouteToFuelStation: (lat: number, lng: number, name: string, option?: GermanFuelOption) => void;
  fuelOptions?: GermanFuelOption[];
  onFuelOptionsChange?: (options: GermanFuelOption[]) => void;
  selectedFuelOption?: GermanFuelOption | null;
}

export default function RoutePanel({ waypoints, onAddWaypoint, onSetRouteToFuelStation, fuelOptions = [], onFuelOptionsChange, selectedFuelOption = null }: RoutePanelProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(true);
  const [fuelType, setFuelType] = useState<FuelType>('e10');
  const [consumptionKmPerL, setConsumptionKmPerL] = useState('15');
  const [litersToTank, setLitersToTank] = useState('40');
  const [nlPricePerLiter, setNlPricePerLiter] = useState('2.05');
  const [deEstimatedPricePerLiter, setDeEstimatedPricePerLiter] = useState('1.78');
  const [fuelOnlyOpen, setFuelOnlyOpen] = useState(true);
  const [includeReturnTrip, setIncludeReturnTrip] = useState(true);
  const [maxBorderDistanceKm, setMaxBorderDistanceKm] = useState('20');
  const [fuelSortBy, setFuelSortBy] = useState<'saving' | 'total' | 'distance' | 'fuelPrice'>('saving');
  const [fuelPriceSource, setFuelPriceSource] = useState<'live' | 'estimated' | null>(null);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelError, setFuelError] = useState<string | null>(null);

  const formatEuro = (value: number) => `EUR ${value.toFixed(2)}`;

  const openGoogleMapsNavigation = (destinationLat: number, destinationLng: number) => {
    const start = waypoints[0];
    const url = new URL('https://www.google.com/maps/dir/');
    url.searchParams.set('api', '1');
    url.searchParams.set('destination', `${destinationLat},${destinationLng}`);
    url.searchParams.set('travelmode', 'driving');
    if (start) {
      url.searchParams.set('origin', `${start.lat},${start.lng}`);
    }
    window.open(url.toString(), '_blank', 'noopener,noreferrer');
  };

  const handleSearchGermanFuel = async () => {
    if (waypoints.length < 1) {
      setFuelError('Zet eerst een vertrekpunt neer.');
      return;
    }

    const consumption = Number(consumptionKmPerL);
    const liters = Number(litersToTank);
    const nlPrice = Number(nlPricePerLiter);
    const deEstimate = Number(deEstimatedPricePerLiter);
    const borderDistanceLimit = Number(maxBorderDistanceKm);

    if (!Number.isFinite(consumption) || consumption <= 0) return setFuelError('Verbruik moet groter zijn dan 0.');
    if (!Number.isFinite(liters) || liters <= 0) return setFuelError('Aantal liters moet groter zijn dan 0.');
    if (!Number.isFinite(nlPrice) || nlPrice <= 0) return setFuelError('NL prijs per liter moet groter zijn dan 0.');
    if (!Number.isFinite(deEstimate) || deEstimate <= 0) return setFuelError('Geschatte DE prijs per liter moet groter zijn dan 0.');
    if (!Number.isFinite(borderDistanceLimit) || borderDistanceLimit < 5) return setFuelError('Max afstand over de grens moet minstens 5 km zijn.');

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
          deEstimatedPricePerLiter: deEstimate,
          maxBorderDistanceKm: borderDistanceLimit,
          onlyOpen: fuelOnlyOpen,
          includeReturnTrip,
          sortBy: fuelSortBy,
        }),
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Zoeken naar Duitse tankstations mislukt');

      setFuelPriceSource((data.priceSource as 'live' | 'estimated' | undefined) ?? null);
      const options = (data.options ?? []) as GermanFuelOption[];
      onFuelOptionsChange?.(options);
      if (options.length === 0) setFuelError('Geen geschikte Duitse tankstations gevonden.');
    } catch (error) {
      setFuelError(error instanceof Error ? error.message : 'Onverwachte fout bij tankstation-zoekopdracht');
    } finally {
      setFuelLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setIsPanelOpen((v) => !v)}
        className="absolute top-4 left-4 z-[1000] flex h-10 w-10 items-center justify-center rounded-full bg-brand-500 text-white shadow-lg hover:bg-brand-600 transition-colors md:hidden"
        aria-label="Toggle panel"
      >
        {isPanelOpen ? '✕' : '☰'}
      </button>

      <aside className={`absolute left-0 top-0 z-[900] flex h-full w-[340px] flex-col bg-white shadow-2xl transition-transform duration-300 ${isPanelOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0 md:shadow-none md:border-r md:border-gray-100`}>
        <div className="flex items-center gap-2 bg-brand-500 px-4 py-3">
          <span className="text-xl">⛽</span>
          <span className="text-lg font-bold tracking-wide text-white">SlimTanken</span>
          <button
            onClick={() => setIsPanelOpen(false)}
            className="ml-auto text-white/70 hover:text-white md:hidden"
            aria-label="Sluiten"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Vertrekpunt</label>
              <p className="text-xs text-gray-500">Kies alleen je vertrekpunt. De rest van de site toont alleen goedkope Duitse benzine-opties.</p>
            </div>
            <AddressInput placeholder="Zoek vertrekpunt..." onSelect={(lat, lng, name) => onAddWaypoint(lat, lng, name)} />
            {waypoints[0] && (
              <div className="rounded-lg bg-white border border-gray-200 px-3 py-2 text-xs text-gray-600">
                Huidig vertrekpunt: {waypoints[0].name || `${waypoints[0].lat.toFixed(4)}, ${waypoints[0].lng.toFixed(4)}`}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Tankplanner Duitsland</label>
              <p className="text-xs text-gray-500">Zonder key werkt dit met een schatting. Zodra je Tankerkönig-key er is, schakelt de app automatisch over naar live prijzen.</p>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-600">
                Brandstof
                <select value={fuelType} onChange={(e) => setFuelType(e.target.value as FuelType)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white">
                  <option value="e5">E5</option>
                  <option value="e10">E10</option>
                  <option value="diesel">Diesel</option>
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Verbruik (km/l)
                <input type="number" min="1" step="0.1" value={consumptionKmPerL} onChange={(e) => setConsumptionKmPerL(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white" />
              </label>
              <label className="text-xs text-gray-600">
                Liters tanken
                <input type="number" min="1" step="1" value={litersToTank} onChange={(e) => setLitersToTank(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white" />
              </label>
              <label className="text-xs text-gray-600">
                NL prijs/liter
                <input type="number" min="0.5" step="0.01" value={nlPricePerLiter} onChange={(e) => setNlPricePerLiter(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white" />
              </label>
              <label className="text-xs text-gray-600">
                Geschatte DE prijs/liter
                <input type="number" min="0.5" step="0.01" value={deEstimatedPricePerLiter} onChange={(e) => setDeEstimatedPricePerLiter(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white" />
              </label>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-600">
                Sorteren op
                <select value={fuelSortBy} onChange={(e) => setFuelSortBy(e.target.value as 'saving' | 'total' | 'distance' | 'fuelPrice')} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white">
                  <option value="saving">Hoogste besparing</option>
                  <option value="total">Laagste totaalprijs</option>
                  <option value="distance">Kortste rit</option>
                  <option value="fuelPrice">Goedkoopste literprijs</option>
                </select>
              </label>
              <label className="text-xs text-gray-600">
                Max over grens
                <select value={maxBorderDistanceKm} onChange={(e) => setMaxBorderDistanceKm(e.target.value)} className="mt-1 w-full rounded border border-gray-200 px-2 py-1.5 text-sm bg-white">
                  <option value="12">12 km</option>
                  <option value="20">20 km (standaard)</option>
                  <option value="30">30 km</option>
                  <option value="40">40 km</option>
                </select>
              </label>
              <div className="space-y-1 pt-5">
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={fuelOnlyOpen} onChange={(e) => setFuelOnlyOpen(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                  Alleen open stations
                </label>
                <label className="flex items-center gap-2 text-xs text-gray-600">
                  <input type="checkbox" checked={includeReturnTrip} onChange={(e) => setIncludeReturnTrip(e.target.checked)} className="h-4 w-4 accent-emerald-600" />
                  Heen en terug meenemen
                </label>
              </div>
            </div>

            <button onClick={handleSearchGermanFuel} disabled={fuelLoading || waypoints.length < 1} className="w-full rounded-lg bg-emerald-600 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
              {fuelLoading ? 'Zoeken...' : 'Vind Duitse tankstations'}
            </button>

            {fuelError && <div className="text-xs text-red-600">{fuelError}</div>}

            {fuelPriceSource === 'estimated' && (
              <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                Je gebruikt nu geschatte Duitse literprijzen. Zodra de Tankerkönig-key actief is, gebruikt de app automatisch live prijzen.
              </div>
            )}

            {selectedFuelOption && (
              <div className={`rounded-lg border p-3 text-xs ${selectedFuelOption.netSaving >= 0 ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
                <div className={`font-semibold ${selectedFuelOption.netSaving >= 0 ? 'text-emerald-800' : 'text-red-800'}`}>
                  {selectedFuelOption.netSaving >= 0 ? '✅ Voordelig om naar Duitsland te rijden' : '❌ Niet voordelig om naar Duitsland te rijden'}
                </div>
                <div className="mt-1 text-gray-800">
                  {selectedFuelOption.netSaving >= 0
                    ? `Tanken in Duitsland bespaart je naar verwachting ${formatEuro(selectedFuelOption.netSaving)} ten opzichte van tanken in Nederland.`
                    : `Tanken in Duitsland kost je naar verwachting ${formatEuro(Math.abs(selectedFuelOption.netSaving))} meer dan tanken in Nederland.`}
                </div>
                <div className="mt-2 text-gray-700">Station: {selectedFuelOption.name} ({selectedFuelOption.fuelPrice.toFixed(3)} /L)</div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-gray-700">
                  <span>Tankkosten Duitsland: {formatEuro(selectedFuelOption.fuelCost)}</span>
                  <span>Ritkosten: {formatEuro(selectedFuelOption.driveCost)}</span>
                  <span className="font-semibold">Totaal Duitsland: {formatEuro(selectedFuelOption.totalCost)}</span>
                  <span>Tankkosten Nederland: {formatEuro(selectedFuelOption.nlFuelCost)}</span>
                  <span className={`font-semibold ${selectedFuelOption.netSaving >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                    {selectedFuelOption.netSaving >= 0
                      ? `Netto voordeel: ${formatEuro(selectedFuelOption.netSaving)}`
                      : `Netto nadeel: ${formatEuro(Math.abs(selectedFuelOption.netSaving))}`}
                  </span>
                </div>
                <button
                  onClick={() => openGoogleMapsNavigation(selectedFuelOption.lat, selectedFuelOption.lng)}
                  className="mt-3 w-full rounded border border-blue-300 bg-blue-50 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                >
                  Open navigatie in Google Maps
                </button>
              </div>
            )}

            {fuelOptions.length > 0 && (
              <div className="space-y-2 max-h-56 overflow-y-auto">
                {fuelOptions.map((option) => (
                  <div key={option.id} className="rounded-lg border border-gray-200 bg-white p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-gray-800 truncate">{option.name}</div>
                        <div className="text-xs text-gray-500 truncate">{option.address}</div>
                      </div>
                      <div className="text-xs font-semibold text-emerald-700">{option.fuelPrice.toFixed(3)} /L</div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-gray-600">
                      <span>Rit: {formatDistance(option.evaluatedDriveDistanceM)}{option.includeReturnTrip ? ' (heen+terug)' : ' (heen)'}</span>
                      <span>Tijd: {formatDuration(option.evaluatedDriveDurationS)}</span>
                      <span>Ritkosten: {formatEuro(option.driveCost)}</span>
                      <span>Tankkosten: {formatEuro(option.fuelCost)}</span>
                      <span className="font-semibold text-gray-800">Totaal: {formatEuro(option.totalCost)}</span>
                      <span className={`font-semibold ${option.netSaving >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                        {option.netSaving >= 0 ? `Netto voordeel ${formatEuro(option.netSaving)}` : `Netto nadeel ${formatEuro(Math.abs(option.netSaving))}`}
                      </span>
                      <span className="text-gray-500">NL tankkosten: {formatEuro(option.nlFuelCost)}</span>
                      <span className={`font-medium ${option.isOpen ? 'text-emerald-700' : 'text-amber-600'}`}>
                        {option.isOpen ? 'Nu open' : 'Nu gesloten'}
                      </span>
                    </div>
                    <button onClick={() => onSetRouteToFuelStation(option.lat, option.lng, option.name, option)} className="mt-2 w-full rounded border border-emerald-300 bg-emerald-50 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100">
                      Gebruik als bestemming
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}
