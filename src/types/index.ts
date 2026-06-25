// Farm/Destination types
export interface Farm {
  id: string;
  farm_name: string;
  contact_name: string;
  contact_phone: string;
  address: string;
  delivery_notes: string;
  active: boolean;
}

// Waste collection container type. 'soil' = soil/green-waste bins that are
// dropped at a community garden — they need a bin loaded but no mulch/biochar
// prep, no scan and no recorded count (just a "done" sign-off).
export type CollectionType = 'bins' | 'buckets' | 'soil';

// Client/Business types
export interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  delivery_notes: string;
  collection_type: CollectionType;
  expected_quantity: number;
  collection_frequency: 'Weekly' | 'Fortnightly' | 'Four-weekly';
  price_per_unit: number;
  paper_towel_pickup: boolean;
  special_instructions: string;
  logo_url: string | null;
  active: boolean;
  // "How to find the bins" — driver-editable help stored in the Site Info tab.
  find_instructions?: string;
  find_media?: string[];        // media-serve URLs (photos / short videos)
  // Onboarding: the business's Start Date (raw sheet value, column H) and a
  // derived flag for whether *this* route date is their first scheduled visit —
  // i.e. the visit where the collector hands over the welcome kit.
  start_date?: string;
  is_first_visit?: boolean;
  // Manual location override (columns N / O on the sheet). When set, these take
  // precedence over the baked coordinates.json file AND the runtime geocoder
  // chain — see getClientCoordinates in routeOptimiser.ts. Used as the escape
  // hatch for addresses that won't geocode cleanly (rural delivery, brand-new
  // builds, landmark-only sites). Both are null when no override is set.
  manual_lat?: number | null;
  manual_lng?: number | null;
}

// Collector types
export type CollectorRole = 'collector' | 'accounts' | 'admin';

export interface Collector {
  id: string;
  name: string;
  pin: string;
  role: CollectorRole;
  active: boolean;
}

// Route types
export type StopStatus = 'pending' | 'completed' | 'skipped';

export type AdHocReason = 'maggots' | 'overflow' | 'customer_request' | 'other';

export interface RouteStop {
  client_id: string;
  position: number;
  status: StopStatus;
  notes: string;
  // Ad-hoc / early pickup added by driver in the field (not on the original schedule)
  isAdHoc?: boolean;
  adHocReason?: AdHocReason;
  // Brand-new off-sheet location (recorded to Pickup Notes, not the schedule grid)
  isNewLocation?: boolean;
  // Which van run this stop belongs to when a big day is split in two. Undefined
  // on every non-split day — the whole single-run code path keys off "no run".
  // `position` is interpreted within the run when this is set.
  run?: 1 | 2;
}

// A day too big for one van load gets split into two runs. This captures the
// non-stop split metadata (the per-stop assignment lives on RouteStop.run).
// Each run picks its own start/finish so the driver can, e.g., end run 1 back at
// the depot and only drop at the farm on run 2.
export interface RunEndpoints {
  startId: string;
  finishId: string;
}

export interface RouteSplitState {
  routeId: string;
  enabled: boolean;
  // Which run the driver chose to do first, and which they're doing right now.
  firstRun: 1 | 2;
  activeRun: 1 | 2;
  run1: RunEndpoints;
  run2: RunEndpoints;
}

export interface Route {
  id: string;
  route_date: string;
  collector_id: string;
  stops: RouteStop[];
  start_location: string;
  destination_farm_id: string;
  created_at: string;
}

// Drop-off record
export interface DropOffRecord {
  id: string;
  date: string;
  time: string;
  farm_id: string;
  collector_id: string;
  bins_dropped: number;
  buckets_dropped: number;
  notes: string;
  report: PickupReport | null;
}

// Pickup/Collection types
export type BinFullness = 'quarter' | 'half' | '3-quarter' | 'full';
export type ReportUrgency = 'normal' | 'urgent';

// Optional CC recipients for a report. Jermaine always receives every report;
// these are additional people the driver chooses to include per report.
export type ReportRecipient = 'sophie' | 'mieke' | 'joe';

export interface PickupReport {
  issue: string;
  action: string;
  urgency: ReportUrgency;
  recipients?: ReportRecipient[];
}

export interface PickupRecord {
  id: string;
  date: string;
  time: string;
  client_id: string;
  collector_id: string;
  bins_collected: number;
  bin_fullness: BinFullness[];
  bin_serial_numbers: string[];  // Serial number for each bin collected
  notes: string;
  photos: string[];
  report: PickupReport | null;
  status: 'completed' | 'skipped';
}

// Consolidation types - A pickup tile that can be dragged
export interface PickupTile {
  id: string;
  clientId: string;
  businessName: string;
  binsCollected: number;
  collectionType: CollectionType;
  fullness: BinFullness[];
  averageFullness: number;        // 0-100%
  serialNumber: string;           // Serial number captured at pickup
  isAssigned: boolean;
}

// Content inside a maturing bin
export interface ConsolidatedContent {
  id: string;
  pickupTileId: string;
  clientId: string;
  businessName: string;
  binsCount: number;
  collectionType: CollectionType;
  averageFullness: number;
}

// A physical maturing bin
export interface MaturingBin {
  id: string;
  serialNumber: string;           // e.g., "000032344"
  createdDate: string;            // ISO date
  readyDate: string;              // createdDate + 21 days
  contents: ConsolidatedContent[];
  collectorId: string;
  farmId: string;
  notes: string;
  status: 'maturing' | 'ready' | 'processed';
}

// Consolidation session
export interface ConsolidationSession {
  id: string;
  date: string;
  collectorId: string;
  pickupTiles: PickupTile[];
  maturingBins: MaturingBin[];
  completedAt: string | null;
}

// App state
export interface AppState {
  currentCollector: Collector | null;
  todayRoute: Route | null;
  pickups: PickupRecord[];
}
