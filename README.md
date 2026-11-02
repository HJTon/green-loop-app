# Green Loop Collector App

A mobile-first PWA for organic waste collection teams to manage daily routes, record pickups, track bin consolidation, and report drop-offs at destination farms. Built for [Green Loop](https://greenloop.co.nz) — a New Zealand organic waste collection service.

**Live app:** https://green-loop-collections.netlify.app

---

## What it does

Collectors use the app in the field on their phones:

1. **Log in** with a 4-digit PIN
2. **View today's route** — stops loaded live from Google Sheets
3. **Record each pickup** — bin count, fullness level, serial numbers (with OCR scanning), notes
4. **Consolidate waste** — drag pickups into maturing bins (120L capacity tracking, 21-day ready dates)
5. **Record drop-off** at the destination farm
6. **End of day** — export CSV summary, reset for tomorrow

The app works offline — all data is saved locally and synced back to Google Sheets when connectivity returns.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript |
| Build | Vite |
| Routing | React Router v7 |
| Styling | Tailwind CSS v4 |
| Drag & Drop | @dnd-kit |
| Icons | Lucide React |
| State / Persistence | React Context + LocalStorage |
| Serverless | Netlify Functions |
| Schedule Data | Google Sheets API (service account) |
| OCR | Google Cloud Vision API |
| Email | Resend API |
| Invoicing | Google Apps Script |

---

## Project Structure

```
green-loop-app/
├── src/
│   ├── App.tsx                        # Router setup
│   ├── main.tsx                       # Entry point
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── Header.tsx
│   │   ├── PinPad.tsx
│   │   ├── ProgressBar.tsx
│   │   ├── StopCard.tsx / SortableStopCard.tsx
│   │   ├── FullnessSelector.tsx
│   │   ├── DatePickerModal.tsx
│   │   ├── Toast.tsx
│   │   └── consolidation/             # Bin consolidation UI
│   │       ├── CameraCapture.tsx
│   │       ├── SerialNumberModal.tsx
│   │       ├── DraggablePickupTile.tsx
│   │       ├── PickupTileCard.tsx
│   │       ├── MaturingBinCard.tsx
│   │       └── MaturingBinDropZone.tsx
│   ├── contexts/
│   │   └── AppContext.tsx              # Global state + offline sync
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── LoadVanPage.tsx            # Pre-run load list + welcome-kit reminder
│   │   ├── RouteListPage.tsx          # Drag-to-reorder stop list
│   │   ├── PickupPage.tsx             # Record pickup details + welcome-kit checklist
│   │   ├── ConfirmationPage.tsx
│   │   ├── ConsolidationPage.tsx      # Assign pickups to maturing bins
│   │   ├── DropOffPage.tsx            # Farm drop-off recording
│   │   ├── SummaryPage.tsx            # End-of-day stats + CSV export
│   │   └── SettingsPage.tsx          # PWA install, updates, welcome-kit editor
│   ├── services/
│   │   ├── sheetDataService.ts        # Load route from Google Sheets
│   │   ├── consolidationService.ts    # Bin capacity + fullness logic
│   │   ├── ocrService.ts              # Serial number OCR
│   │   └── emailService.ts            # Report email notifications
│   ├── types/
│   │   ├── index.ts
│   │   └── sheet.ts
│   └── utils/
│       ├── storage.ts                 # LocalStorage helpers
│       ├── csvParser.ts               # Parse Sheets CSV export
│       ├── export.ts                  # Generate daily CSV
│       └── data.ts                    # Load static collectors/farms JSON
├── netlify/
│   └── functions/
│       ├── sheets-read.ts             # Read pickup schedule
│       ├── sheets-write.ts            # Write bin counts after pickup
│       ├── ocr-vision.ts              # Google Cloud Vision OCR
│       ├── maturing-bins-write.ts     # Export consolidation to sheet
│       ├── send-report-email.ts       # Email via Resend API
│       └── drive-upload.ts            # Google Drive photo upload
├── public/
│   ├── logo.jpg
│   ├── bin1.jpg, bin2.jpg, bin3.jpg   # Reference photos
│   ├── logos/                         # Client logos
│   └── data/
│       └── schedule.csv               # Fallback dev data
├── google-apps-script/
│   └── InvoiceGenerator.gs            # Monthly invoice generation
├── docs/
│   ├── Green Loop Collections Health and Safety Plan.docx
│   └── build-hs-plan.js               # Regenerates the H&S plan (needs `npm i docx`)
├── netlify.toml
├── vite.config.ts
└── package.json
```

---

## Pages & Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | LoginPage | 4-digit PIN authentication |
| `/load-van` | LoadVanPage | Pre-run load list (empty bins/buckets per stop) + welcome-kit reminder |
| `/route` | RouteListPage | Today's stops, drag-to-reorder, date picker |
| `/pickup/:clientId` | PickupPage | Record bins, fullness, serial numbers, notes; first-visit welcome-kit checklist |
| `/confirmation/:clientId` | ConfirmationPage | Confirm pickup before continuing |
| `/consolidation` | ConsolidationPage | Drag pickups into maturing bins |
| `/dropoff` | DropOffPage | Farm drop-off notes and consolidation summary |
| `/summary` | SummaryPage | Stats, CSV export, reset for new day |
| `/settings` | SettingsPage | Install PWA, check for updates, edit welcome-kit contents |

---

## First-visit welcome kit

When a business has its **first collection**, the collector hands over a welcome kit
(default: **2 posters, 2 stickers, 2 flyers, box of Zing** — editable in Settings).

- **Detection** — a stop is a "first visit" when today's route date equals the business's
  **Start Date** (column H), computed in `isFirstVisitForDate` in `sheetDataService.ts` and
  surfaced as `Client.is_first_visit`. Start Date (rather than "earliest column in the sheet")
  is used so existing customers carried into a new sheet aren't falsely flagged — their start
  date sits in the past and won't match a current route date.
- **Load the van** — a highlighted card lists which businesses need a kit today and what to
  pack, so the collector loads it before heading out.
- **Pickup screen** — a checklist popup appears for a first-visit business; ticking every item
  enables "All handed over", which records the hand-over in the pickup note and shows a
  persistent confirmation banner. It won't re-prompt once confirmed or after the pickup is
  completed.
- **Settings** — the kit contents are editable (add/remove/edit items, save, restore defaults).
- **Storage** — kit contents in `localStorage["greenloop_welcome_kit"]` (per device; defaults
  in `DEFAULT_WELCOME_KIT_ITEMS`), and per-visit delivery state in
  `localStorage["greenloop_kit_delivered"]` keyed by `date|clientId`.

> **Dev note:** the fallback `public/data/schedule.csv` has a drifted column layout vs the
> production sheet, so `start_date`/date columns parse to the wrong cells in `npm run dev` and
> the first-visit flow can't be exercised locally — it works against the live Google Sheet.

---

## Data Flow

```
Google Sheets (schedule)
    └─▶ Netlify Function (sheets-read)
            └─▶ sheetDataService.ts
                    └─▶ AppContext (state)
                            └─▶ Pages

After pickup:
    AppContext ──▶ LocalStorage (always)
                └─▶ sheets-write (if online)
                └─▶ pendingWrites queue (if offline)
                        └─▶ auto-synced on reconnect
```

### Google Sheets format

- **Row 1**: Date serials (hidden) · **Row 2**: date headers (e.g., `5 Feb 2026`) and day-of-week · **Data from row 3**
- **`Pick Up`** in a date column = scheduled stop for that day
- **Bin count** written back below the `Pick Up` marker after each collection

Column layout of the `invoicing` tab:

| Col | Field | Notes |
|-----|-------|-------|
| A | Business Name | Operational name shown in the app |
| B | Invoice Name | Name used on Xero invoices (may differ from A); read only by the invoice script |
| C | Address | |
| D | Contact | |
| E | Phone | |
| F | Delivery Instructions | |
| G | Pickup Type | Dropdown: `Week` / `Fortnight` / `4 Weekly` |
| H | Start Date | Used by `Fortnight`/`4 Weekly` 14/28-day cadence |
| I | Pickup Day | Day of week |
| J | Paying From | Free pickups before this date |
| K | Bin Type | `W-Bins` / `Bkts` / `Soil` (soil/green-waste — loaded on the van but signed off without scan/count) |
| L | No. of Bins | |
| M | Extra Pickup | Paper towels / `-` |
| N | Manual Lat | Optional driver-pinned latitude (overrides geocoding — see below) |
| O | Manual Lng | Optional driver-pinned longitude (overrides geocoding — see below) |
| P onward | Date columns | One per scheduled week |

#### Manual location override (columns N + O)

Some NZ addresses won't geocode cleanly through Nominatim or Photon — rural
delivery (RD) lines, brand-new builds that pre-date LINZ data, sites that point
at a whole block, or landmark-only locations. The "Override location" section
on the Pickup screen lets a driver paste a Google Maps share link or type
`lat, lng` directly; that value lands in columns **N** (`Manual Lat`) and
**O** (`Manual Lng`) on the business's row. When both are populated they take
precedence over `coordinates.json` AND the runtime geocoder chain, so the
optimiser uses the manual pin instead of whatever Nominatim returns.

- Both cells default to empty; clearing the override writes empty strings to
  both (no half-overrides). Old rows without the columns populated read as
  `null` (no override) and behave exactly as before.
- Input is validated against an NZ bounding box (`-48 ≤ lat ≤ -33`, `165 ≤ lng ≤ 180`)
  in `src/utils/locationOverride.ts` so a typo can't drop a stop into the Pacific.
- See `getClientCoordinates` in `routeOptimiser.ts` for the precedence
  order and `docs/ADDRESS_RESOLUTION.md` for the wider story.

The "Pick Up" markers are **per-cell formulas** (not conditional formatting) keyed off the
Pickup Type in column G — see `pickupTypeToFrequency` in `sheetDataService.ts` and the formula
notes below for how `Week`/`Fortnight`/`4 Weekly` cadences are computed.

### Editing the sheet directly (dropdowns, formulas, columns)

The Netlify functions (`sheets-read` / `sheets-write`) only read and write **cell values**. To
change **data validation (dropdowns), per-cell formulas, or sheet structure** (insert/delete
columns) you must call the Google Sheets API directly with `batchUpdate`. Method:

```bash
# 1. Pull the service-account key and spreadsheet ID from Netlify (project is linked)
npx netlify env:get GOOGLE_SERVICE_ACCOUNT_KEY   # → write to a temp _sa_key.json
npx netlify env:get GOOGLE_SPREADSHEET_ID
```

```js
// 2. Temp .mjs script using the bundled `googleapis` package
import { google } from 'googleapis';
import { readFileSync } from 'node:fs';
const credentials = JSON.parse(readFileSync('./_sa_key.json', 'utf8'));
const auth = new google.auth.GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
// values.get / values.batchUpdate (USER_ENTERED) for cell content & formulas
// spreadsheets.batchUpdate for insertDimension, setDataValidation, etc.
```

**Safety rules when editing the grid programmatically:**
- The `invoicing` tab's numeric `sheetId` is `1432184980`.
- **Never blanket-overwrite date cells.** Each date cell holds *either* the schedule formula
  *or* a recorded bin count written by `sheets-write` on collection. Only touch cells that still
  hold the formula, or you destroy collection history.
- When rebuilding formulas, **don't use `String.replace(re, newStr)`** — `$1`/`$2` in the
  replacement string are treated as capture refs and corrupt cell refs like `N$1`. Build the
  replacement by concatenation or use a replacer function.
- Inserting/deleting a column shifts every column after it; Google auto-adjusts relative formula
  refs, data validation and conditional-formatting ranges, but **hardcoded column indices in code
  do not** — update `COLUMNS` in `sheetDataService.ts` and `CONFIG` in `InvoiceGenerator.gs`.
- **Always delete `_sa_key.json` and any temp scripts afterwards** — they contain secrets.

### `Site Info` tab (how to find the bins)

A separate tab — deliberately **not** part of the `invoicing` grid, so it can't shift the
date columns or disturb the invoice formulas — holds driver-editable per-site help:

| Col | Field |
|-----|-------|
| A | Business Name (key, matched case-insensitively) |
| B | Find Instructions (free text) |
| C | Media URLs (newline/comma separated `media-serve` links) |

It's read on load via `site-info-read` (returns empty if the tab doesn't exist yet) and
upserted via `site-info-write` (which creates the tab on first write). Photos and short
videos are stored through the existing `media-upload`/`media-serve` (Netlify Blobs) path;
videos play back at 2× on the pickup screen. The same tab is the intended home for the
Tier-1 `approach_from` note in the Roadmap below.

