# Address resolution

How the app turns a free-text address (from the Google Sheet) into a lat/lng,
which clients fail today, what's in place to mitigate it, and what's been
shipped on top of the original `fix/route-missing-stops` branch.

## The chain (current)

For each client the optimiser needs a coord. We look it up in this order:

1. **Manual override** (`Client.manual_lat` / `manual_lng`, sheet columns N / O).
   Driver-pinned coords always win — see "Shipped" item 1 below.
2. **`src/data/coordinates.json`** — a bulk-geocoded static file keyed by
   `business_name`. Maintained via `scripts/geocode-locations.mjs`. Hits here
   are deterministic, cost zero, and ship with the bundle.
3. **`localStorage` cache** (`greenloop:geocode-cache:v1`) — keyed by the
   lower-cased trimmed address string. Holds both successes and 24-hour
   "tried and failed" markers.
4. **Live geocoder chain**, run when (2) misses and (3) has no fresh entry:
   1. Nominatim (`nominatim.openstreetmap.org`) over the original address
   2. Photon (`photon.komoot.io`) over the original address
   3. Nominatim again over the **normalised** address
      (see `normaliseAddress` in `src/utils/geocodeCache.ts`)
   4. Photon again over the normalised address
5. **Give up** — the entry is cached as `{ lat: null, lng: null, failedAt: ... }`
   and the stop shows the red **"No location"** badge on the route list. The
   route auto-apply refuses to run while any pending stop is in this state, so
   nothing gets silently dumped at the end of the route. The background sweep
   (Shipped item 2) will quietly retry these entries once they're > 24 h old.

The normaliser strips `Unit X /`, `Suite Y,`, `Level Z`, `Flat 1,`,
`Apt 4b,`, and the bare NZ-style `5/45 X St` flat-number prefix. Anything
ambiguous is left alone. Both the original and the normalised forms get
attempted, in that order, so a tidy address that happens to trigger the
normaliser still resolves if it works as-is.

## What's covered (and where in the code)

| Piece                              | File                                                          |
| ---------------------------------- | ------------------------------------------------------------- |
| Manual override (per-client pin)   | `LocationOverrideSection.tsx` + `parseLocationInput` in `locationOverride.ts` + `writeManualOverride` in `sheetDataService.ts` |
| Override wins in optimiser         | `getClientCoordinates` in `routeOptimiser.ts` (checks `manual_lat`/`manual_lng` first) |
| "Manually set" badge               | `StopCard.tsx`                                                |
| Background sweep (self-healing)    | `runGeocodeSweep` in `geocodeCache.ts` + boot/24h timers in `AppContext.tsx` |
| Baked coords (preferred fallback)  | `src/data/coordinates.json` + `getClientCoordinates` in `routeOptimiser.ts` |
| Address normaliser                 | `normaliseAddress` in `src/utils/geocodeCache.ts`             |
| Photon fallback                    | `photonGeocode` in `src/utils/geocodeCache.ts`                |
| Per-stop retry button              | `StopCard` "No location" badge + `retryGeocodeFor` in `useOptimalRoute.ts` |
| Loud "No location" badge           | `StopCard.tsx`                                                |
| Banner surfaces missingCount       | `OptimisationBanner` in `RouteListPage.tsx`                   |
| Auto-apply refuses when missing>0  | `RouteListPage.tsx` (line ~145)                               |
| Cache key bumped to v2             | `AUTO_APPLIED_KEY` in `RouteListPage.tsx`                     |

## Shipped (follow-ups now in main)

### 1. Per-client manual lat/lng override — SHIPPED

**Why we needed it:** some NZ addresses will never geocode cleanly through any
generic chain — rural delivery (RD) addresses, brand-new builds that pre-date
LINZ data, addresses that point at a whole block (`Powderham Centre, New Plymouth`),
addresses inside private estates (`27 Highlands Park, Brixton`), or sites the
driver knows by landmark rather than street number.

