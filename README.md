# Green Loop Collector App

A mobile-first PWA for organic waste collection teams to manage daily routes, record pickups, track bin consolidation, and report drop-offs at destination farms. Built for [Green Loop](https://greenloop.co.nz) — a New Zealand organic waste collection service.

**Live app:** https://greenloop.netlify.app

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
│   │   ├── RouteListPage.tsx          # Drag-to-reorder stop list
│   │   ├── PickupPage.tsx             # Record pickup details
│   │   ├── ConfirmationPage.tsx
│   │   ├── ConsolidationPage.tsx      # Assign pickups to maturing bins
│   │   ├── DropOffPage.tsx            # Farm drop-off recording
│   │   └── SummaryPage.tsx            # End-of-day stats + CSV export
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
├── netlify.toml
├── vite.config.ts
└── package.json
```

---

## Pages & Routes

| Route | Page | Description |
|-------|------|-------------|
| `/` | LoginPage | 4-digit PIN authentication |
| `/route` | RouteListPage | Today's stops, drag-to-reorder, date picker |
| `/pickup/:clientId` | PickupPage | Record bins, fullness, serial numbers, notes |
| `/confirmation/:clientId` | ConfirmationPage | Confirm pickup before continuing |
| `/consolidation` | ConsolidationPage | Drag pickups into maturing bins |
| `/dropoff` | DropOffPage | Farm drop-off notes and consolidation summary |
| `/summary` | SummaryPage | Stats, CSV export, reset for new day |

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

- **Row 1**: Date headers (e.g., `5 Feb 2026`, `12 Feb 2026`)
- **Business rows**: Name, address, collection type, bin type, notes, etc.
- **`Pick Up`** in a date column = scheduled stop for that day
- **Bin count** written back below the `Pick Up` marker after each collection

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

## Brand Colors

| Name | Hex |
|------|-----|
| Primary Green | `#2D8B4E` |
| Dark Green / Teal | `#1B7B62` |
| Lime Accent | `#C5D93D` |

---

## Related Projects

- **[compost-monitor](https://github.com/HJTon/compost-monitor)** — PWA for recording daily compost probe temperatures across multiple systems. Uses the same Google Sheets infrastructure.

---

## Version History

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