### Static data files

- `public/data/collectors.json` — team members (name, PIN, role)
- `public/data/farms.json` — destination farms (name, address, contact, notes)

---

## Installation & Development

```bash
# Install dependencies
npm install

# Start dev server (uses static fallback data)
npm run dev

# Build for production
npm run build
```

For local development with live Google Sheets data, you'll need the Netlify CLI:

```bash
npm install -g netlify-cli
netlify login
netlify link      # Link to your Netlify site
netlify dev       # Starts local server with functions
```

---

## Deployment

Hosted on Netlify. To deploy:

```bash
netlify deploy --prod
```

This deploys both the static app and the Netlify Functions.

---

## Environment Variables

Set these in the Netlify dashboard under **Site Settings > Environment Variables**:

| Variable | Description |
|----------|-------------|
| `GOOGLE_SERVICE_ACCOUNT_KEY` | Google service account JSON (single line) |
| `SPREADSHEET_ID` | Pickup schedule Google Sheet ID |
| `MATURING_BINS_SPREADSHEET_ID` | Maturing bins tracking Sheet ID |
| `RESEND_API_KEY` | Resend API key for email notifications |
| `ACCOUNTS_EMAIL` | Report notification address (default: `accounts@greenloop.co.nz`) |

The Google service account needs **Editor** access to the relevant spreadsheets.