**What's in place**

- Sheet schema gained two new columns: **N = Manual Lat** and **O = Manual Lng**.
  The first scheduled-date column is now P instead of N. Old rows that don't yet
  have those columns populated read as `null` (no override), so the schema is
  forward-compatible — Joe adds the columns; existing rows keep working untouched.
- `Client.manual_lat` / `Client.manual_lng` flow through `transformToClient` and
  `getAllClients` so every page (route list, pickup screen, ad-hoc picker) sees
  the override consistently.
- A collapsible **"Override location"** section on the pickup screen
  (`LocationOverrideSection.tsx`) accepts two input shapes:
  - a Google Maps share / place URL — parses `?q=lat,lng`, `?ll=lat,lng`,
    `@lat,lng,zoom`, `?destination=lat,lng`, etc. via `parseLocationInput` in
    `src/utils/locationOverride.ts`. Short links (`goo.gl/maps/...`) are
    rejected with a friendly "open it and copy the full URL" message.
  - plain coords as text — `-39.0578, 174.0876` (comma or space separator).
- Inputs are validated against an NZ bounding box (`-48 ≤ lat ≤ -33`,
  `165 ≤ lng ≤ 180`) so a typo like dropping the minus sign or swapping
  lat/lng is rejected before it ever lands in the sheet.
- Persistence: `writeManualOverride` in `sheetDataService.ts` writes both cells
  (column N + column O) using the existing `sheets-write` Netlify function. The
  in-memory cache is updated optimistically so the optimiser sees the new coord
  the moment the user taps Save — no sheet refresh required. Clearing the
  override writes empty strings to both cells (so a stale half-override can't
  hide in the sheet).
- `getClientCoordinates` in `routeOptimiser.ts` checks the manual override
  FIRST, before `coordinates.json` and before the runtime geocoder chain. The
  baked file and runtime chain are still there as fallbacks for the >95 % of
  stops that don't need an override.
- A small **"Manually set"** badge appears on the stop card whenever an
  override is in use, so the driver can tell at a glance that the pin came
  from a manual lat/lng rather than from a geocoder.

**Joe needs to:** add the two new columns to the sheet header row (label them
`Manual Lat` and `Manual Lng`, or anything — the code keys by index, not name).
Existing rows leave them empty until a driver pastes a pin.

### 2. Background sweep — retry stale failures — SHIPPED

**Why we needed it:** a Nominatim + Photon miss was cached for 24 hours.
If a driver opened the app at 8 am and Nominatim was briefly flaky, every
miss stuck for the rest of the working day. The per-stop "Retry" button helped
but it was manual and easy to miss.

**What's in place**

- `runGeocodeSweep()` in `src/utils/geocodeCache.ts` scans `memCache` for
  entries with null coords AND a `failedAt` timestamp older than 24 hours,
  then re-runs the full Nominatim → Photon chain for each. Inflight
  coalescing means back-to-back calls collapse onto the same promise — no
  double-fire risk.
- Throttle: each retry goes through `geocodeAddress`, which already enforces
  ~1.1 s between Nominatim hits (`MIN_GAP_MS`). So the sweep naturally caps
  itself at one request per second, satisfying Nominatim's stated limit.
  Photon is similar; we hit it less often anyway because Nominatim usually
  wins.
- `AppContext` kicks off a sweep 5 s after boot (so the UI settles first) and
  then on a 24-hour `setInterval`. Both are cleared on unmount.
- Progress is logged to the browser console as
  `[geocode-sweep] retrying N stale failure(s)` →
  `[geocode-sweep] recovered "addr"` →
  `[geocode-sweep] done — recovered X/Y`, so a driver who calls Joe over
  can paste the trail.
- Because the failure marker is dropped before each retry, a once-broken
  address that comes good on the next run starts behaving normally (route
  list re-derives `located` / `missing` via the existing `setGeocodeTick`
  path the moment the cache updates).

## Things deliberately NOT done

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
