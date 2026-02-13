# Green Loop Collector App

A mobile-first web application for Green Loop waste collection services. Collectors use this app to manage their daily routes, log pickups, and record drop-offs at destination farms.

## Features (Phase 1 - Complete)

### Authentication
- PIN code login for collectors
- Session persistence between app visits
- Multiple user roles: collector, admin, accounts

### Route Management
- View daily route with all stops
- **Drag-and-drop reordering** of stops (useful when route needs adjusting)
- Progress tracking (X of Y stops completed)
- Visual status indicators (pending, completed, skipped)
- Starting location display

### Pickup Recording
- Business name, address, and delivery notes displayed
- Configurable bin/bucket count with quick-select buttons
- **Fullness tracking** for each bin (1/4, 1/2, 3/4, Full)
- Optional notes field
- **Photo attachments** (placeholder images for now)
- Skip functionality for unavailable stops

### Reports to Accounts
- Simplified single text field: "What happened and what action did you take?"
- **Urgency toggle**: Normal or Urgent
- Reports included in CSV export

### Farm Drop-off
- Destination farm displayed at end of route
- Automatically navigates to drop-off after last pickup
- Drop-off notes and reporting
- Summary of total bins/buckets collected

### Confirmation Flow
- Success confirmation after each pickup
- Shows **next stop name and address**
- Edit capability for same-day pickups
- Progress indicator

### End of Day
- Route completion summary with statistics
- **CSV export** with all pickup and drop-off data
- "Export & Start New Day" resets for next day

### Data Display
- Current date shown on login (NZ format)
- Delivery notes highlighted in amber box
- Mobile-optimized touch targets

## Tech Stack

- **Vite** + **React** + **TypeScript**
- **Tailwind CSS** for styling
- **React Router** for navigation
- **@dnd-kit** for drag-and-drop
- **Lucide React** for icons
- **LocalStorage** for data persistence

## Project Structure

```
src/
├── components/         # Reusable UI components
│   ├── Button.tsx
│   ├── Header.tsx
│   ├── PinPad.tsx
│   ├── ProgressBar.tsx
│   ├── StopCard.tsx
│   ├── SortableStopCard.tsx
│   ├── FullnessSelector.tsx
│   ├── PhotoSection.tsx
│   └── ReportSection.tsx
├── contexts/
│   └── AppContext.tsx  # Global state management
├── data/               # JSON data files
│   ├── clients.json    # Business clients
│   ├── collectors.json # Team members with PINs
│   ├── farms.json      # Destination farms
│   └── route.json      # Daily route configuration
├── pages/
│   ├── LoginPage.tsx
│   ├── RouteListPage.tsx
│   ├── PickupPage.tsx
│   ├── ConfirmationPage.tsx
│   ├── DropOffPage.tsx
│   └── SummaryPage.tsx
├── types/
│   └── index.ts        # TypeScript interfaces
└── utils/
    ├── data.ts         # Data loading utilities
    ├── storage.ts      # LocalStorage functions
    └── export.ts       # CSV export functionality
```

## Data Files

### clients.json
Business clients with:
- Contact details (name, phone, email)
- Address and delivery notes
- Collection type (bins/buckets)
- Expected quantity
- Collection frequency (Weekly/Fortnightly)
- Pricing information

### collectors.json
Team members with:
- Name and PIN code
- Role (collector, admin, accounts)
- Active status

### farms.json
Destination farms with:
- Farm name and address
- Contact details
- Delivery notes

### route.json
Daily route with:
- Ordered stops (client references)
- Start location
- Destination farm

## Running the App

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

## Test Login PINs

| Name     | PIN  | Role      |
|----------|------|-----------|
| Jermaine | 1234 | collector |
| Mieke    | 5678 | collector |
| Joe      | 9012 | admin     |
| Sophie   | 3456 | accounts  |
| Elric    | 4321 | collector |

## Brand Colors

- Primary Green: `#2D8B4E`
- Dark Green/Teal: `#1B7B62`
- Lime Accent: `#C5D93D`

---

## Future Development (Phase 2+)

### Notifications
- **Normal reports**: Send Email only to accounts manager
- **Urgent reports**: Send SMS + Email to accounts manager
- Real-time push notifications

### Photo Capture
- Actual camera integration (replace placeholder images)
- Photo upload and storage
- Image compression for mobile

### Cloud Sync
- Connect to Supabase backend
- Real-time data synchronization
- Multi-device support
- Historical data access

### Route Optimization
- GPS-based route suggestions
- Traffic-aware ordering
- Estimated arrival times

### Location Tracking
- GPS check-in at each stop
- Route visualization on map
- Proof of service location

### Reporting Dashboard
- Web dashboard for accounts/admin
- Collection analytics
- Client history
- Invoice generation

### Additional Features
- Paper towel pickup tracking
- Client communication portal
- Schedule management
- Holiday/absence handling

---

## Version History

### v1.0.0 (Current)
- Initial release with full Phase 1 features
- PIN login, route management, pickup recording
- Drop-off tracking with farm destinations
- Drag-and-drop route reordering
- CSV export with reset for new day
- Delivery notes per client
- Simplified single-field reporting
- Real wheelie bin photos for placeholders