---

## Invoice Generator (Google Apps Script)

`google-apps-script/InvoiceGenerator.gs` generates monthly invoices from the pickup schedule sheet.
The Xero **ContactName** comes from column **B (Invoice Name)** (falling back to column A if B is
blank). Businesses that share an Invoice Name — e.g. several EnviroNZ subcontract sites — **roll up
into a single invoice**, with one line item per source business. When a business's column-A name
differs from its Invoice Name, that name is shown in the line description (e.g.
`Organic Waste Collection - May 2026 - Molly Ryan (7th: 1, 13th: 2)`). Detail entries omit the
month and the bin/bucket label.

**Setup:**
1. Open the invoicing Google Sheet
2. **Extensions > Apps Script** → paste the script → save
3. Run `setupInvoiceSheet` once to create the Monthly Invoices tab
4. Refresh — a **🌿 Green Loop Invoicing** menu appears

**Menu options:**
- **Generate Monthly Invoices…** — select a month and generate
- **Export Last Month to Xero CSV** — run on the 1st of the month
- **Refresh Current Month** — regenerate in-progress month

**Xero export format:** Invoice date = 1st, Due date = 20th, GST (15%) included, auto-numbered `GL-YYYYMM-NNN`.

---

## Health & Safety

`docs/Green Loop Collections Health and Safety Plan.docx` is the health & safety plan for the
collection operation (loading, driving, customer pickups, transport/consolidation, drop-off,
cleaning). It is aligned with the **Health and Safety at Work Act 2015 (HSWA)** and WorkSafe NZ
guidance, and includes a collections risk register, PPE, safe-work procedures, emergency
procedures, incident/notifiable-event reporting, and sign-off appendices. It ships as a working
draft with `____` blanks (contacts, approver) to complete and review with the team.

