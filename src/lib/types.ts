export interface Waypoint {
  id: string;
  lat: number;
  lng: number;
  name?: string; // resolved address name
}

export type RouteStyle = 'fastest' | 'recommended' | 'shortest';

export interface RoutePreferences {
  style: RouteStyle;
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
