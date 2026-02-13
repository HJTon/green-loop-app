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

// Client/Business types
export interface Client {
  id: string;
  business_name: string;
  contact_name: string;
  contact_phone: string;
  contact_email: string;
  address: string;
  delivery_notes: string;
  collection_type: 'bins' | 'buckets';
  expected_quantity: number;
  collection_frequency: 'Weekly' | 'Fortnightly';
  price_per_unit: number;
  paper_towel_pickup: boolean;
  special_instructions: string;
  logo_url: string | null;
  active: boolean;
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

export interface RouteStop {
  client_id: string;
  position: number;
  status: StopStatus;
  notes: string;
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

export interface PickupReport {
  issue: string;
  action: string;
  urgency: ReportUrgency;
}

export interface PickupRecord {
  id: string;
  date: string;
  time: string;
  client_id: string;
  collector_id: string;
  bins_collected: number;
  bin_fullness: BinFullness[];
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
  collectionType: 'bins' | 'buckets';
  fullness: BinFullness[];
  averageFullness: number;        // 0-100%
  isAssigned: boolean;
}

// Content inside a maturing bin
export interface ConsolidatedContent {
  id: string;
  pickupTileId: string;
  clientId: string;
  businessName: string;
  binsCount: number;
  collectionType: 'bins' | 'buckets';
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
