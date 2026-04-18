# RoutRider 🏍️

Een webapp voor het plannen van motorroutes. Maak routes op de kaart, sla ze op, deel ze met vrienden en exporteer naar GPX voor TomTom, Garmin of je telefoon.

## Functies

- 🗺️ Interactieve kaart (OpenStreetMap via Leaflet)
- 📍 Waypoints toevoegen via klikken op kaart of adreszoeken
- 🔄 Waypoints slepen om de route aan te passen
- 🚫 Geen snelwegen / geen autowegen / geen tolwegen / geen veerboten
- ⚡ Keuze routestijl: Snel, Aangeraden, Kort
- 📥 GPX export (track + route waypoints, compatibel met TomTom/Garmin/telefoon)
- 🔗 Route delen via URL
- 💾 Route lokaal opslaan (localStorage)
- ✏️ Gedeelde route openen in editor

## Stack

| Onderdeel | Technologie |
|-----------|-------------|
| Frontend + backend | Next.js 14, TypeScript |
| Kaart | Leaflet + OpenStreetMap |
| Routing | OpenRouteService API |
| Geocoding | Nominatim (OSM, gratis) |
| GPX | Eigen generator (client-side) |
| Opslag | localStorage (MVP) |
| Delen | URL-encoded base64 |

## Installatie

### 1. Vereisten
- Node.js 18 of hoger
- npm of yarn

### 2. Dependencies installeren
```bash
cd routrider
npm install
```

### 3. API key ophalen (gratis)
1. Ga naar [openrouteservice.org](https://openrouteservice.org/dev/#/signup)
2. Maak een gratis account aan
3. Maak een nieuwe API key aan (gratis tier: 2.000 requests/dag)

### 4. Environment variabelen instellen
```bash
cp .env.example .env.local
```
Open `.env.local` en vul je API key in:
```
ORS_API_KEY=jouw_api_key_hier
```

### 5. Starten
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000)

## Gebruik

1. **Route maken:** Klik op de kaart om punten toe te voegen, of zoek een adres in het zijpaneel
2. **Aanpassen:** Sleep waypoints om de route te wijzigen. Rechtsklik op een marker om hem te verwijderen
3. **Voorkeuren:** Kies routestijl en wat vermeden moet worden
4. **Berekenen:** Klik op "Bereken Route"
5. **Opslaan:** Sla lokaal op of kopieer een deellink
6. **GPX exporteren:** Klik "GPX" om te downloaden voor je navigatie

## GPX-bestanden

Het geëxporteerde GPX-bestand bevat:
- **`<trk>`** (track): de exacte berekende route — navigaties volgen dit spoor precies
- **`<rte>`** (route): alleen de waypoints — navigaties herberekenen zelf de route

Voor TomTom Rider en Garmin gebruik je bij voorkeur de **track**.

## Uitbreidingen (fase 2)

- [ ] Wegsegmenten aanklikken om te forceren of te vermijden
- [ ] Toeristische scoring (bochtige wegen, hoogteverschillen)
- [ ] Gebruikersaccounts + database (PostgreSQL/PostGIS)
- [ ] Groepsritten en live-locatie
- [ ] POI's: koffiestops, uitkijkpunten, tankstations
- [ ] Rondrit vanaf huidige locatie
- [ ] Ratings en comments op routes

## Licentie

MIT
