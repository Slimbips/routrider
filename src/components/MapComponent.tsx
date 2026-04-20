'use client';

import { useEffect, useRef, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapComponent.css';
import { Waypoint, RouteResult, PoiResult } from '@/lib/types';

// Custom colored circle markers (avoids missing image issue with default Leaflet icons)
function createMarkerIcon(color: string, label: string): L.DivIcon {
  return L.divIcon({
    className: '',
    html: `
      <div style="
        width:32px;height:32px;border-radius:50% 50% 50% 0;
        background:${color};border:3px solid #fff;
        box-shadow:0 2px 6px rgba(0,0,0,.4);
        transform:rotate(-45deg);
        display:flex;align-items:center;justify-content:center;
      ">
        <span style="
          transform:rotate(45deg);color:#fff;font-weight:700;
          font-size:12px;font-family:sans-serif;line-height:1;
        ">${label}</span>
      </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
  });
}

function createPoiIcon(category: string): L.DivIcon {
  const icons: Record<string, string> = {
    restaurant: '🍽️',
    fuel: '⛽',
    cafe: '☕',
    hotel: '🏨',
    attraction: '🎡',
    parking: '🅿️',
  };

  return L.divIcon({
    className: 'poi-marker-icon',
    html: `
      <div style="
        width:32px;height:32px;border-radius:50%;
        background:#f59e0b;border:3px solid #fff;
        box-shadow:0 2px 6px rgba(0,0,0,.4);
        display:flex;align-items:center;justify-content:center;
        font-size:16px;
        pointer-events:auto;
        cursor:pointer;
        z-index:1000; position:relative;">
        ${icons[category] || '📍'}
      </div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -34],
  });
}

const START_COLOR = '#22c55e';  // green
const END_COLOR = '#ef4444';    // red
const VIA_COLOR = '#3b82f6';    // blue

interface MapComponentProps {
  waypoints: Waypoint[];
  routeResult: RouteResult | null;
  onMapClick: (lat: number, lng: number) => void;
  onWaypointDrag: (id: string, lat: number, lng: number) => void;
  onWaypointRightClick: (id: string) => void;
  /** Called when user drags the route line: inserts a via-point at (lat,lng) after waypoints[insertAfterIndex] */
  onRouteDrag?: (lat: number, lng: number, insertAfterIndex: number) => void;
  /** Fly to these coordinates when set */
  flyTo?: { lat: number; lng: number } | null;
  /** POI results to show on map */
  poiResults?: PoiResult[];
  /** Click handler for POI map markers */
  onPoiClick?: (poi: PoiResult) => void;
}

/** Find which waypoint index to insert after, based on drag position on the route */
function findInsertIndex(
  routeCoords: [number, number][], // [lng, lat]
  waypoints: Waypoint[],
  dragLng: number,
  dragLat: number
): number {
  const distSq = (ax: number, ay: number, bx: number, by: number) =>
    (ax - bx) ** 2 + (ay - by) ** 2;

  // Closest route coordinate index to the drag start point
  let closestRouteIdx = 0;
  let closestDist = Infinity;
  for (let i = 0; i < routeCoords.length; i++) {
    const d = distSq(routeCoords[i][0], routeCoords[i][1], dragLng, dragLat);
    if (d < closestDist) { closestDist = d; closestRouteIdx = i; }
  }

  // For each waypoint, find the nearest route coordinate index
  const wpRouteIdx = waypoints.map((wp) => {
    let minD = Infinity, minI = 0;
    for (let i = 0; i < routeCoords.length; i++) {
      const d = distSq(routeCoords[i][0], routeCoords[i][1], wp.lng, wp.lat);
      if (d < minD) { minD = d; minI = i; }
    }
    return minI;
  });

  // Insert after the waypoint whose route-index is just before the drag point
  for (let i = 0; i < wpRouteIdx.length - 1; i++) {
    if (closestRouteIdx >= wpRouteIdx[i] && closestRouteIdx <= wpRouteIdx[i + 1]) {
      return i;
    }
  }
  return waypoints.length - 2; // fallback: insert before last
}

