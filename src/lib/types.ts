export interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  name?: string; // resolved address name
  type?: 'waypoint' | 'poi'; // distinguish regular waypoints from POI stops
  poiCategory?: string; // e.g. 'restaurant', 'fuel', 'attraction'
}

export type PoiCategory = 'restaurant' | 'fuel' | 'cafe' | 'hotel' | 'attraction' | 'parking';

export interface PoiResult {
  id: string;
  lat: number;
  lng: number;
  name: string;
  category: PoiCategory;
  tags?: Record<string, string>;
}

export type RouteStyle = 'fastest' | 'recommended' | 'shortest';
export type VehicleProfile = 'driving-car' | 'cycling-mountain';

export interface RoutePreferences {
  style: RouteStyle;
  vehicleProfile: VehicleProfile;
  avoidHighways: boolean;    // geen snelwegen (motorway)
  avoidMotorways: boolean;   // geen autowegen (trunk)
  avoidFerries: boolean;     // geen veerboten
  avoidTollways: boolean;    // geen tolwegen
  avoidUnpaved: boolean;     // geen onverharde wegen (zandpaden, gravel)
}

export interface RouteResult {
  coordinates: [number, number][]; // [lng, lat] from ORS
  distance: number;                 // meters
  duration: number;                 // seconds
  ascent?: number;                  // meters
  descent?: number;                 // meters
}

export interface SavedRoute {
  id: string;
  name: string;
  description?: string;
  waypoints: Waypoint[];
  preferences: RoutePreferences;
  routeResult?: RouteResult;
  createdAt: string;
}

// Shared route payload encoded in the URL
export interface SharePayload {
  name: string;
  description?: string;
  waypoints: Waypoint[];
  preferences: RoutePreferences;
}