Regenerate it from `docs/build-hs-plan.js`:

```bash
cd docs && npm i docx && node build-hs-plan.js
```

---

## Brand Colors

| Name | Hex |
|------|-----|
| Primary Green | `#2D8B4E` |
| Dark Green / Teal | `#1B7B62` |
| Lime Accent | `#C5D93D` |

---

## Roadmap

### Approach side / one-way streets (entry-side awareness)

Some sites can be reached from two sides of a block. With New Plymouth's one-way
streets, the side you enter from materially changes the effort — much more so for
**bucket** pickups (the collector carries buckets to/from the van on foot and must stop
on the correct side) than for **bin** pickups (bins are wheeled and more forgiving). A
relief driver covering the regular collector has no way to know the right approach today.

Proposed in tiers — recommend doing **Tier 1** first and only escalating if it proves
insufficient:

- **Tier 1 — data + display (cheap, high value).** An optional per-site `approach_from`
  note (free text, e.g. *"enter from Devon St heading west, stop outside #42"*), stored in
  the same **`Site Info`** tab as the "how to find the bins" help and surfaced prominently
  on the stop card and pickup screen. No routing maths; immediately useful to a relief
  driver, and editable in the field like the find-the-bins help.
- **Tier 2 — model two access points.** Give a site up to two geocoded entry coordinates
  with a preferred one, and feed the preferred coordinate (rather than the postal address)
  into the existing geocode → `roadMatrix` → `routeOptimiser` pipeline so driving-time
  optimisation reflects the real approach. Mostly plumbing through structures that already
  exist (`utils/geocodeCache.ts`, `utils/roadMatrix.ts`, `utils/routeOptimiser.ts`,
  `hooks/useOptimalRoute.ts`).