export default function MapComponent({
  waypoints,
  routeResult,
  onMapClick,
  onWaypointDrag,
  onWaypointRightClick,
  onRouteDrag,
  flyTo,
  poiResults = [],
  onPoiClick,
}: MapComponentProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const poiMarkersRef = useRef<Map<string, L.Marker>>(new Map());
  const polylineRef = useRef<L.Polyline | null>(null);

  // Stable callback refs to avoid recreating map on every render
  const onMapClickRef = useRef(onMapClick);
  const onPoiClickRef = useRef(onPoiClick);
  useEffect(() => { onMapClickRef.current = onMapClick; }, [onMapClick]);
  useEffect(() => { onPoiClickRef.current = onPoiClick; }, [onPoiClick]);

  const onWaypointDragRef = useRef(onWaypointDrag);
  useEffect(() => { onWaypointDragRef.current = onWaypointDrag; }, [onWaypointDrag]);

  const onWaypointRightClickRef = useRef(onWaypointRightClick);
  useEffect(() => { onWaypointRightClickRef.current = onWaypointRightClick; }, [onWaypointRightClick]);

  const onRouteDragRef = useRef(onRouteDrag);
  useEffect(() => { onRouteDragRef.current = onRouteDrag; }, [onRouteDrag]);

  const waypointsRef = useRef(waypoints);
  useEffect(() => { waypointsRef.current = waypoints; }, [waypoints]);

  const routeResultRef2 = useRef(routeResult);
  useEffect(() => { routeResultRef2.current = routeResult; }, [routeResult]);

  // --- Initialise map once ---
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [52.25, 5.45], // center of the Netherlands
      zoom: 7,
      zoomControl: true,
    });

    // OpenStreetMap tiles (free, no key required)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    map.on('click', (e: L.LeafletMouseEvent) => {
      onMapClickRef.current(e.latlng.lat, e.latlng.lng);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // --- Update markers when waypoints change ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(waypoints.map((w) => w.id));

    // Remove markers no longer in waypoints
    markersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    });

    // Add or update markers
    waypoints.forEach((wp, index) => {
      const isPoi = wp.type === 'poi';
      let icon: L.DivIcon;

      if (isPoi) {
        icon = createPoiIcon(wp.poiCategory || 'unknown');
      } else {
        const isFirst = index === 0;
        const isLast = index === waypoints.length - 1;
        const color = isFirst ? START_COLOR : isLast ? END_COLOR : VIA_COLOR;
        const label = isFirst ? 'S' : isLast ? 'E' : String(index);
        icon = createMarkerIcon(color, label);
      }

      const existing = markersRef.current.get(wp.id);
      if (existing) {
        existing.setLatLng([wp.lat, wp.lng]);
        existing.setIcon(icon);
      } else {
        const marker = L.marker([wp.lat, wp.lng], {
          icon,
          draggable: !isPoi, // POI's niet draggable maken
        });

        if (!isPoi) {
          marker.on('dragend', () => {
            const { lat, lng } = marker.getLatLng();
            onWaypointDragRef.current(wp.id, lat, lng);
          });
        }

        marker.on('contextmenu', (e) => {
          L.DomEvent.stopPropagation(e);
          onWaypointRightClickRef.current(wp.id);
        });

        if (wp.name) {
          marker.bindTooltip(wp.name, {
            permanent: false,
            direction: 'top',
            interactive: false,
          });
        }

        if (isPoi) {
          marker.on('click', () => {
            onPoiClickRef.current?.(wp as PoiResult);
          });
        }

        marker.addTo(map);
        markersRef.current.set(wp.id, marker);
      }
    });
  }, [waypoints]);

  // --- Update POI markers when poiResults change ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentIds = new Set(poiResults.map((poi) => poi.id));

    // Remove POI markers no longer in results
    poiMarkersRef.current.forEach((marker, id) => {
      if (!currentIds.has(id)) {
        marker.remove();
        poiMarkersRef.current.delete(id);
      }
    });

    // Add or update POI markers
    poiResults.forEach((poi) => {
      const existing = poiMarkersRef.current.get(poi.id);
      if (existing) {
        existing.setLatLng([poi.lat, poi.lng]);
      } else {
        const icon = createPoiIcon(poi.category);
        const marker = L.marker([poi.lat, poi.lng], {
          icon,
          interactive: true,
          bubblingMouseEvents: false,
        });

        marker.bindTooltip(poi.name, {
          permanent: false,
          direction: 'top',
          interactive: false,
        });

        marker.addTo(map);
        marker.setZIndexOffset(1000); // Bring POI markers to front

        // Add click handler using addEventListener for better compatibility
        const handleClick = (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          console.log('POI marker clicked:', poi.name);
          onPoiClickRef.current?.(poi);
        };

        marker.on('click', handleClick);

        poiMarkersRef.current.set(poi.id, marker);
      }
    });
  }, [poiResults]);

  // --- Draw / update route polyline ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (polylineRef.current) {
      // Also remove the invisible hit layer if present
      const withHit = polylineRef.current as L.Polyline & { _hitLine?: L.Polyline };
      withHit._hitLine?.remove();
      polylineRef.current.remove();
      polylineRef.current = null;
    }

    if (routeResult && routeResult.coordinates.length > 1) {
      const latlngs = routeResult.coordinates.map(
        ([lng, lat]) => [lat, lng] as L.LatLngTuple
      );

      // Wider invisible hit area for easier dragging
      const hitLine = L.polyline(latlngs, {
        color: 'transparent',
        weight: 20,
        opacity: 0,
      }).addTo(map);

      const visLine = L.polyline(latlngs, {
        color: '#f97316',
        weight: 5,
        opacity: 0.85,
        lineJoin: 'round',
      }).addTo(map);

      // Store both so we can remove them
      (visLine as L.Polyline & { _hitLine?: L.Polyline })._hitLine = hitLine;
      polylineRef.current = visLine;

      // Drag-to-insert via-point
      hitLine.on('mousedown', (e: L.LeafletMouseEvent) => {
        if (!onRouteDragRef.current) return;
        L.DomEvent.stopPropagation(e);
        map.dragging.disable();
        map.getContainer().style.cursor = 'grabbing';

        const dragIcon = L.divIcon({
          className: '',
          html: '<div style="width:14px;height:14px;border-radius:50%;background:#f97316;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.4);margin:-7px 0 0 -7px"></div>',
          iconSize: [0, 0],
        });
        const ghost = L.marker(e.latlng, { icon: dragIcon, zIndexOffset: 2000 }).addTo(map);

        const onMove = (me: L.LeafletMouseEvent) => ghost.setLatLng(me.latlng);
        const onUp = (me: L.LeafletMouseEvent) => {
          map.off('mousemove', onMove);
          map.off('mouseup', onUp);
          map.dragging.enable();
          map.getContainer().style.cursor = '';
          ghost.remove();

          const rr = routeResultRef2.current;
          const wps = waypointsRef.current;
          if (!rr || wps.length < 2) return;

          const insertAfter = findInsertIndex(
            rr.coordinates, wps,
            e.latlng.lng, e.latlng.lat
          );
          onRouteDragRef.current?.(me.latlng.lat, me.latlng.lng, insertAfter);
        };

        map.on('mousemove', onMove);
        map.on('mouseup', onUp);
      });

      // Show pointer cursor on hover
      hitLine.on('mouseover', () => { map.getContainer().style.cursor = 'pointer'; });
      hitLine.on('mouseout', () => { map.getContainer().style.cursor = ''; });

      map.fitBounds(visLine.getBounds(), { padding: [60, 60] });
    }
  }, [routeResult]);

  // --- Fly to location ---
  const prevFlyTo = useRef<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    if (
      prevFlyTo.current?.lat === flyTo.lat &&
      prevFlyTo.current?.lng === flyTo.lng
    )
      return;
    prevFlyTo.current = flyTo;
    map.flyTo([flyTo.lat, flyTo.lng], 14, { duration: 1 });
  }, [flyTo]);

  return <div ref={containerRef} className="w-full h-full" />;
}
