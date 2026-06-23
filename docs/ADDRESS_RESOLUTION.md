# Address resolution

How the app turns a free-text address (from the Google Sheet) into a lat/lng,
which clients fail today, what's already in place to mitigate it, and the two
follow-up pieces of work that were scoped but not built in the
`fix/route-missing-stops` branch.

## The chain (current)

For each client the optimiser needs a coord. We look it up in this order:

1. **`src/data/coordinates.json`** — a bulk-geocoded static file keyed by
   `business_name`. Maintained via `scripts/geocode-locations.mjs`. Hits here
   are deterministic, cost zero, and ship with the bundle.
2. **`localStorage` cache** (`greenloop:geocode-cache:v1`) — keyed by the
   lower-cased trimmed address string. Holds both successes and 24-hour
   "tried and failed" markers.
3. **Live geocoder chain**, run when (1) misses and (2) has no fresh entry:
   1. Nominatim (`nominatim.openstreetmap.org`) over the original address
   2. Photon (`photon.komoot.io`) over the original address
   3. Nominatim again over the **normalised** address
      (see `normaliseAddress` in `src/utils/geocodeCache.ts`)
   4. Photon again over the normalised address
4. **Give up** — the entry is cached as `{ lat: null, lng: null, failedAt: ... }`
   and the stop shows the red **"No location"** badge on the route list. The
   route auto-apply refuses to run while any pending stop is in this state, so
   nothing gets silently dumped at the end of the route.

The normaliser strips `Unit X /`, `Suite Y,`, `Level Z`, `Flat 1,`,
`Apt 4b,`, and the bare NZ-style `5/45 X St` flat-number prefix. Anything
ambiguous is left alone. Both the original and the normalised forms get
attempted, in that order, so a tidy address that happens to trigger the
normaliser still resolves if it works as-is.

## What's covered (and where in the code)

| Piece                              | File                                                          |
| ---------------------------------- | ------------------------------------------------------------- |
| Baked coords (preferred)           | `src/data/coordinates.json` + `getClientCoordinates` in `routeOptimiser.ts` |
| Address normaliser                 | `normaliseAddress` in `src/utils/geocodeCache.ts`             |
| Photon fallback                    | `photonGeocode` in `src/utils/geocodeCache.ts`                |
| Per-stop retry button              | `StopCard` "No location" badge + `retryGeocodeFor` in `useOptimalRoute.ts` |
| Loud "No location" badge           | `StopCard.tsx`                                                |
| Banner surfaces missingCount       | `OptimisationBanner` in `RouteListPage.tsx`                   |
| Auto-apply refuses when missing>0  | `RouteListPage.tsx` (line ~145)                               |
| Cache key bumped to v2             | `AUTO_APPLIED_KEY` in `RouteListPage.tsx`                     |

## Follow-up: not built yet

### 1. Per-client manual lat/lng override

**Why we need it:** some NZ addresses will never geocode cleanly through any
generic chain — rural delivery (RD) addresses, brand-new builds that pre-date
LINZ data, addresses that point at a whole block (`Powderham Centre, New Plymouth`),
addresses inside private estates (`27 Highlands Park, Brixton`), or sites the
driver knows by landmark rather than street number.

**Proposed shape**

- Add `manual_lat` and `manual_lng` columns to the spreadsheet (or store
  per-client in the existing client editor if there's already a write path back
  to the sheet).
- Add a small client-details editor in the app (or a section in the existing
  `SettingsPage`) where the driver can:
  - paste a Google Maps "share" link (parse out `@lat,lng` or `q=lat,lng`), or
  - tap a "drop pin here" button that uses the device's geolocation, or
  - type lat/lng directly (last resort)
- Persist via the existing Google Sheets write API.
- In `getClientCoordinates`, check `client.manual_lat / lng` FIRST, before the
  baked file and before the runtime geocoder. Manual override always wins.
- Surface a small "📍 manual" badge in the StopCard when a manual coord is in
  use, so the driver knows the pin came from them not from a geocoder.

**Estimate:** ~half a day. Mostly UI plumbing; the optimiser side is one
extra `if` in `getClientCoordinates`. The Google Sheets schema change wants
coordination with whoever owns the sheet — flag before building.

**Risk:** none on the optimiser side. The only failure mode is a typo in a
manually-entered coord placing the stop in the Pacific Ocean; mitigated by a
sanity check (`-48 <= lat <= -33 && 165 <= lng <= 180` for NZ).

### 2. Background sweep — retry stale failures

**Why we need it:** today, a Nominatim+Photon miss is cached for 24 hours.
If a driver opens the app at 8am and Nominatim is briefly flaky, every miss
sticks for the rest of the working day. The per-stop "Retry" button helps but
it's manual and easy to miss.

**Proposed shape**

- A small "sweep" function that runs:
  1. on app boot, after `loadCSV()` resolves, and
  2. once an hour while the app is open (`setInterval`, cleared on unmount of
     the top-level provider)
- It scans `memCache` for entries where `lat == null && failedAt` is older than,
  say, 10 minutes, and calls `retryGeocode(addr)` on them at a polite cadence
  (one address per 5 seconds, honouring Nominatim's rate limit).
- Updates flow through the existing `setGeocodeTick` plumbing in
  `useOptimalRoute`, so any opened route list re-derives `located` / `missing`
  the moment a previously-stuck address resolves.
- A toast on success: `"Found 'X' on the map"` — but no toast on continued
  failure (drivers don't need recurring nag messages about the same address).

**Estimate:** ~2 hours. Mostly write a `runGeocodeSweep()` helper in
`geocodeCache.ts`, kick it off from `AppContext` on boot, set the interval.

**Risk:** could spike Nominatim usage if the chain reliably misses for many
addresses. Belt-and-braces: cap the per-sweep retry count at, say, 10, and
back off the sweep frequency if the previous sweep made no progress.

## Things I deliberately did NOT do

- **No Google Geocoding fallback.** Photon is free and covers the gaps
  Nominatim leaves on NZ addresses well enough for the daily round. Google
  costs money per request and would need a key, billing, and a quota story.
  Worth revisiting only if Photon turns out to be insufficient in production.
- **No LINZ Addresses API integration.** It exists, it's good for NZ-specific
  validation, but the auth flow needs an API key in the Netlify environment
  and the documented endpoints don't return lat/lng directly — you'd hit the
  addresses dataset to verify the address exists then run another query for
  the matching coord. Possible follow-up if Photon misses prove common but
  not justified yet.
- **No address-quality scoring.** Photon returns a confidence-ish field; we
  could surface "low-confidence match" as a different badge. Punted for now.