- **Tier 3 — directionality / one-way awareness.** Let the optimiser prefer orderings that
  approach a site from the correct side, weighting buckets more heavily than bins. Requires
  one-way data and an asymmetric cost matrix — significant effort; only worth it if Tiers 1–2
  aren't enough.

## Related Projects

- **[compost-monitor](https://github.com/HJTon/compost-monitor)** — PWA for recording daily compost probe temperatures across multiple systems. Uses the same Google Sheets infrastructure.

---

## Version History

### v2.4.0 (June 2026)
- First-visit welcome-kit checklist (Start-Date driven): reminder on Load-the-van, checklist popup + banner on Pickup, editable contents in Settings
- Collections Health & Safety plan (`docs/`) — HSWA 2015 / WorkSafe NZ aligned, regenerable via `build-hs-plan.js`

### v2.3.0 (February 2026)
- Email notifications for pickup and drop-off reports via Resend API
- Urgency toggle (Normal / Urgent) with distinct email styling

### v2.2.0 (February 2026)
- Xero CSV export for monthly invoicing
- Auto-generated invoice numbers (`GL-YYYYMM-NNN`)

### v2.1.0 (February 2026)
- NZ timezone fix for correct date display
- Invoice Generator Google Apps Script with GST, free-pickup tracking, status management

### v2.0.0 (February 2026)
- Live Google Sheets integration (read + write)
- OCR serial number scanning via Google Cloud Vision
- Bin consolidation with drag-and-drop
- Maturing bins tracking (21-day ready date)
- Offline support with automatic sync
- Calendar date picker for viewing other days

### v1.0.0
- PIN login, route management, pickup recording
- Drop-off tracking with farm destinations
- Drag-and-drop route reordering
- CSV export with daily reset
- Simplified single-field reporting
